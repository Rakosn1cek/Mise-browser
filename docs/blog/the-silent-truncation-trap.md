# The Silent Truncation Trap: How Mid-Write Crashes and Naive Fallbacks Destroyed User Data

Why direct synchronous file writes and silent default fallbacks caused catastrophic data loss, and how atomic filesystem guarantees and corrupt file snapshotting resolved it.

---

## 1. The Problem: The Disappearing Bookmarks Mystery

There is no software bug more demoralising for a user than silent data loss. You spend months curating research links, project quickmarks, and custom browser settings. Then, after an unexpected laptop battery death or an abrupt process termination, you relaunch your browser only to be greeted by a desolate wasteland: zero bookmarks, empty quickmarks, and default settings.

In Mise Browser, all user data (bookmarks, quickmarks, visit history, notes, and preferences) is intentionally stored locally in plain human-readable JSON and Markdown files inside `~/.config/mise-browser/`. There are no opaque proprietary binary databases or cloud synchronization daemons.

However, during stress testing on Linux hardware under simulated sudden terminations, a severe vulnerability emerged: interrupted writes left corrupt or truncated JSON files on disk. Worse still, upon the next startup, the browser silently overwrote the user's damaged data with empty arrays and default values, permanently destroying any hope of recovery.

---

## 2. The Solution (My First Attempt)

When I first implemented local persistence in `main/storage.js`, I prioritised simplicity and minimalism.

Writing data was implemented via straightforward Node.js synchronous filesystem calls:

```javascript
// Naive write implementation
function saveBookmarks(data, targetPath = BOOKMARKS_PATH) {
    try {
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(targetPath, JSON.stringify(data, null, 4), 'utf-8');
        return true;
    } catch (err) {
        return false;
    }
}
```

To prevent the application from crashing if a file was missing or unreadable on startup, read operations wrapped `JSON.parse` in defensive try-catch blocks:

```javascript
// Naive read fallback
function readBookmarks(targetPath = BOOKMARKS_PATH) {
    try {
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(targetPath)) fs.writeFileSync(targetPath, JSON.stringify([]), 'utf-8');
        return JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
    } catch (err) {
        return [];
    }
}
```

Similarly, configuration loading in `main/config.js` followed the same pattern: if `JSON.parse(fs.readFileSync(targetPath))` threw an error, it silently caught the exception and returned `{ ...DEFAULT_CONFIG }`.

On static unit tests and clean application shutdowns, this appeared to function without fault.

---

## 3. The Bug / The Fail: The Destruction Cycle

Under realistic operating conditions, this naive architecture created a destructive cascading failure chain.

### A. The Truncation Race Condition

Standard POSIX `fs.writeFileSync(targetPath, ...)` opens the destination file with the flags `O_WRONLY | O_CREAT | O_TRUNC`. The critical hazard lies in `O_TRUNC`: the operating system kernel immediately truncates the file length to zero bytes before writing the new content.

If a kernel panic, battery failure, SIGKILL, or Electron crash occurs while the write buffer is being written or flushed, the file is left on disk as either:
1. A zero-byte empty file.
2. An incomplete, truncated JSON fragment (e.g. `[{"title": "GitHub", "url": "https://github.com"` without closing braces).

### B. The Destructive Overwrite Loop

When the browser launched after such an interruption, the real catastrophe unfolded:

1. `readBookmarks()` called `fs.readFileSync(targetPath)` and received the broken JSON.
2. `JSON.parse()` threw a `SyntaxError`.
3. The catch block caught the exception and returned `[]`.
4. The user, unaware of what occurred under the bonnet, bookmarked a new article.
5. `saveBookmarks()` received the single new bookmark in an array of length 1 and executed `fs.writeFileSync(targetPath, ...)`.
6. The user's original bookmarks (which might have had 95% recoverable content) were permanently overwritten with the single new item.

The same tragedy struck `quickmarks.json`, `history.json`, and `config.json`. A single syntax glitch resulted in total amnesia.

