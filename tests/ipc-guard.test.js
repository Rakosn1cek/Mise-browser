// tests/ipc-guard.test.js
// Automated regression tests for IPC guard sender verification and channel isolation

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { installIpcGuard, GUEST_CHANNELS, isFromHost } = require('../main/ipcGuard');

console.log('Running Mise IPC guard regression tests...');

function createFakeIpcMain() {
    const handlers = new Map();
    const listeners = new Map();

    return {
        handlers,
        listeners,
        handle(channel, fn) {
            handlers.set(channel, fn);
        },
        handleOnce(channel, fn) {
            handlers.set(channel, fn);
        },
        on(channel, fn) {
            if (!listeners.has(channel)) listeners.set(channel, []);
            listeners.get(channel).push(fn);
            return this;
        },
        once(channel, fn) {
            if (!listeners.has(channel)) listeners.set(channel, []);
            listeners.get(channel).push(fn);
            return this;
        },
        invoke(channel, event, ...args) {
            const fn = handlers.get(channel);
            if (!fn) throw new Error(`No handler registered for ${channel}`);
            return fn.call(this, event, ...args);
        },
        send(channel, event, ...args) {
            const list = listeners.get(channel) || [];
            for (const fn of list) {
                fn.call(this, event, ...args);
            }
        }
    };
}

function createMockEnvironment() {
    const hostMainFrame = { id: 'host-main-frame' };
    const hostWebContents = { id: 1, mainFrame: hostMainFrame };
    const guestMainFrame = { id: 'guest-main-frame' };
    const guestWebContents = { id: 2, mainFrame: guestMainFrame };

    let mainWindow = {
        isDestroyed: () => false,
        webContents: hostWebContents
    };

    return {
        hostMainFrame,
        hostWebContents,
        guestMainFrame,
        guestWebContents,
        getMainWindow: () => mainWindow,
        setMainWindow: (win) => { mainWindow = win; }
    };
}

// 1. Host event allowed, other sender denied, guest channel allowed from guest sender
{
    const env = createMockEnvironment();
    const ipcMain = createFakeIpcMain();

    installIpcGuard(ipcMain, {
        getMainWindow: env.getMainWindow,
        guestChannels: GUEST_CHANNELS,
        mode: 'enforce'
    });

    let hostHandleInvoked = false;
    ipcMain.handle('secure-host-invoke', (event, data) => {
        hostHandleInvoked = true;
        return `echo:${data}`;
    });

    let hostOnInvoked = false;
    ipcMain.on('secure-host-send', (event, val) => {
        hostOnInvoked = true;
        event.returnValue = val * 2;
    });

    let guestHandleInvoked = false;
    ipcMain.handle('read-pdf-data', (event, payload) => {
        guestHandleInvoked = true;
        return { pdf: payload.url };
    });

    let guestOnInvoked = false;
    ipcMain.on('is-trusted-domain', (event, domain) => {
        guestOnInvoked = true;
        event.returnValue = (domain === 'example.com');
    });

    let adblockerHandleInvoked = false;
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url) => {
        adblockerHandleInvoked = true;
        return { active: true, url };
    });

    // Host caller on host channels: allowed
    const hostEvent = {
        sender: env.hostWebContents,
        senderFrame: env.hostMainFrame
    };
    const invokeRes = ipcMain.invoke('secure-host-invoke', hostEvent, 'hello');
    assert.strictEqual(invokeRes, 'echo:hello');
    assert.strictEqual(hostHandleInvoked, true);

    const syncHostEvent = {
        sender: env.hostWebContents,
        senderFrame: env.hostMainFrame,
        returnValue: undefined
    };
    ipcMain.send('secure-host-send', syncHostEvent, 5);
    assert.strictEqual(hostOnInvoked, true);
    assert.strictEqual(syncHostEvent.returnValue, 10);

    // Guest caller on host channels: denied
    const guestEvent = {
        sender: env.guestWebContents,
        senderFrame: env.guestMainFrame
    };
    assert.throws(() => {
        ipcMain.invoke('secure-host-invoke', guestEvent, 'exploit');
    }, /Forbidden/);

    const syncGuestEvent = {
        sender: env.guestWebContents,
        senderFrame: env.guestMainFrame,
        returnValue: undefined
    };
    hostOnInvoked = false;
    ipcMain.send('secure-host-send', syncGuestEvent, 7);
    assert.strictEqual(hostOnInvoked, false, 'Denied listener must not be called');
    assert.strictEqual(syncGuestEvent.returnValue, null, 'Denied sync call must set returnValue to null');

    // Guest caller on guest channels: allowed
    const guestCallRes = ipcMain.invoke('read-pdf-data', guestEvent, { url: 'file:///doc.pdf' });
    assert.strictEqual(guestHandleInvoked, true);
    assert.deepStrictEqual(guestCallRes, { pdf: 'file:///doc.pdf' });

    const guestSyncEvent = {
        sender: env.guestWebContents,
        senderFrame: env.guestMainFrame,
        returnValue: undefined
    };
    ipcMain.send('is-trusted-domain', guestSyncEvent, 'example.com');
    assert.strictEqual(guestOnInvoked, true);
    assert.strictEqual(guestSyncEvent.returnValue, true);

    const adblockerRes = ipcMain.invoke('@ghostery/adblocker/inject-cosmetic-filters', guestEvent, 'https://example.com');
    assert.strictEqual(adblockerHandleInvoked, true);
    assert.deepStrictEqual(adblockerRes, { active: true, url: 'https://example.com' });

    console.log('✓ Host event allowed, guest denied on host channels, guest channel allowed from guest sender');
}

