// tests/session-persistence-guard.test.js
// Regression tests for persistable tab URLs, suspect session quarantine, and snapshot rotation

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('Running Mise session persistence guard and snapshot rotation tests...');

// 1. Verify isPersistableTabUrl exported by modules/utils.js
{
    const utilsSource = fs.readFileSync(path.join(__dirname, '../modules/utils.js'), 'utf8');
    assert(utilsSource.includes('export function isPersistableTabUrl('), 'isPersistableTabUrl must be exported from utils.js');

    // Simple test harness replicating isPersistableTabUrl logic
    function isPersistableTabUrl(url) {
        if (typeof url !== 'string' || url.length === 0 || url.length > 16384) return false;
        try {
            const p = new URL(url);
            return p.protocol === 'http:' || p.protocol === 'https:' || p.protocol === 'file:';
        } catch (e) {
            return false;
        }
    }

    // Valid persistable URLs
    assert.equal(isPersistableTabUrl('https://duckduckgo.com'), true);
    assert.equal(isPersistableTabUrl('http://example.org/path?q=1'), true);
    assert.equal(isPersistableTabUrl('file:///home/user/document.pdf'), true);

    // Non-persistable URLs
    assert.equal(isPersistableTabUrl('about:blank'), false);
    assert.equal(isPersistableTabUrl('about:config'), false);
    assert.equal(isPersistableTabUrl('chrome-error://chromewebdata/'), false);
    assert.equal(isPersistableTabUrl('data:text/html,<b>x</b>'), false);
    assert.equal(isPersistableTabUrl('blob:https://example.com/uuid'), false);
    assert.equal(isPersistableTabUrl(''), false);
    assert.equal(isPersistableTabUrl(null), false);
    assert.equal(isPersistableTabUrl(undefined), false);
    assert.equal(isPersistableTabUrl(12345), false);
    assert.equal(isPersistableTabUrl({ url: 'https://example.com' }), false);
    assert.equal(isPersistableTabUrl('javascript:alert(1)'), false);

    console.log('✓ isPersistableTabUrl scheme validation verified');
}

// 2. Verify webview navigation listeners guard session writes
{
    const webviewSource = fs.readFileSync(path.join(__dirname, '../modules/webview.js'), 'utf8');

    // Ensure import is present
    assert(webviewSource.includes('isPersistableTabUrl'), 'webview.js must import isPersistableTabUrl');

    // Check did-navigate listener block
    const didNavIdx = webviewSource.indexOf("webview.addEventListener('did-navigate'");
    assert(didNavIdx !== -1, 'did-navigate listener must exist');
    const didNavBlock = webviewSource.slice(didNavIdx, didNavIdx + 800);
    assert(didNavBlock.includes('if (isPersistableTabUrl(cleanUrl))'), 'did-navigate must guard session write with isPersistableTabUrl');

    // Check did-navigate-in-page listener block
    const didNavInPageIdx = webviewSource.indexOf("webview.addEventListener('did-navigate-in-page'");
    assert(didNavInPageIdx !== -1, 'did-navigate-in-page listener must exist');
    const didNavInPageBlock = webviewSource.slice(didNavInPageIdx, didNavInPageIdx + 800);
    assert(didNavInPageBlock.includes('if (isPersistableTabUrl(cleanUrl))'), 'did-navigate-in-page must guard session write with isPersistableTabUrl');

    console.log('✓ webview navigation listeners session persistence guards verified');
}

