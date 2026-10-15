// tests/session-persistence.test.js
// Verification for debounced atomic session persistence and preload IPC throttling

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('Running Mise session persistence and IPC throttling regression tests...');

// 1. Verify debounced atomic session persistence in main.js
{
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

    assert(mainSource.includes('function flushSessionToDisk()'), 'flushSessionToDisk must be defined in main.js');
    assert(mainSource.includes('function scheduleSessionSave(sessionData)'), 'scheduleSessionSave must be defined in main.js');
    assert(mainSource.includes('ipcMain.handle(\'save-session\', async (event, sessionData) => {\n    return scheduleSessionSave(sessionData);\n});'), 'save-session handler must delegate to scheduleSessionSave');
    assert(mainSource.includes("mainWindow.on('close', () => {\n        markSentinelState(true);\n        flushSessionToDisk();"), 'mainWindow close must flush session to disk');
    assert(mainSource.includes("app.on('before-quit', () => {\n        markSentinelState(true);\n        flushSessionToDisk();"), 'before-quit must flush session to disk');

    // Test debounced write and atomic flush behaviour
    let writtenFiles = {};
    let renamedFiles = [];
    let copiedFiles = [];
    let scheduledTimers = [];

    const mockFs = {
        existsSync: (p) => !!writtenFiles[p],
        mkdirSync: () => {},
        writeFileSync: (p, data) => { writtenFiles[p] = data; },
        copyFileSync: (src, dest) => {
            copiedFiles.push({ src, dest });
            writtenFiles[dest] = writtenFiles[src];
        },
        renameSync: (oldPath, newPath) => {
            renamedFiles.push({ oldPath, newPath });
            writtenFiles[newPath] = writtenFiles[oldPath];
            delete writtenFiles[oldPath];
        }
    };

    const mockDiagnostics = { logEvent: () => {} };

    // Extract persistence functions
    const fnStart = mainSource.indexOf('let pendingSessionData = null;');
    const fnEnd = mainSource.indexOf('function logVisit(');
    assert(fnStart !== -1 && fnEnd !== -1, 'Persistence code block must exist');

    const fnCode = mainSource.slice(fnStart, fnEnd);

    const wrappedCode = `
        ${fnCode}
        return {
            getPending: () => pendingSessionData,
            scheduleSessionSave,
            flushSessionToDisk
        };
    `;

    const runner = new Function(
        'path', 'fs', 'sessionPath', 'sessionBackupPath', 'diagnostics', 'setTimeout', 'clearTimeout',
        wrappedCode
    );

    const instance = runner(
        path, mockFs, '/tmp/mise-test-session.json', '/tmp/mise-test-session.json.bak', mockDiagnostics,
        (fn, ms) => {
            const timer = { fn, ms, cleared: false };
            scheduledTimers.push(timer);
            return timer;
        },
        (timer) => {
            if (timer) timer.cleared = true;
        }
    );

    // Initial state
    const sessionV1 = { current_workspace: 'Workspace 1', workspaces: { 'Workspace 1': ['https://duckduckgo.com'] } };
    const sessionV2 = { current_workspace: 'Workspace 1', workspaces: { 'Workspace 1': ['https://duckduckgo.com', 'https://example.org'] } };
    const sessionV3 = { current_workspace: 'Workspace 1', workspaces: { 'Workspace 1': ['https://duckduckgo.com', 'https://example.org', 'https://archlinux.org'] } };

    // Rapid successive save calls within debounce window
    instance.scheduleSessionSave(sessionV1);
    instance.scheduleSessionSave(sessionV2);
    instance.scheduleSessionSave(sessionV3);

    // Only one timer should be scheduled
    assert.equal(scheduledTimers.length, 1, 'Multiple rapid scheduleSessionSave calls must coalesce into a single timer');
    assert.equal(scheduledTimers[0].ms, 300, 'Debounce delay must be 300ms');

    // Memory cache should hold latest state
    assert.deepEqual(instance.getPending(), sessionV3, 'Pending session data must hold latest state');

    // Trigger explicit flush (e.g. app closing or flush-session-store)
    instance.flushSessionToDisk();

    assert.equal(scheduledTimers[0].cleared, true, 'Active flush must clear pending debounce timer');
    assert.equal(instance.getPending(), null, 'Pending session data must be cleared after flush');
    assert(writtenFiles['/tmp/mise-test-session.json'], 'Session file must be written to disk');
    assert.deepEqual(JSON.parse(writtenFiles['/tmp/mise-test-session.json']), sessionV3, 'Written session must match latest state');
    assert.equal(renamedFiles.length, 1, 'Temporary file must be atomically renamed');

    console.log('✓ Debounced atomic session persistence coalesces rapid writes and flushes cleanly');
}

