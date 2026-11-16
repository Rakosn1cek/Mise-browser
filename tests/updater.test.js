const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const updater = require('../main/updater');

console.log('Running Mise cross-platform delta updater regression tests...');

// 1. Package configuration and publish specification
{
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    assert.equal(pkg.dependencies['electron-updater'], '^6.3.9', 'package.json must depend on electron-updater ^6.3.9');
    assert.deepEqual(
        pkg.build && pkg.build.publish,
        {
            provider: 'github',
            owner: 'Rakosn1cek',
            repo: 'Mise-browser'
        },
        'package.json build.publish must target GitHub releases for Rakosn1cek/Mise-browser'
    );
    console.log('✓ package.json electron-updater dependency and publish target verified');
}

// 2. Semantic version comparison tests
{
    assert.equal(updater.isNewerVersion('1.0.1', '1.0.0'), true, 'Patch bump must be newer');
    assert.equal(updater.isNewerVersion('1.1.0', '1.0.9'), true, 'Minor bump must be newer');
    assert.equal(updater.isNewerVersion('2.0.0', '1.99.99'), true, 'Major bump must be newer');
    assert.equal(updater.isNewerVersion('1.0.0', '1.0.0'), false, 'Identical versions must return false');
    assert.equal(updater.isNewerVersion('0.9.9', '1.0.0'), false, 'Older version must return false');
    assert.equal(updater.isNewerVersion('v1.0.1', '1.0.0'), true, 'Leading v in latest must be stripped');
    assert.equal(updater.isNewerVersion('1.0.1', 'v1.0.0'), true, 'Leading v in current must be stripped');
    assert.equal(updater.isNewerVersion('v1.0.0', 'v1.0.0'), false, 'Identical versions with v must return false');
    assert.equal(updater.isNewerVersion('1.0.0.1', '1.0.0'), true, 'Subpatch must be recognised as newer');
    assert.equal(updater.isNewerVersion('1.0', '1.0.0'), false, 'Shorter equivalent version must not be newer');
    assert.equal(updater.isNewerVersion('', '1.0.0'), false, 'Empty string must return false');
    assert.equal(updater.isNewerVersion(null, '1.0.0'), false, 'Null latest must return false');

    console.log('✓ Semantic version parsing and boundary comparisons verified');
}

// 3. getAppVersion payload structure
{
    const mockApp = { getVersion: () => '2.1.0' };
    const versionPayload = updater.getAppVersion(mockApp);

    assert.equal(versionPayload.version, '2.1.0', 'Must return mock app version');
    assert('electron' in versionPayload, 'Must include electron runtime version key');
    assert('chrome' in versionPayload, 'Must include chrome engine version key');
    assert('node' in versionPayload, 'Must include node environment version key');

    console.log('✓ Runtime version payload schema verified');
}

function createMockAutoUpdater(checkImpl) {
    const emitter = new EventEmitter();
    emitter.autoDownload = true;
    emitter.checkCalls = 0;
    emitter.downloadCalls = 0;
    emitter.quitCalls = 0;
    emitter.checkForUpdates = async () => {
        emitter.checkCalls += 1;
        return checkImpl ? checkImpl() : { updateInfo: { version: '1.0.0' } };
    };
    emitter.downloadUpdate = async () => {
        emitter.downloadCalls += 1;
    };
    emitter.quitAndInstall = () => {
        emitter.quitCalls += 1;
    };
    return emitter;
}

