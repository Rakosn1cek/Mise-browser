# The Anatomy of a Leak-Proof Private Workspace: When Toggling State Shatters Process Isolation

Why toggling private mode across persistent workspaces was an architectural hazard, how remote favicon lookups leaked host requests, and how a dedicated volatile workspace restored true privacy.

---

## 1. The Problem

In traditional web browsers, private browsing is simple: you press `Ctrl + Shift + N` or `Ctrl + Shift + P`, and the browser spawns a brand new window running an isolated, volatile session.

In an Electron-based browser engineered for fanless Linux laptops and minimalist desktop environments, spawning a whole new window is an architectural anti-pattern. An additional `BrowserWindow` in Electron creates another renderer process, duplicate compositor surfaces, and extra memory overhead. For Mise, where the core design philosophy revolves around an uncluttered single-window canvas and aggressive RAM conservation through tab hibernation, opening second windows felt clumsy and inefficient.

We wanted private browsing to feel native to our container architecture. In Mise, every workspace maps to a dedicated, persistent Chromium partition:

* Workspace `Work` runs in `persist:work`.
* Workspace `Personal` runs in `persist:personal`.

Why not simply provide an ephemeral browsing state within the existing window?

---

## 2. The Solution (My First Attempt)

My initial implementation treated private browsing as a global toggle.

When the user pressed `Ctrl + Shift + P`, Mise updated a state flag:

```javascript
// Naive private mode toggle
state.globalPrivateModeActive = !state.globalPrivateModeActive;
handlePrivateBrowsingStateShift(state.globalPrivateModeActive);
```

Under this model:
1. `handlePrivateBrowsingStateShift()` destroyed the active webviews in the current workspace.
2. The UI rerendered, checking `state.globalPrivateModeActive`.
3. If true, newly instantiated webviews were assigned the partition `MisePrivateProfile` instead of `persist:workspace_name`.
4. The sidebar border turned red to signal that private mode was active.

Pressing `Ctrl + Shift + P` again flipped the flag back to false, destroyed the webviews once more, and recreated them back in the persistent container partition.

On the surface, this seemed functional. The volatile `MisePrivateProfile` session prevented Chromium from storing cookies and cache to disk. But under closer scrutiny, this toggle-based approach was fundamentally broken.

---

## 3. The Bug / The Fail

Treating private browsing as a mutable modal flag created three distinct, critical failures: state confusion, history leakage, and host-level network requests.

### A. The State Confusion Trap

Flipping an entire existing workspace into private mode confused container boundaries:
* If you had tabs open in `Work` (such as internal dashboards or email) and pressed `Ctrl + Shift + P`, all your work tabs were suddenly reloaded inside the volatile partition, logging you out of your sessions.
* Even worse, if you opened new tabs while in private mode and then toggled private mode off, those private tabs were reloaded inside your persistent `persist:work` container, completely defeating ephemeral isolation.

### B. The Silent History and Session Leak

Even though the webview ran inside `MisePrivateProfile`, the main process listened to navigation events globally:

```javascript
// Naive navigation listener in main.js
webContents.on('did-navigate', (navEvent, url) => {
    logVisit(webContents.getTitle(), url);
});
```

Because this listener did not inspect the session partition of the calling `webContents`, every URL visited in private mode was dutifully written to `history.json` on disk!

Furthermore, the session persistence engine continuously serialised the workspace tabs into `session.json`:

```javascript
// Saving session without partition filtering
window.miseAPI.saveSession(state.sessionState);
```

If the user closed the browser while private mode was active, their private tabs were saved to disk and restored upon the next startup.

### C. The Remote Favicon Leak

Perhaps the most subtle leak occurred in the tab strip. When a page emitted `page-favicon-updated`, the webview module received the icon URL:

```javascript
// Host window loading private favicon
favImg.src = iconUrl;
```

Because `favImg` is a DOM element in the host application window, setting `src = iconUrl` caused Electron's default host session (completely outside `MisePrivateProfile`) to fetch the favicon from the remote server. 

Additionally, when tabs were rendered or restored, Mise called `getFaviconUrl(url)`, which queried Google's public favicon service (`https://www.google.com/s2/favicons?domain=...`) via the host window. A third-party observer or CDN could easily track private visits simply by watching the host window fetch favicons.

---

## 4. The Architectural Fix

To achieve true privacy, we had to eliminate the mutable toggle entirely and make ephemeral browsing an immutable structural guarantee.

### 1. The Permanent Private Workspace

Instead of flipping existing workspaces back and forth, we introduced a permanent, dedicated **Private** workspace:

* **Dual-Process Partition Parity**: In both `modules/utils.js` and `main.js`, `getWorkspacePartition` maps any case variation of `private` immutably to the volatile partition `MisePrivateProfile`:

```javascript
export function getWorkspacePartition(workspaceName) {
    if (!workspaceName) return 'persist:default';
    if (String(workspaceName).trim().toLowerCase() === 'private') return 'MisePrivateProfile';
    const clean = String(workspaceName).trim().toLowerCase().replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return `persist:${clean || 'default'}`;
}
```

> [!IMPORTANT]
> **The `persist:` Partition Trap**: In Electron, if the main process lacks this partition mapping, IPC handlers (such as cookie and cache wipes) default to `persist:private`. Chromium then silently creates a physical directory under `~/.config/mise-browser/Partitions/private/`, persisting cookies and logins across restarts! Both processes must resolve the partition without the `persist:` prefix to remain 100% in-memory.