// 2. Missing or destroyed main window, senderFrame mismatch, and null senderFrame deny
{
    const env = createMockEnvironment();
    const ipcMain = createFakeIpcMain();

    installIpcGuard(ipcMain, {
        getMainWindow: env.getMainWindow,
        guestChannels: GUEST_CHANNELS,
        mode: 'enforce'
    });

    ipcMain.handle('test-isolation', () => 'ok');
    ipcMain.on('test-sync-isolation', (event) => {
        event.returnValue = 'success';
    });

    // Missing main window
    env.setMainWindow(null);
    const validHostEvent = {
        sender: env.hostWebContents,
        senderFrame: env.hostMainFrame
    };
    assert.throws(() => ipcMain.invoke('test-isolation', validHostEvent), /Forbidden/);
    const syncEventMissing = { sender: env.hostWebContents, senderFrame: env.hostMainFrame, returnValue: 'orig' };
    ipcMain.send('test-sync-isolation', syncEventMissing);
    assert.strictEqual(syncEventMissing.returnValue, null);

    // Destroyed main window
    env.setMainWindow({
        isDestroyed: () => true,
        webContents: env.hostWebContents
    });
    assert.throws(() => ipcMain.invoke('test-isolation', validHostEvent), /Forbidden/);
    const syncEventDestroyed = { sender: env.hostWebContents, senderFrame: env.hostMainFrame, returnValue: 'orig' };
    ipcMain.send('test-sync-isolation', syncEventDestroyed);
    assert.strictEqual(syncEventDestroyed.returnValue, null);

    // Restore active main window
    env.setMainWindow({
        isDestroyed: () => false,
        webContents: env.hostWebContents
    });

    // SenderFrame mismatch (e.g. untrusted child frame)
    const mismatchedFrameEvent = {
        sender: env.hostWebContents,
        senderFrame: { id: 'untrusted-iframe' }
    };
    assert.throws(() => ipcMain.invoke('test-isolation', mismatchedFrameEvent), /Forbidden/);
    const syncEventMismatch = { ...mismatchedFrameEvent, returnValue: 'orig' };
    ipcMain.send('test-sync-isolation', syncEventMismatch);
    assert.strictEqual(syncEventMismatch.returnValue, null);

    // Explicit null senderFrame
    const nullFrameEvent = {
        sender: env.hostWebContents,
        senderFrame: null
    };
    assert.throws(() => ipcMain.invoke('test-isolation', nullFrameEvent), /Forbidden/);
    const syncEventNullFrame = { ...nullFrameEvent, returnValue: 'orig' };
    ipcMain.send('test-sync-isolation', syncEventNullFrame);
    assert.strictEqual(syncEventNullFrame.returnValue, null);

    // Absent senderFrame (undefined) passes
    const absentFrameEvent = {
        sender: env.hostWebContents
    };
    assert.strictEqual(ipcMain.invoke('test-isolation', absentFrameEvent), 'ok');

    // Matching mainFrame passes
    const matchingFrameEvent = {
        sender: env.hostWebContents,
        senderFrame: env.hostMainFrame
    };
    assert.strictEqual(ipcMain.invoke('test-isolation', matchingFrameEvent), 'ok');

    console.log('✓ Missing/destroyed window, frame mismatch, and null frame deny; absent/matching frames pass');
}