(async () => {
    // 4. Unpackaged environment guards
    {
        const logs = [];
        const mockDiagnostics = {
            logEvent: (level, category, message, details) => {
                logs.push({ level, category, message, details });
            }
        };
        const mockApp = { isPackaged: false, getVersion: () => '1.7.1' };
        const mockUpdater = createMockAutoUpdater(async () => ({ updateInfo: { version: '1.8.0' } }));

        updater.initAutoUpdater({
            app: mockApp,
            autoUpdater: mockUpdater,
            diagnostics: mockDiagnostics
        });

        const checkRes = await updater.checkAppUpdates(true, {
            app: mockApp,
            autoUpdater: mockUpdater,
            diagnostics: mockDiagnostics
        });
        assert.equal(checkRes.updateAvailable, false, 'Unpackaged check must not report live update');
        assert.equal(checkRes.bypassed, true, 'Unpackaged check must signal bypassed state');
        assert.equal(mockUpdater.checkCalls, 0, 'Unpackaged check must not invoke autoUpdater.checkForUpdates');

        mockUpdater.emit('update-available', { version: '1.8.0' });
        assert.equal(mockUpdater.downloadCalls, 0, 'Unpackaged update-available must bypass background download');

        const quitRes = updater.quitAndInstall({
            app: mockApp,
            autoUpdater: mockUpdater,
            diagnostics: mockDiagnostics
        });
        assert.equal(quitRes.installed, false);
        assert.equal(quitRes.bypassed, true);
        assert.equal(mockUpdater.quitCalls, 0, 'Unpackaged quitAndInstall must not invoke autoUpdater.quitAndInstall');
        assert(logs.some(l => l.category === 'updater' && l.message.toLowerCase().includes('unpackaged')), 'Must log unpackaged bypass events to diagnostics');

        console.log('✓ Unpackaged environment guards and diagnostic logging verified');
    }

    // 5. autoUpdater lifecycle events in packaged environment
    {
        const logs = [];
        const sentMessages = [];
        const mockDiagnostics = {
            logEvent: (level, category, message, details) => {
                logs.push({ level, category, message, details });
            }
        };
        const mockApp = { isPackaged: true, getVersion: () => '1.7.1' };
        const mockWindow = {
            isDestroyed: () => false,
            webContents: {
                send: (channel, payload) => {
                    sentMessages.push({ channel, payload });
                }
            }
        };
        const mockUpdater = createMockAutoUpdater(async () => ({
            updateInfo: {
                version: '1.8.0',
                releaseName: 'Mise Browser v1.8.0',
                releaseDate: '2026-11-16T12:00:00Z',
                releaseNotes: 'Delta update improvements'
            }
        }));

        const handlers = new Map();
        const mockIpcMain = {
            handle: (channel, fn) => handlers.set(channel, fn)
        };

        updater.registerUpdaterIpc(mockIpcMain, {
            app: mockApp,
            autoUpdater: mockUpdater,
            diagnostics: mockDiagnostics,
            getMainWindow: () => mockWindow
        });

        assert.equal(mockUpdater.autoDownload, false, 'initAutoUpdater must manage delta downloads explicitly');
        assert(handlers.has('get-app-version'), 'Must register get-app-version IPC handler');
        assert(handlers.has('check-for-updates'), 'Must register check-for-updates IPC handler');
        assert(handlers.has('quit-and-install'), 'Must register quit-and-install IPC handler');

        // Trigger check-for-updates IPC handler
        const checkResult = await handlers.get('check-for-updates')({}, true);
        assert.equal(mockUpdater.checkCalls, 1, 'Packaged check-for-updates must invoke autoUpdater.checkForUpdates');
        assert.equal(checkResult.updateAvailable, true, 'Must detect newer update');
        assert.equal(checkResult.latestVersion, '1.8.0');
        assert.equal(checkResult.manual, true);

        // Emit update-available -> automatically starts background delta streaming
        mockUpdater.emit('update-available', { version: '1.8.0' });
        assert.equal(mockUpdater.downloadCalls, 1, 'update-available must initiate background delta streaming');

        // Emit download-progress -> logs percentage to diagnostics
        mockUpdater.emit('download-progress', { percent: 42.67, transferred: 4267, total: 10000, bytesPerSecond: 1024 });
        assert(
            logs.some(l => l.category === 'updater' && l.message.includes('42.7%')),
            'download-progress must log rounded transfer percentage to diagnostics'
        );

        // Emit update-downloaded -> sends IPC event to main window
        mockUpdater.emit('update-downloaded', { version: '1.8.0', releaseName: 'Mise Browser v1.8.0' });
        assert.equal(sentMessages.length, 1, 'update-downloaded must notify main window via IPC');
        assert.equal(sentMessages[0].channel, 'update-downloaded');
        assert.equal(sentMessages[0].payload.version, '1.8.0');

        // Emit error -> caught cleanly without throwing and logged to diagnostics
        mockUpdater.emit('error', new Error('Checksum verification failed'));
        assert(
            logs.some(l => l.level === 'error' && l.category === 'updater' && l.message.includes('Checksum verification failed')),
            'error event must log cleanly to diagnostics without crashing'
        );

        // Trigger quit-and-install IPC handler
        const quitResult = handlers.get('quit-and-install')({});
        assert.equal(quitResult.installed, true);
        assert.equal(mockUpdater.quitCalls, 1, 'quit-and-install IPC must trigger autoUpdater.quitAndInstall');

        console.log('✓ autoUpdater lifecycle events, IPC handlers, and diagnostics verified');
    }

    // 6. Error handling during checkForUpdates
    {
        const logs = [];
        const mockDiagnostics = {
            logEvent: (level, category, message, details) => {
                logs.push({ level, category, message, details });
            }
        };
        const mockApp = { isPackaged: true, getVersion: () => '1.7.1' };
        const mockUpdater = createMockAutoUpdater(async () => {
            throw new Error('Connection refused');
        });

        const resultError = await updater.checkAppUpdates(true, {
            app: mockApp,
            autoUpdater: mockUpdater,
            diagnostics: mockDiagnostics
        });
        assert.equal(resultError.updateAvailable, false, 'Must report false on network error');
        assert.equal(resultError.error, 'Connection refused', 'Must expose error message');
        assert(logs.some(l => l.level === 'error' && l.message.includes('Connection refused')), 'Must log check error to diagnostics');

        console.log('✓ checkForUpdates rejection handling verified');
    }

    // 7. Preload bridge and Status Bar update indicator verification
    {
        const preloadSource = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
        assert(preloadSource.includes("quitAndInstall: () => ipcRenderer.invoke('quit-and-install')"), 'preload.js must expose quitAndInstall');
        assert(preloadSource.includes("onUpdateDownloaded:"), 'preload.js must expose onUpdateDownloaded');
        assert(preloadSource.includes("ipcRenderer.on('update-downloaded'"), 'preload.js must listen for update-downloaded');

        const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
        assert(indexHtml.includes('id="StatusBarUpdate"'), 'index.html must include #StatusBarUpdate badge');
        assert(indexHtml.includes('⟳ Restart to update'), 'index.html must display restart to update text inside #StatusBarUpdate');

        let onUpdateDownloadedCb = null;
        let quitInvoked = 0;
        const listeners = {};
        const updateBadgeMock = {
            style: { display: 'none' },
            innerHTML: '',
            title: '',
            tabIndex: 0,
            setAttribute() {},
            addEventListener(type, fn) {
                if (!listeners[type]) listeners[type] = [];
                listeners[type].push(fn);
            },
            click() {
                (listeners.click || []).forEach(fn => fn({ stopPropagation() {} }));
            }
        };

        const elements = {
            StatusBar: { style: {} },
            StatusBarUpdate: updateBadgeMock,
            StatusBarMode: { style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener() {} },
            StatusBarUrl: { style: {} },
            StatusBarSecurity: { style: {} },
            StatusBarPartition: { style: {}, setAttribute() {}, addEventListener() {} },
            StatusBarPermissions: { style: {}, addEventListener() {}, setAttribute() {} },
            WideAddressBar: { value: '', style: {} }
        };

        const context = {
            URL,
            escapeHtml: (s) => String(s),
            document: {
                getElementById: (id) => elements[id] || null,
                querySelector: () => null,
                querySelectorAll: () => [],
                addEventListener() {}
            },
            window: {
                addEventListener() {},
                miseAPI: {
                    onUpdateDownloaded: (cb) => {
                        onUpdateDownloadedCb = cb;
                        return () => {};
                    },
                    quitAndInstall: () => {
                        quitInvoked += 1;
                    }
                }
            },
            state: {
                globalPrivateModeActive: false,
                sessionState: { current_workspace: 'Workspace 1', workspaces: { 'Workspace 1': ['https://example.org'] } },
                activeViewsCache: { 'Workspace 1': [{}] }
            },
            getWorkspacePartition: (ws) => `persist:${ws}`,
            isSplitActive: () => false,
            getSplitState: () => ({}),
            updateDarkReaderButtonUI() {},
            isWebviewDarkReaderActive: () => false,
            updateReaderViewButtonUI() {},
            resolveWorkspaceVisual: () => null,
            isShareableQrUrl: () => true,
            showNotificationToast() {},
            setTimeout() {},
            clearTimeout() {}
        };

        vm.createContext(context);
        const statusBarSource = fs.readFileSync(path.join(__dirname, '../modules/statusBar.js'), 'utf8')
            .replace(/^import .*$/gm, '')
            .replace(/export /g, '');
        vm.runInContext(statusBarSource, context);

        context.initStatusBar();
        assert.equal(typeof onUpdateDownloadedCb, 'function', 'statusBar.js must subscribe to window.miseAPI.onUpdateDownloaded');

        onUpdateDownloadedCb({ version: '1.8.0' });
        assert.equal(updateBadgeMock.style.display, 'inline-flex', '#StatusBarUpdate must become visible when update is downloaded');
        assert(updateBadgeMock.innerHTML.includes('⟳ Restart to update'), '#StatusBarUpdate must show Restart to update pill');

        updateBadgeMock.click();
        assert.equal(quitInvoked, 1, 'Clicking #StatusBarUpdate must invoke window.miseAPI.quitAndInstall()');

        console.log('✓ Preload API bridge and status bar restart pill verified');
    }

    console.log('All cross-platform delta updater regression tests passed successfully!');
})();