* **Namespace Reservation**: Both processes enforce workspace reservation via `isReservedWorkspaceName()`. In the Workspace Dashboard (`modules/overlays/dashboard.js`), `Private` is pinned to the very top with a shield icon. Renaming or deleting it is strictly forbidden, and creating or renaming standard workspaces to `private` (case-insensitive) is rejected to eliminate namespace collisions.

### 2. Guarding Main Process History and URL Sanitisation

In `main.js`, we compute session identity once per webview and explicitly skip `logVisit`:

```javascript
const isPrivate = webContents.session === session.fromPartition('MisePrivateProfile');

webContents.on('did-navigate', (navEvent, url) => {
    if (!isPrivate) {
        logVisit(webContents.getTitle(), url);
    }
});
```

In `main/storage.js`, we introduced `isRecordableHistoryUrl()` to ensure only valid `http:` and `https:` URLs under 4,096 characters are recorded, eliminating data URIs, local file paths, and malformed strings.

### 3. Atomic Session Persistence Scrubbing and Cold Boot Protection

In `main/sessionStore.js`, before flushing session state to disk, `sanitizeSessionForDisk()` strips the `Private` workspace and all associated tab titles, sleeping states, favicons, pinned states, and dark reader flags:

```javascript
function sanitizeSessionForDisk(sessionData) {
    if (!sessionData || typeof sessionData !== 'object') return sessionData;
    const clone = JSON.parse(JSON.stringify(sessionData));
    const isPrivateWS = (k) => String(k).trim().toLowerCase() === 'private';

    for (const key of ['workspaces', 'tab_titles', 'tab_favicons', 'tab_sleep_states', 'tab_dark_reader', 'tab_pinned']) {
        if (clone[key] && typeof clone[key] === 'object') {
            for (const ws of Object.keys(clone[key])) {
                if (isPrivateWS(ws)) {
                    delete clone[key][ws];
                }
            }
        }
    }

    if (isPrivateWS(clone.current_workspace)) {
        const remaining = Object.keys(clone.workspaces || {});
        clone.current_workspace = remaining.length > 0 ? remaining[0] : 'Workspace 1';
        if (!clone.workspaces || remaining.length === 0) {
            clone.workspaces = { 'Workspace 1': ['https://duckduckgo.com'] };
        }
    }
    return clone;
}
```

* **Cold Boot Fallback**: When Mise closes while `Private` is active, `sanitizeSessionForDisk()` resets `current_workspace` to `Workspace 1`.
* **Read-Time Sanitisation & Legacy Migration**: `readCurrentSession()` passes loaded payloads through `sanitizeSessionForDisk()` on boot, and `initializeBrowser()` in `renderer.js` provides a third defence layer ensuring Mise never restores directly into Private mode. Crucially, before sanitisation occurs, `readCurrentSession()` invokes `migrateLegacyPrivateWorkspace()`. If an older session created prior to the permanent Private workspace refactor contains a persistent workspace named "Private", it is seamlessly migrated to "Private (old)" along with all tab URLs, favicons, titles, and sleep states, eliminating silent data loss for upgrading users.
When Mise closes, all trace of the Private workspace is discarded. Upon relaunch, `Private` initialises cleanly in memory.

### 4. Plugging the Favicon Leak

In `modules/webview.js`, the `page-favicon-updated` listener returns immediately if `webview.getAttribute('partition') === 'MisePrivateProfile'`.

Furthermore, when rendering tabs in `renderWorkspaceUI()`, remote Google favicon requests are strictly bypassed for private tabs, ensuring they always use the local vector globe icon.

### 5. Subtle Tokyo Night Tinting

Rather than jarring bright red alerts, the Private workspace applies a gentle, low-opacity Tokyo Night rose tint (`#f7768e`) using CSS `color-mix`:

```css
body.workspace-private {
    --bg-main: color-mix(in srgb, #f7768e 6%, #1a1b26);
    --bg-sidebar: color-mix(in srgb, #f7768e 8%, #16161e);
}

body.workspace-private #Sidebar {
    border-right: 1px solid color-mix(in srgb, #f7768e 35%, var(--border));
}

body.workspace-private #WorkspaceBadge {
    background: color-mix(in srgb, #f7768e 18%, var(--bg-sidebar));
    border-color: #f7768e;
    color: #f7768e;
}
```

This creates an immediate, unmistakable visual distinction that remains easy on the eyes during late-night research.

### 6. Ergonomic Keyboard Switching

Pressing `Ctrl + Shift + P` no longer mutates the active workspace. Instead, it acts as an instant switch:
* If you are in a persistent workspace, it remembers where you were and jumps directly to `Private`.
* If you are already in `Private`, it smoothly returns you to your previous persistent workspace.

---

## 5. Lessons Learned

1. **Process Isolation Must Be Structural, Not Modal**: Flipping flags on shared mutable objects inevitably causes state leaks. Creating an isolated, permanent workspace container provides clear architectural boundaries that cannot be accidentally bypassed.
2. **Beware the Host Window in Electron**: Untrusted content running in guest webviews can easily leak data if the host application window fetches assets (such as favicons or images) through its default session.
3. **Automate Boundary Verification**: Adding automated regression tests for session sanitisation and URL logging guarantees that future refactors cannot re-introduce silent leaks to disk.
4. **Synchronise Container Partitioning Across Processes**: In Electron, session partition mapping must be strictly consistent between renderer and main processes. A mismatch where the main process prefixes `persist:` can silently create persistent disk directories under `Partitions/`, destroying volatile in-memory isolation.