// 3. 'warn' mode allows but warns with channel name only
{
    const env = createMockEnvironment();
    const ipcMain = createFakeIpcMain();

    installIpcGuard(ipcMain, {
        getMainWindow: env.getMainWindow,
        guestChannels: GUEST_CHANNELS,
        mode: 'warn'
    });

    let handleExecuted = false;
    ipcMain.handle('warn-test-handle', (event, arg) => {
        handleExecuted = true;
        return `handled:${arg}`;
    });

    let onExecuted = false;
    ipcMain.on('warn-test-on', (event, arg) => {
        onExecuted = true;
        event.returnValue = `on:${arg}`;
    });

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => {
        warnings.push(args);
    };

    try {
        const guestEvent = {
            sender: env.guestWebContents,
            senderFrame: env.guestMainFrame
        };

        const handleRes = ipcMain.invoke('warn-test-handle', guestEvent, 'test1');
        assert.strictEqual(handleExecuted, true);
        assert.strictEqual(handleRes, 'handled:test1');

        const onEvent = {
            sender: env.guestWebContents,
            senderFrame: env.guestMainFrame,
            returnValue: undefined
        };
        ipcMain.send('warn-test-on', onEvent, 'test2');
        assert.strictEqual(onExecuted, true);
        assert.strictEqual(onEvent.returnValue, 'on:test2');

        assert.strictEqual(warnings.length, 2);
        assert.deepStrictEqual(warnings[0], ['[ipc-guard] would deny', 'warn-test-handle']);
        assert.deepStrictEqual(warnings[1], ['[ipc-guard] would deny', 'warn-test-on']);
    } finally {
        console.warn = origWarn;
    }

    // Verify mode via environment variable process.env.MISE_IPC_GUARD === 'warn'
    const ipcMainEnv = createFakeIpcMain();
    process.env.MISE_IPC_GUARD = 'warn';

    installIpcGuard(ipcMainEnv, {
        getMainWindow: env.getMainWindow,
        guestChannels: GUEST_CHANNELS
    });

    ipcMainEnv.handle('env-warn-channel', () => 'env-ok');

    const envWarnings = [];
    console.warn = (...args) => { envWarnings.push(args); };
    try {
        const guestEvent = {
            sender: env.guestWebContents,
            senderFrame: env.guestMainFrame
        };
        const envRes = ipcMainEnv.invoke('env-warn-channel', guestEvent);
        assert.strictEqual(envRes, 'env-ok');
        assert.strictEqual(envWarnings.length, 1);
        assert.deepStrictEqual(envWarnings[0], ['[ipc-guard] would deny', 'env-warn-channel']);
    } finally {
        console.warn = origWarn;
        delete process.env.MISE_IPC_GUARD;
    }

    console.log('✓ Warn mode allows invocation and logs channel name warning only');
}

// 4. Return values, arguments, and 'this' pass through unchanged
{
    const env = createMockEnvironment();
    const ipcMain = createFakeIpcMain();

    installIpcGuard(ipcMain, {
        getMainWindow: env.getMainWindow,
        guestChannels: GUEST_CHANNELS,
        mode: 'enforce'
    });

    let capturedContext = null;
    let capturedArgs = null;

    ipcMain.handle('passthrough-handle', function(event, a, b, c) {
        capturedContext = this;
        capturedArgs = [a, b, c];
        return a + b + c;
    });

    const hostEvent = {
        sender: env.hostWebContents,
        senderFrame: env.hostMainFrame
    };

    const customContext = { testId: 'custom-context' };
    const fn = ipcMain.handlers.get('passthrough-handle');
    const result = fn.call(customContext, hostEvent, 10, 20, 30);

    assert.strictEqual(result, 60);
    assert.deepStrictEqual(capturedArgs, [10, 20, 30]);
    assert.strictEqual(capturedContext, customContext);

    // Async handler preservation
    ipcMain.handle('async-handle', async (event, val) => {
        return Promise.resolve(`async-${val}`);
    });
    const asyncFn = ipcMain.handlers.get('async-handle');
    const promiseResult = asyncFn(hostEvent, 'done');
    assert(promiseResult instanceof Promise, 'Handler must preserve Promise return');
    promiseResult.then(resolvedVal => {
        assert.strictEqual(resolvedVal, 'async-done');
    });

    // Single wrap verification: calling installIpcGuard again does not re-wrap
    const wrappedHandle = ipcMain.handle;
    installIpcGuard(ipcMain, {
        getMainWindow: env.getMainWindow,
        guestChannels: GUEST_CHANNELS
    });
    assert.strictEqual(ipcMain.handle, wrappedHandle, 'installIpcGuard must wrap only once');

    console.log('✓ Arguments, return values, context, and single-wrap protection verified');
}

// 5. Consistency test: webview-preload.js channels match GUEST_CHANNELS
{
    const preloadPath = path.join(__dirname, '..', 'webview-preload.js');
    const preloadSource = fs.readFileSync(preloadPath, 'utf8');

    const channelRegex = /ipcRenderer\.(?:invoke|send|sendSync)\s*\(\s*["']([^"']+)["']/g;
    const extractedChannels = new Set();
    let match;

    while ((match = channelRegex.exec(preloadSource)) !== null) {
        extractedChannels.add(match[1]);
    }

    assert(extractedChannels.size > 0, 'Must extract at least one channel from webview-preload.js');

    const guestSet = new Set(GUEST_CHANNELS);
    for (const channel of extractedChannels) {
        assert(
            guestSet.has(channel),
            `Channel "${channel}" called in webview-preload.js must be in GUEST_CHANNELS`
        );
    }

    console.log(`✓ Preload consistency: all ${extractedChannels.size} guest channels registered in GUEST_CHANNELS`);
}

console.log('All Mise IPC guard regression tests passed successfully!');