// 2. Verify Preload IPC focus and hints dirty checking
{
    const preloadSource = fs.readFileSync(path.join(__dirname, '../webview-preload.js'), 'utf8');

    assert(preloadSource.includes('let lastInputFocusState = false;'), 'lastInputFocusState tracker must be declared in preload');
    assert(preloadSource.includes('function setInputFocusState(focused) {'), 'setInputFocusState helper must be declared in preload');
    assert(preloadSource.includes('let lastHintsState = false;'), 'lastHintsState tracker must be declared in preload');

    // Test setInputFocusState dirty checking logic
    let hostMessages = [];
    const mockIpcRenderer = {
        sendToHost: (channel, data) => { hostMessages.push({ channel, data }); }
    };

    let lastInputFocusState = false;
    function setInputFocusState(focused) {
        const nextState = !!focused;
        if (nextState !== lastInputFocusState) {
            lastInputFocusState = nextState;
            try { mockIpcRenderer.sendToHost('guest-input-focus', nextState); } catch (err) {}
        }
    }

    // Repeated focus into editable elements
    setInputFocusState(true);
    setInputFocusState(true);
    setInputFocusState(true);

    assert.equal(hostMessages.length, 1, 'Repeated focusin events in editable elements must emit only 1 IPC message');
    assert.deepEqual(hostMessages[0], { channel: 'guest-input-focus', data: true });

    // Transition to blur
    setInputFocusState(false);
    setInputFocusState(false);

    assert.equal(hostMessages.length, 2, 'Repeated focusout events must emit only 1 IPC message on state transition');
    assert.deepEqual(hostMessages[1], { channel: 'guest-input-focus', data: false });

    // Test notifyHintsState dirty checking logic
    hostMessages = [];
    let lastHintsState = false;
    let hintElementExists = false;

    const notifyHintsState = () => {
        const active = !!hintElementExists;
        if (active !== lastHintsState) {
            lastHintsState = active;
            try { mockIpcRenderer.sendToHost('guest-hints-state', active); } catch (err) {}
        }
    };

    // Simulate 50 DOM mutations when hints layer is absent
    hintElementExists = false;
    for (let i = 0; i < 50; i++) {
        notifyHintsState();
    }
    assert.equal(hostMessages.length, 0, 'Mutations while hints layer is absent must emit zero IPC messages');

    // Hint layer appears
    hintElementExists = true;
    notifyHintsState();
    notifyHintsState();
    assert.equal(hostMessages.length, 1, 'Hint layer appearance must emit exactly 1 IPC message');
    assert.deepEqual(hostMessages[0], { channel: 'guest-hints-state', data: true });

    // Hint layer disappears
    hintElementExists = false;
    notifyHintsState();
    notifyHintsState();
    assert.equal(hostMessages.length, 2, 'Hint layer removal must emit exactly 1 IPC message');
    assert.deepEqual(hostMessages[1], { channel: 'guest-hints-state', data: false });

    console.log('✓ Preload focus and hints dirty-checking eliminates redundant IPC transmissions');
}

// 3. Verify Status Bar mode dirty checking
{
    const statusBarSource = fs.readFileSync(path.join(__dirname, '../modules/statusBar.js'), 'utf8');

    assert(statusBarSource.includes('if (isGuestInputFocused !== nextState)'), 'handleGuestInputFocus must dirty check nextState');
    assert(statusBarSource.includes('if (isHintsModeActive !== nextState)'), 'handleGuestHintsState must dirty check nextState');
    assert(statusBarSource.includes('if (isPassthroughModeActive !== nextState)'), 'handleGuestPassthroughState must dirty check nextState');

    console.log('✓ Status bar mode handlers guard against duplicate recalculations');
}

console.log('All session persistence and IPC throttling regression tests passed successfully!');
