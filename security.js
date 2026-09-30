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

function applySpellcheckerLanguage(targetSession, languageCode) {
    if (!targetSession) return;
    try {
        const lang = String(languageCode || '').trim();
        if (!lang || lang === 'disabled' || lang === 'none') {
            if (typeof targetSession.setSpellCheckerEnabled === 'function') {
                targetSession.setSpellCheckerEnabled(false);
            }
            if (typeof targetSession.setSpellCheckerLanguages === 'function') {
                targetSession.setSpellCheckerLanguages([]);
            }
        } else {
            if (typeof targetSession.setSpellCheckerEnabled === 'function') {
                targetSession.setSpellCheckerEnabled(true);
            }
            if (typeof targetSession.setSpellCheckerLanguages === 'function') {
                targetSession.setSpellCheckerLanguages([lang]);
            }
        }
    } catch (err) {
        console.error('Failed to configure spellchecker language:', err);
    }
}

function hardenSession(targetSession, spellLang = 'en-GB') {
    applySpellcheckerLanguage(targetSession, spellLang);
    initialiseAdblocker(targetSession);

    const cleanUserAgent = (ua) => {
        return (ua || '')
            .replace(/mise-browser\/[0-9.]+\s*/gi, '')
            .replace(/Electron\/[0-9.]+\s*/gi, '')
            .replace(/Chrome\/[0-9.]+/i, 'Chrome/153.0.0.0')
            .trim();
    };

    if (typeof targetSession.getUserAgent === 'function') {
        const currentUa = targetSession.getUserAgent();
        if (currentUa) {
            targetSession.setUserAgent(cleanUserAgent(currentUa));
        }
    }

    if (targetSession.webRequest && typeof targetSession.webRequest.onBeforeSendHeaders === 'function') {
        targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
            const headers = details.requestHeaders;
            if (headers) {
                if (headers['User-Agent']) {
                    headers['User-Agent'] = cleanUserAgent(headers['User-Agent']);
                }
                if (headers['sec-ch-ua']) {
                    headers['sec-ch-ua'] = '"Chromium";v="153", "Google Chrome";v="153", "Not_A Brand";v="24"';
                }
                if (headers['sec-ch-ua-full-version-list']) {
                    headers['sec-ch-ua-full-version-list'] = '"Chromium";v="153.0.0.0", "Google Chrome";v="153.0.0.0", "Not_A Brand";v="24.0.0.0"';
                }
                headers['Accept-Language'] = 'en-GB,en-US;q=0.9,en;q=0.8';
            }
            callback({ requestHeaders: headers });
        });
    }

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
    const clean = Array.isArray(domains) ? domains.filter(Boolean) : [];
    if (trustedDomains.length === clean.length && trustedDomains.every((d, i) => d === clean[i])) {
        return;
    }
    trustedDomains = clean;
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
    isTrustedDomain,
    applySpellcheckerLanguage
};
