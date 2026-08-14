// security.js
// Decoupled security configuration module for the Mise browser

const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

let blockerInstance = null;
let ipcInitialized = false;

// Define a permanent location for the compiled adblocker cache file
const CACHE_PATH = path.join(app.getPath('userData'), 'adblock_cache.bin');

// Known IPC channels registered internally by @ghostery/adblocker-electron
const GHOSTERY_IPC_CHANNELS = [
    '@ghostery/adblocker/inject-cosmetic-filters',
    '@ghostery/adblocker/is-mutation-observer-enabled',
    '@ghostery/adblocker/cosmetic-filters'
];

async function initialiseAdblocker(targetSession) {
    if (!blockerInstance) {
        try {
            if (fs.existsSync(CACHE_PATH)) {
                try {
                    const buffer = fs.readFileSync(CACHE_PATH);
                    blockerInstance = ElectronBlocker.deserialize(buffer);
                } catch (deserializeErr) {
                    // Cache file is corrupt or engine version mismatched; purge and rebuild
                    console.warn('Adblocker cache version mismatch or corrupted file. Rebuilding cache...');
                    if (fs.existsSync(CACHE_PATH)) {
                        fs.unlinkSync(CACHE_PATH);
                    }
                    blockerInstance = await ElectronBlocker.fromPrebuiltAdsAndTracking();
                    const buffer = blockerInstance.serialize();
                    fs.writeFileSync(CACHE_PATH, buffer);
                }
            } else {
                blockerInstance = await ElectronBlocker.fromPrebuiltAdsAndTracking();
                const buffer = blockerInstance.serialize();
                fs.writeFileSync(CACHE_PATH, buffer);
            }
        } catch (err) {
            console.error('Failed to instantiate network filters:', err);
            return;
        }
    }

    try {
        blockerInstance.updateFromDiff({
            added: [
                // '@@||youtube.com/youtubei/v1/log_event',
                'youtube.com#@#+js()'
            ]
        });
    } catch (err) {
        console.warn('Failed to apply adblocker exception rules:', err);
    }

    try {
        if (ipcInitialized) {
            GHOSTERY_IPC_CHANNELS.forEach(channel => {
                ipcMain.removeHandler(channel);
            });
        }

        blockerInstance.enableBlockingInSession(targetSession);
        ipcInitialized = true;
    } catch (err) {
        console.error('Failed to attach network filters to session:', err);
    }
}

function hardenSession(targetSession) {
    // Enforce UK English spellchecking
    targetSession.setSpellCheckerLanguages(['en-GB']);

    // Trigger the dynamic tracking rule engine injection
    initialiseAdblocker(targetSession);

    const blockedPermissions = ['media', 'geolocation', 'notifications', 'midiSysex', 'audio', 'video'];

    targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (blockedPermissions.includes(permission)) {
            return callback(false);
        }
        callback(true);
    });

    targetSession.setPermissionCheckHandler((webContents, permission, origin) => {
        if (blockedPermissions.includes(permission)) {
            return false;
        }
        return true;
    });

    targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
        for (const header of Object.keys(details.requestHeaders)) {
            if (header.toLowerCase().startsWith('sec-ch-ua')) {
                delete details.requestHeaders[header];
            }
        }
        callback({ requestHeaders: details.requestHeaders });
    });
}

function hardenWebviewPreferences(webPreferences) {
    webPreferences.webgl = true;
    webPreferences.accelerated2dCanvas = true;
    webPreferences.experimentalFeatures = false;
}

module.exports = {
    hardenSession,
    hardenWebviewPreferences
};
