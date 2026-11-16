// tests/updater-startup.test.js
// Verification for background delta update checks on startup in main process

const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const updater = require('../main/updater');

console.log('Running Mise startup background updater regression tests...');

// 1. Verify windowManager.js initialises autoUpdater and invokes updater.checkAppUpdates without unbound reference
{
    const windowManagerPath = path.join(__dirname, '../main/windowManager.js');
    const targetSource = fs.existsSync(windowManagerPath)
        ? fs.readFileSync(windowManagerPath, 'utf8')
        : fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

    const unboundMatches = targetSource.match(/(?<!updater\.)checkAppUpdates\s*\(/g);
    assert.equal(
        unboundMatches,
        null,
        'windowManager.js must not invoke unbound checkAppUpdates() reference'
    );

    assert(
        targetSource.includes('updater.initAutoUpdater('),
        'windowManager.js must initialise autoUpdater via updater.initAutoUpdater'
    );

    assert(
        targetSource.includes('await updater.checkAppUpdates(false)'),
        'windowManager.js must invoke updater.checkAppUpdates(false) via imported updater module'
    );

    console.log('✓ windowManager.js startup updater invocation and scope resolution verified');
}

function createStartupMockUpdater(checkHandler) {
    const emitter = new EventEmitter();
    emitter.checkCalls = 0;
    emitter.checkForUpdates = async () => {
        emitter.checkCalls += 1;
        return checkHandler();
    };
    emitter.downloadUpdate = async () => {};
    emitter.quitAndInstall = () => {};
    return emitter;
}

// 2. Functional verification of startup background update dispatch logic
(async () => {
    // Case A: Packaged environment with available update dispatches message to mainWindow
    {
        const sentMessages = [];
        const mockMainWindow = {
            isDestroyed: () => false,
            webContents: {
                send: (channel, payload) => {
                    sentMessages.push({ channel, payload });
                }
            }
        };

        const mockUpdater = createStartupMockUpdater(async () => ({
            updateInfo: {
                version: '2.0.0',
                releaseName: 'Mise Browser v2.0.0'
            }
        }));

        const updateInfo = await updater.checkAppUpdates(false, {
            app: { isPackaged: true, getVersion: () => '1.0.0' },
            autoUpdater: mockUpdater,
            diagnostics: { logEvent() {} },
            getMainWindow: () => mockMainWindow
        });

        if (updateInfo && updateInfo.updateAvailable && mockMainWindow && !mockMainWindow.isDestroyed()) {
            mockMainWindow.webContents.send('update-available', updateInfo);
        }

        assert.equal(mockUpdater.checkCalls, 1);
        assert.equal(sentMessages.length, 1, 'Must dispatch update-available when newer version exists');
        assert.equal(sentMessages[0].channel, 'update-available');
        assert.equal(sentMessages[0].payload.updateAvailable, true);
        assert.equal(sentMessages[0].payload.latestVersion, '2.0.0');
    }

    // Case B: Packaged environment already on latest version does not dispatch notification
    {
        const sentMessages = [];
        const mockMainWindow = {
            isDestroyed: () => false,
            webContents: {
                send: (channel, payload) => {
                    sentMessages.push({ channel, payload });
                }
            }
        };

        const mockUpdater = createStartupMockUpdater(async () => ({
            updateInfo: {
                version: '1.0.0',
                releaseName: 'Mise Browser v1.0.0'
            }
        }));

        const updateInfo = await updater.checkAppUpdates(false, {
            app: { isPackaged: true, getVersion: () => '1.0.0' },
            autoUpdater: mockUpdater,
            diagnostics: { logEvent() {} },
            getMainWindow: () => mockMainWindow
        });

        if (updateInfo && updateInfo.updateAvailable && mockMainWindow && !mockMainWindow.isDestroyed()) {
            mockMainWindow.webContents.send('update-available', updateInfo);
        }

        assert.equal(mockUpdater.checkCalls, 1);
        assert.equal(sentMessages.length, 0, 'Must not dispatch update-available when version is current');
    }

    // Case C: Unpackaged environment bypasses live check and logs diagnostic event
    {
        const loggedEvents = [];
        const mockUpdater = createStartupMockUpdater(async () => ({
            updateInfo: { version: '2.0.0' }
        }));

        const updateInfo = await updater.checkAppUpdates(false, {
            app: { isPackaged: false, getVersion: () => '1.0.0' },
            autoUpdater: mockUpdater,
            diagnostics: {
                logEvent: (level, category, message) => loggedEvents.push({ level, category, message })
            }
        });

        assert.equal(mockUpdater.checkCalls, 0, 'Must bypass autoUpdater.checkForUpdates when unpackaged');
        assert.equal(updateInfo.updateAvailable, false);
        assert.equal(updateInfo.bypassed, true);
        assert(loggedEvents.some(e => e.category === 'updater'), 'Must log unpackaged bypass event');
    }

    // Case D: Graceful handling of network failure without uncaught error
    {
        let caughtError = null;
        const loggedEvents = [];
        try {
            const mockUpdater = createStartupMockUpdater(async () => {
                throw new Error('Network timeout');
            });

            const updateInfo = await updater.checkAppUpdates(false, {
                app: { isPackaged: true, getVersion: () => '1.0.0' },
                autoUpdater: mockUpdater,
                diagnostics: {
                    logEvent: (level, category, message) => loggedEvents.push({ level, category, message })
                }
            });

            assert.equal(updateInfo.updateAvailable, false, 'updateAvailable must be false on failure');
            assert.equal(updateInfo.error, 'Network timeout', 'Error message must be captured gracefully');
            assert(loggedEvents.some(e => e.level === 'error' && e.category === 'updater'), 'Error must be logged to diagnostics');
        } catch (err) {
            caughtError = err;
        }

        assert.equal(caughtError, null, 'Background update check must handle errors safely');
    }

    console.log('✓ Startup background update check dispatch logic, unpackaged guard, and error handling verified');
    console.log('All startup background updater regression tests passed successfully!');
})();
