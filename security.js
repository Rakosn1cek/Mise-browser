// security.js
// Decoupled security configuration module for the Mise browser

const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

let blockerInstance = null;
let ipcInitialized = false;

// Domains the user has explicitly marked as trusted (e.g. their bank, their
// usual checkout sites). Anti-fingerprinting and ad/tracker blocking are
// relaxed ONLY for these domains so the sites' fraud-detection checks pass.
// Every other site keeps full protection.
let trustedDomains = [];
let appliedExceptionFilters = [];

// Define a permanent location for the compiled adblocker cache file
const CACHE_PATH = path.join(app.getPath('userData'), 'adblock_cache.bin');

function isTrustedDomain(hostname) {
    if (!hostname) return false;
    const host = hostname.toLowerCase();
    return trustedDomains.some(entry => {
        const domain = String(entry || '').toLowerCase().trim();
        if (!domain) return false;
        return host === domain || host.endsWith('.' + domain);
    });
}

// In security.js:

function buildExceptionFilters(domains) {
    const filters = [];
    domains.forEach(entry => {
        const domain = String(entry || '').toLowerCase().trim();
        if (!domain) return;
        // Whitelist ALL sub-resources, scripts, beacons, and websocket frames
        filters.push(`@@||${domain}^$important`);
        filters.push(`@@||${domain}^`);
        // Disable cosmetic CSS/DOM element hiding
        filters.push(`${domain}#@#*`);
    });
    return filters;
}

function hardenSession(targetSession) {
    targetSession.setSpellCheckerLanguages(['en-GB']);
    initialiseAdblocker(targetSession);

    // Kept restricted permissions, but removed 'notifications' so our main toggle handles it
    const blockedPermissions = ['media', 'geolocation', 'midiSysex', 'audio', 'video'];

    targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
        let hostname = '';
        try { hostname = new URL(webContents.getURL()).hostname; } catch (e) {}

        if (isTrustedDomain(hostname)) {
            return callback(true);
        }
        if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
            return callback(true);
        }
        if (permission === 'notifications') {
            // Respect the global toggle state if defined, or grant
            return callback(true);
        }
        if (blockedPermissions.includes(permission)) {
            return callback(false);
        }
        callback(true);
    });

    targetSession.setPermissionCheckHandler((webContents, permission, origin) => {
        let hostname = '';
        try { hostname = new URL(origin).hostname; } catch (e) {}

        if (isTrustedDomain(hostname)) {
            return true;
        }
        if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
            return true;
        }
        if (permission === 'notifications') {
            return true;
        }
        if (blockedPermissions.includes(permission)) {
            return false;
        }
        return true;
    });

    targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
        let hostname = '';
        try { hostname = new URL(details.url).hostname; } catch (e) {}

        if (!isTrustedDomain(hostname)) {
            for (const header of Object.keys(details.requestHeaders)) {
                if (header.toLowerCase().startsWith('sec-ch-ua')) {
                    delete details.requestHeaders[header];
                }
            }
        }
        callback({ requestHeaders: details.requestHeaders });
    });
}

async function applyTrustedDomainExceptions() {
    if (!blockerInstance) return;
    const newFilters = buildExceptionFilters(trustedDomains);
    try {
        blockerInstance.updateFromDiff({
            removed: appliedExceptionFilters,
            added: newFilters
        });
        appliedExceptionFilters = newFilters;
    } catch (err) {
        console.warn('Failed to update trusted-domain ad-blocker exceptions:', err);
    }
}

function setTrustedDomains(domains) {
    trustedDomains = Array.isArray(domains) ? domains.filter(Boolean) : [];
    applyTrustedDomainExceptions();
}

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

    // Re-apply any user-configured trusted-domain exceptions (banking,
    // shopping, etc.) now that the engine instance exists.
    await applyTrustedDomainExceptions();

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

function hardenWebviewPreferences(webPreferences) {
    webPreferences.webgl = true;
    webPreferences.accelerated2dCanvas = true;
    webPreferences.experimentalFeatures = false;
    webPreferences.sandbox = true;
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.enableRemoteModule = false;
}

module.exports = {
    hardenSession,
    hardenWebviewPreferences,
    setTrustedDomains,
    isTrustedDomain
};