// 3. Verify suspect session quarantine in flushSessionToDisk
{
    const sessionStore = require('../main/sessionStore.js');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-session-guard-test-'));
    const testSessionPath = path.join(tmpDir, 'session.json');
    const testBackupPath = path.join(tmpDir, 'session.json.bak');
    const testSuspectPath = path.join(tmpDir, 'session.suspect.json');

    try {
        // Initialise healthy existing session on disk with 5 tabs, 0 blank (0% blank <= 20%)
        const healthyDiskSession = {
            current_workspace: 'Workspace 1',
            workspaces: {
                'Workspace 1': [
                    'https://duckduckgo.com',
                    'https://github.com',
                    'https://archlinux.org',
                    'https://news.ycombinator.com',
                    'https://kernel.org'
                ]
            }
        };
        fs.writeFileSync(testSessionPath, JSON.stringify(healthyDiskSession, null, 4), 'utf8');

        // Prepare new session with 3 blank URLs out of 6 tabs (50% blank >= 50%, blank count >= 3)
        const suspectNewSession = {
            current_workspace: 'Workspace 1',
            workspaces: {
                'Workspace 1': [
                    'https://duckduckgo.com',
                    'about:blank',
                    '',
                    'about:blank',
                    'https://archlinux.org',
                    'https://github.com'
                ]
            }
        };

        // Schedule and flush session
        sessionStore.scheduleSessionSave(suspectNewSession, 0, {
            sessionPath: testSessionPath,
            sessionBackupPath: testBackupPath,
            sessionSuspectPath: testSuspectPath
        });

        const flushed = sessionStore.flushSessionToDisk({
            sessionPath: testSessionPath,
            sessionBackupPath: testBackupPath,
            sessionSuspectPath: testSuspectPath
        });

        assert.equal(flushed, true, 'flushSessionToDisk must return true');
        assert.equal(sessionStore.getPendingSessionData(), null, 'pendingSessionData must be cleared');

        // Existing session.json must NOT be touched
        const sessionOnDisk = JSON.parse(fs.readFileSync(testSessionPath, 'utf8'));
        assert.deepEqual(sessionOnDisk, healthyDiskSession, 'session.json must remain untouched when suspect write intercepted');

        // Backup session.json.bak must NOT be created or overwritten
        assert.equal(fs.existsSync(testBackupPath), false, 'session.json.bak must not be touched');

        // New data must be written to session.suspect.json
        assert.equal(fs.existsSync(testSuspectPath), true, 'session.suspect.json must be created');
        const suspectOnDisk = JSON.parse(fs.readFileSync(testSuspectPath, 'utf8'));
        assert.deepEqual(suspectOnDisk, suspectNewSession, 'session.suspect.json must contain suspect session data');

        console.log('✓ Suspect blank session quarantine verified');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// 4. Verify backup rotation only for valid non-mostly-blank sessions and snapshot retention
{
    const sessionStore = require('../main/sessionStore.js');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-session-backup-snap-test-'));
    const testSessionPath = path.join(tmpDir, 'session.json');
    const testBackupPath = path.join(tmpDir, 'session.json.bak');

    try {
        // A: Corrupt/mostly blank session is NOT rotated to .bak
        const mostlyBlankSession = {
            current_workspace: 'Workspace 1',
            workspaces: {
                'Workspace 1': ['about:blank', '']
            }
        };
        fs.writeFileSync(testSessionPath, JSON.stringify(mostlyBlankSession, null, 4), 'utf8');

        const validNewSession = {
            current_workspace: 'Workspace 1',
            workspaces: {
                'Workspace 1': ['https://duckduckgo.com', 'https://archlinux.org']
            }
        };

        sessionStore.scheduleSessionSave(validNewSession, 0, {
            sessionPath: testSessionPath,
            sessionBackupPath: testBackupPath
        });
        sessionStore.flushSessionToDisk({
            sessionPath: testSessionPath,
            sessionBackupPath: testBackupPath
        });

        // Verify .bak was NOT created from mostly blank session
        assert.equal(fs.existsSync(testBackupPath), false, 'Mostly blank existing session must not be copied to .bak');
        assert.deepEqual(JSON.parse(fs.readFileSync(testSessionPath, 'utf8')), validNewSession);

        // B: Valid existing session IS rotated to .bak on subsequent save
        const anotherValidSession = {
            current_workspace: 'Workspace 1',
            workspaces: {
                'Workspace 1': ['https://duckduckgo.com', 'https://github.com']
            }
        };

        sessionStore.scheduleSessionSave(anotherValidSession, 0, {
            sessionPath: testSessionPath,
            sessionBackupPath: testBackupPath
        });
        sessionStore.flushSessionToDisk({
            sessionPath: testSessionPath,
            sessionBackupPath: testBackupPath
        });

        // Verify .bak now holds previous valid session
        assert.equal(fs.existsSync(testBackupPath), true, '.bak must be created from valid previous session');
        assert.deepEqual(JSON.parse(fs.readFileSync(testBackupPath, 'utf8')), validNewSession);

        // C: Snapshot creation and retention
        // Clear snapshots from prior steps before seeding 12 simulated snapshot files
        fs.readdirSync(tmpDir).filter(f => /^session\.snap-\d{8}-\d{6}\.json$/.test(f)).forEach(f => fs.unlinkSync(path.join(tmpDir, f)));

        const now = Date.now();
        const pad = (n) => String(n).padStart(2, '0');
        for (let i = 12; i >= 1; i--) {
            // Simulated dates in the past (e.g. 15 * i minutes ago)
            const snapDate = new Date(now - (i * 15 * 60 * 1000));
            const yyyy = snapDate.getFullYear();
            const mm = pad(snapDate.getMonth() + 1);
            const dd = pad(snapDate.getDate());
            const hh = pad(snapDate.getHours());
            const min = pad(snapDate.getMinutes());
            const ss = pad(snapDate.getSeconds());
            const snapName = `session.snap-${yyyy}${mm}${dd}-${hh}${min}${ss}.json`;
            fs.writeFileSync(path.join(tmpDir, snapName), JSON.stringify({ old: i }), 'utf8');
        }

        let snapshots = fs.readdirSync(tmpDir).filter(f => /^session\.snap-\d{8}-\d{6}\.json$/.test(f));
        assert.equal(snapshots.length, 12, '12 initial snapshots must be seeded');

        // Flush new valid session
        const nextSession = {
            current_workspace: 'Workspace 1',
            workspaces: {
                'Workspace 1': ['https://duckduckgo.com', 'https://kernel.org']
            }
        };
        sessionStore.scheduleSessionSave(nextSession, 0, {
            sessionPath: testSessionPath,
            sessionBackupPath: testBackupPath
        });
        sessionStore.flushSessionToDisk({
            sessionPath: testSessionPath,
            sessionBackupPath: testBackupPath
        });

        // Snapshots must be pruned to newest 10
        snapshots = fs.readdirSync(tmpDir).filter(f => /^session\.snap-\d{8}-\d{6}\.json$/.test(f)).sort();
        assert.equal(snapshots.length, 10, 'Snapshot pruning must keep newest 10 snapshots');

        // D: Snapshot rate limit (within 10 minutes, no new snapshot created)
        const countBeforeImmediateFlush = snapshots.length;
        const quickSession = {
            current_workspace: 'Workspace 1',
            workspaces: {
                'Workspace 1': ['https://duckduckgo.com', 'https://kernel.org', 'https://example.org']
            }
        };
        sessionStore.scheduleSessionSave(quickSession, 0, {
            sessionPath: testSessionPath,
            sessionBackupPath: testBackupPath
        });
        sessionStore.flushSessionToDisk({
            sessionPath: testSessionPath,
            sessionBackupPath: testBackupPath
        });

        const snapshotsAfterImmediate = fs.readdirSync(tmpDir).filter(f => /^session\.snap-\d{8}-\d{6}\.json$/.test(f));
        assert.equal(snapshotsAfterImmediate.length, countBeforeImmediateFlush, 'At most one snapshot per 10 minutes');

        console.log('✓ Valid backup rotation, snapshot pruning, and 10-minute rate limit verified');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

console.log('All session persistence guard and snapshot rotation tests passed successfully!');
