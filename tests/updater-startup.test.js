// tests/updater-startup.test.js
// Verification for background update checks on startup in main process

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const updater = require('../main/updater');

console.log('Running Mise startup background updater regression tests...');

// 1. Verify main.js invokes updater.checkAppUpdates without unbound reference
{
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

    // Ensure there is no unbound checkAppUpdates call in main.js
    const unboundMatches = mainSource.match(/(?<!updater\.)checkAppUpdates\s*\(/g);
    assert.equal(
        unboundMatches,
        null,
        'main.js must not invoke unbound checkAppUpdates() reference'
    );

    // Verify main.js calls updater.checkAppUpdates(false) in background startup check
    assert(
        mainSource.includes('await updater.checkAppUpdates(false)'),
        'main.js must invoke updater.checkAppUpdates(false) via imported updater module'
    );

    console.log('✓ main.js startup updater invocation and scope resolution verified');
}

// 2. Functional verification of startup background update dispatch logic
(async () => {
    // Case A: Update available dispatches message to mainWindow
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

        const mockFetchAvailable = async () => ({
            tag_name: 'v2.0.0',
            name: 'Mise Browser v2.0.0',
            html_url: 'https://github.com/Rakosn1cek/Mise-browser/releases/tag/v2.0.0'
        });

        const updateInfo = await updater.checkAppUpdates(false, {
            app: { getVersion: () => '1.0.0' },
            fetchLatestRelease: mockFetchAvailable
        });

        if (updateInfo && updateInfo.updateAvailable && mockMainWindow && !mockMainWindow.isDestroyed()) {
            mockMainWindow.webContents.send('update-available', updateInfo);
        }

        assert.equal(sentMessages.length, 1, 'Must dispatch update-available when newer version exists');
        assert.equal(sentMessages[0].channel, 'update-available');
        assert.equal(sentMessages[0].payload.updateAvailable, true);
        assert.equal(sentMessages[0].payload.latestVersion, 'v2.0.0');
    }

    // Case B: No update available does not dispatch notification
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

        const mockFetchUpToDate = async () => ({
            tag_name: 'v1.0.0',
            name: 'Mise Browser v1.0.0',
            html_url: 'https://github.com/Rakosn1cek/Mise-browser/releases/tag/v1.0.0'
        });

        const updateInfo = await updater.checkAppUpdates(false, {
            app: { getVersion: () => '1.0.0' },
            fetchLatestRelease: mockFetchUpToDate
        });

        if (updateInfo && updateInfo.updateAvailable && mockMainWindow && !mockMainWindow.isDestroyed()) {
            mockMainWindow.webContents.send('update-available', updateInfo);
        }

        assert.equal(sentMessages.length, 0, 'Must not dispatch update-available when version is current');
    }

    // Case C: Graceful handling of network failure without uncaught error
    {
        let caughtError = null;
        try {
            const mockFetchReject = async () => {
                throw new Error('Network timeout');
            };

            const updateInfo = await updater.checkAppUpdates(false, {
                app: { getVersion: () => '1.0.0' },
                fetchLatestRelease: mockFetchReject
            });

            assert.equal(updateInfo.updateAvailable, false, 'UpdateAvailable must be false on failure');
            assert.equal(updateInfo.error, 'Network timeout', 'Error message must be captured gracefully');
        } catch (err) {
            caughtError = err;
        }

        assert.equal(caughtError, null, 'Background update check must handle errors safely');
    }

    console.log('✓ Startup background update check dispatch logic and error handling verified');
    console.log('All startup background updater regression tests passed successfully!');
})();