### C. The Directory Argument Mismatch

To compound the issue, helper functions `openNotesInExternalApp` and `exportArticleToExternal` in `main/storage.js` invoked:

```javascript
const cfg = config.loadBrowserConfig(path.join(targetConfigDir, 'config.json'));
```

However, the signature of `loadBrowserConfig` was `(targetDir, targetPath)`. Passing the full file path as the first argument caused `fs.mkdirSync` to treat the file path as a directory, and defaulted `targetPath` back to the global user profile path, ignoring custom workspace configurations.

---

## 4. The Architectural Fix: Atomic Writes and Corrupt File Snapshotting

To eradicate data loss permanently, we introduced an atomic filesystem subsystem in [`main/atomicFile.js`](file:///home/rk1/arch-projects/MiseBrowser/main/atomicFile.js) and re-engineered [`main/storage.js`](file:///home/rk1/arch-projects/MiseBrowser/main/storage.js) and [`main/config.js`](file:///home/rk1/arch-projects/MiseBrowser/main/config.js).

### 1. Atomic Writes with Hardware fsync

Atomic file replacement guarantees that an existing file is never modified in-place:

```javascript
function atomicWriteFileSync(targetPath, data, { mode = 0o600 } = {}) {
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    const tmpPath = `${targetPath}.${process.pid}.tmp`;
    let fd;
    try {
        fd = fs.openSync(tmpPath, 'w', mode);
        if (process.platform !== 'win32') {
            fs.fchmodSync(fd, mode);
        }
        if (typeof data === 'string') {
            fs.writeSync(fd, data, undefined, 'utf8');
        } else {
            fs.writeSync(fd, data);
        }
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(tmpPath, targetPath);
    } catch (err) {
        if (fd !== undefined) {
            try { fs.closeSync(fd); } catch (_) {}
        }
        try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch (_) {}
        throw err;
    }
}
```

Key guarantees:
* **Unique Temporary Path**: Writes target `${targetPath}.${process.pid}.tmp`, ensuring parallel processes never collide.
* **Strict POSIX Permissions**: Explicitly sets file permissions to `0o600` (read/write for owner only) via `fchmodSync`.
* **Hardware Cache Flush**: Calls `fs.fsyncSync(fd)` before closing, forcing the storage controller to commit all pages from OS volatile buffers to physical NAND or platter storage.
* **Atomic Rename**: `fs.renameSync` is a POSIX atomic primitive. The directory entry pointer swaps in a single filesystem transaction. At no point in time does a partial or truncated file exist at `targetPath`.
* **Guaranteed Rollback**: If any failure occurs prior to rename, the temporary file is purged and the existing `targetPath` remains untouched.

### 2. Automatic Corrupt File Snapshots with Rolling Retention

When a damaged file is encountered, the browser must never silently discard it. [`backupCorruptFile`](file:///home/rk1/arch-projects/MiseBrowser/main/atomicFile.js) creates an immutable timestamped copy before returning defaults:

```javascript
function backupCorruptFile(targetPath, maxKeep = 3) {
    try {
        if (!fs.existsSync(targetPath)) return null;

        const stats = fs.statSync(targetPath);
        const resolvedPath = path.resolve(targetPath);
        const fileSignature = `${stats.size}:${stats.mtimeMs}`;

        // Deduplicate: do not create redundant copies for unchanged corrupt files
        if (backedUpVersions.get(resolvedPath) === fileSignature) {
            return null;
        }

        const baseTimestamp = formatTimestamp();
        let backupPath = `${targetPath}.corrupt-${baseTimestamp}`;
        if (fs.existsSync(backupPath)) {
            let collisionIndex = 1;
            while (fs.existsSync(`${backupPath}-${collisionIndex}`)) collisionIndex++;
            backupPath = `${backupPath}-${collisionIndex}`;
        }

        fs.copyFileSync(targetPath, backupPath);
        backedUpVersions.set(resolvedPath, fileSignature);

        // Prune older backups: keep only newest maxKeep copies
        const dir = path.dirname(targetPath);
        const baseName = path.basename(targetPath);
        const corruptPrefix = `${baseName}.corrupt-`;

        const existingBackups = fs.readdirSync(dir)
            .filter((name) => name.startsWith(corruptPrefix))
            .map((name) => ({
                fullPath: path.join(dir, name),
                mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs
            }));

        existingBackups.sort((a, b) => a.mtimeMs - b.mtimeMs);

        if (existingBackups.length > maxKeep) {
            const filesToDelete = existingBackups.slice(0, existingBackups.length - maxKeep);
            for (const item of filesToDelete) {
                try { fs.unlinkSync(item.fullPath); } catch (_) {}
            }
        }

        return backupPath;
    } catch (_) {
        return null;
    }
}
```

Key safety properties:
* **In-Memory Deduplication**: Tracks `${size}:${mtimeMs}` so reading an unchanged corrupt file repeatedly does not spam the user's disk with identical backups.
* **Rolling Pruning**: Retains exactly the 3 newest `.corrupt-*` snapshots and deletes older iterations, preventing disk bloat.
* **Non-Throwing Guarantee**: Enclosed in a universal `try-catch` returning `null`, guaranteeing that backup operations cannot crash startup.

### 3. Schema Validation and Strict Payload Boundaries

Before writing to disk, save routines enforce data structures and maximum payload sizes (5 MB):

```javascript
const MAX_STORAGE_SIZE = 5 * 1024 * 1024;

function saveBookmarks(data, targetPath = BOOKMARKS_PATH) {
    try {
        if (!Array.isArray(data)) return false;
        const serialized = JSON.stringify(data, null, 4);
        if (typeof serialized !== 'string' || serialized.length > MAX_STORAGE_SIZE) return false;
        atomicWriteFileSync(targetPath, serialized);
        return true;
    } catch (err) {
        return false;
    }
}
```

If a caller erroneously passes an object to `saveBookmarks` or an array to `saveQuickmarks`, or exceeds 5 MB, the write is rejected immediately and the on-disk file remains byte-identical.

---

## 5. Verification & Key Takeaways

We added a dedicated test suite in [`tests/atomic-file.test.js`](file:///home/rk1/arch-projects/MiseBrowser/tests/atomic-file.test.js) and extended [`tests/storage.test.js`](file:///home/rk1/arch-projects/MiseBrowser/tests/storage.test.js) and [`tests/config-writes.test.js`](file:///home/rk1/arch-projects/MiseBrowser/tests/config-writes.test.js):

1. **POSIX Permissions & Atomic Guarantees**: Confirmed `0o600` permissions and zero orphaned `.tmp` files on both success and deliberate directory creation failures.
2. **Snapshot Deduplication**: Verified that reading corrupt bookmarks (`{broken`) returns `[]`, creates a `.corrupt-*` backup, and repeated reads create no duplicate copies.
3. **Recovery After Overwrite**: Verified that saving valid bookmarks writes fresh data atomically while preserving the existing `.corrupt-*` backup.
4. **Boundary Enforcements**: Verified that passing invalid types (`{}`, `[]`, numbers) or strings exceeding 5 MB returns `false` and preserves existing disk bytes verbatim.
5. **Directory Parameter Fix**: Verified that `openNotesInExternalApp` and `exportArticleToExternal` pass `(targetConfigDir, path.join(targetConfigDir, 'config.json'))` properly, isolating workspace command configurations.

### Architectural Takeaways

* **Never Truncate In-Place**: Standard file writing primitives are not crash-safe. An application storing persistent state must write to a temporary file, `fsync`, and atomically rename into place.
* **Fallbacks Must Preserve Evidence**: Catching parse errors and returning empty defaults without snapshotting the corrupt original is equivalent to deleting user data. Always back up the corrupted file before falling back.
* **Deduplicate Diagnostic Artifacts**: Guard snapshotting mechanisms with size and mtime signatures to prevent disk flooding during repeated read loops.
