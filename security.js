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

// Infrastructure domains required for Google authentication and bot detection
const GOOGLE_AUTH_DOMAINS = [
    'accounts.google.com',
    'myaccount.google.com',
    'google.com',
    'google.co.uk',
    'gstatic.com',
    'googleapis.com',
    'googleusercontent.com',
    'gvt1.com',
    'recaptcha.net',
    'youtube.com'
];

function isTrustedDomain(hostname) {
    if (!hostname) return false;
    const host = String(hostname).toLowerCase().split(':')[0];

    // Core authentication endpoints are always trusted to ensure uninterrupted account login
    if (GOOGLE_AUTH_DOMAINS.some(gd => host === gd || host.endsWith('.' + gd))) {
        return true;
    }

    return trustedDomains.some(entry => {
        const domain = String(entry || '').toLowerCase().trim();
        if (!domain) return false;
        return host === domain || host.endsWith('.' + domain);
    });
}

function buildExceptionFilters(domains) {
    const filters = [];
    const allDomains = new Set();

    domains.forEach(entry => {
        const domain = String(entry || '').toLowerCase().trim();
        if (domain) allDomains.add(domain);
    });

    allDomains.forEach(domain => {
        // Whitelist all sub-resources, scripts, beacons, and websocket frames
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

    // Prevent WebRTC from probing non-default local interfaces
    if (typeof targetSession.setWebRTCIPHandlingPolicy === 'function') {
        targetSession.setWebRTCIPHandlingPolicy('default_public_interface_only');
    }

    // Kept restricted permissions, but removed 'notifications' so our main toggle handles it
    const blockedPermissions = ['media', 'geolocation', 'midiSysex', 'audio', 'video'];

    targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
        let hostname = '';
        try { hostname = new URL(webContents.getURL()).hostname; } catch (e) {}

        if (isTrustedDomain(hostname)) {
            return callback(true);
        }
        if (permission === 'clipboard-read') {
            return callback(false);
        }
        if (permission === 'clipboard-sanitized-write') {
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
        if (permission === 'clipboard-read') {
            return false;
        }
        if (permission === 'clipboard-sanitized-write') {
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

    // Route Google authentication requests through the lightweight sign-in flow
    if (targetSession.webRequest && typeof targetSession.webRequest.onBeforeRequest === 'function') {
        targetSession.webRequest.onBeforeRequest({ urls: ['*://accounts.google.com/*'] }, (details, callback) => {
            const url = details.url || '';
            if (url.includes('flowName=GlifWebSignIn')) {
                const redirectedUrl = url.replaceAll('flowName=GlifWebSignIn', 'flowName=WebLiteSignIn');
                return callback({ redirectURL: redirectedUrl });
            }
            callback({});
        });
    }

    const cleanUserAgent = (ua) => {
        return (ua || '')
            .replace(/mise-browser\/[0-9.]+\s*/gi, '')
            .replace(/Electron\/[0-9.]+\s*/gi, '')
            .replace(/Chrome\/(\d+)\.[\d.]+/i, 'Chrome/$1.0.0.0')
            .trim();
    };

    if (targetSession.webRequest && typeof targetSession.webRequest.onBeforeSendHeaders === 'function') {
        targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
            let hostname = '';
            try { hostname = new URL(details.url).hostname; } catch (e) {}

            // Keep unmodified headers on trusted authentication domains
            if (isTrustedDomain(hostname)) {
                return callback({ requestHeaders: details.requestHeaders });
            }

            const headers = details.requestHeaders;
            if (headers) {
                if (headers['User-Agent']) {
                    headers['User-Agent'] = cleanUserAgent(headers['User-Agent']);
                }
                const chromeMatch = (headers['User-Agent'] || '').match(/Chrome\/(\d+)\.([\d.]+)/);
                const realChromeMajor = (process.versions && process.versions.chrome) ? process.versions.chrome.split('.')[0] : '132';
                const chromeMajor = chromeMatch ? chromeMatch[1] : realChromeMajor;

                headers['sec-ch-ua'] = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not-A.Brand";v="99"`;
                headers['sec-ch-ua-full-version-list'] = `"Chromium";v="${chromeMajor}.0.0.0", "Google Chrome";v="${chromeMajor}.0.0.0", "Not-A.Brand";v="99.0.0.0"`;
                headers['Accept-Language'] = 'en-GB,en-US;q=0.9,en;q=0.8';
            }
            callback({ requestHeaders: headers });
        });
    }
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
                try { ipcMain.removeHandler(channel); } catch (e) {}
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

async function clearGoogleAuthCookies(targetSession) {
    if (!targetSession || !targetSession.cookies) return;
    try {
        const domains = ['google.com', 'accounts.google.com', 'mail.google.com'];
        for (const dom of domains) {
            const cookies = await targetSession.cookies.get({ domain: dom });
            for (const c of cookies) {
                if (c.name.startsWith('__Host-') || c.name === 'OTZ' || c.name === 'NID' || c.name.startsWith('__Secure-')) {
                    const scheme = c.secure ? 'https://' : 'http://';
                    const cookieUrl = scheme + c.domain.replace(/^\./, '') + c.path;
                    await targetSession.cookies.remove(cookieUrl, c.name);
                }
            }
        }
    } catch (e) {}
}

module.exports = {
    hardenSession,
    hardenWebviewPreferences,
    setTrustedDomains,
    isTrustedDomain,
    applySpellcheckerLanguage,
    clearGoogleAuthCookies
};
