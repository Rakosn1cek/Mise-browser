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
                const buffer = fs.readFileSync(CACHE_PATH);
                blockerInstance = ElectronBlocker.deserialize(buffer);
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
        if (ipcInitialized) {
            // Remove existing handlers so Ghostery can re-register them cleanly for secondary sessions
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
}

function hardenWebviewPreferences(webPreferences) {
    webPreferences.webgl = false;
    webPreferences.accelerated2dCanvas = false;
    webPreferences.experimentalFeatures = false;
}

module.exports = {
    hardenSession,
    hardenWebviewPreferences
};
