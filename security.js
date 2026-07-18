// security.js
// Decoupled security configuration module for the Mise browser

const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let blockerInstance = null;

// Define a permanent location for the compiled adblocker cache file
const CACHE_PATH = path.join(app.getPath('userData'), 'adblock_cache.bin');

async function initialiseAdblocker(targetSession) {
    if (blockerInstance) {
        blockerInstance.enableBlockingInSession(targetSession);
        return;
    }

    try {
        // Attempt to load a pre-compiled binary cache to eliminate startup overhead
        if (fs.existsSync(CACHE_PATH)) {
            const buffer = fs.readFileSync(CACHE_PATH);
            blockerInstance = ElectronBlocker.deserialize(buffer);
        } else {
            // Fall back to building the ruleset and save the compiled result for subsequent boots
            blockerInstance = await ElectronBlocker.fromPrebuiltAdsAndTracking();
            const buffer = blockerInstance.serialize();
            fs.writeFileSync(CACHE_PATH, buffer);
        }
    } catch (err) {
        console.error('Failed to instantiate network filters:', err);
        return;
    }

    blockerInstance.enableBlockingInSession(targetSession);
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
