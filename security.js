// security.js
// Decoupled security configuration module for the Mise browser

const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, ipcMain } = require('electron');

let blockerInstance = null;
let blockerInitialisation = null;
let ipcInitialized = false;

// Domains the user has explicitly marked as trusted (e.g. their bank, their
// usual checkout sites). Anti-fingerprinting and ad/tracker blocking are
// relaxed ONLY for these domains so the sites' fraud-detection checks pass.
// Every other site keeps full protection.
let trustedDomains = [];
let appliedExceptionFilters = [];

// Define a permanent location for the compiled adblocker cache file
const userDataDir = (app && typeof app.getPath === 'function')
    ? app.getPath('userData')
    : path.join(require('os').tmpdir(), 'mise-browser');
const CACHE_PATH = path.join(userDataDir, 'adblock_cache.bin');

// Infrastructure domains required for Google authentication and bot detection
const GOOGLE_AUTH_DOMAINS = [
    'accounts.google.com',
    'myaccount.google.com',
    'google.com',
    'google.co.uk',
    'gstatic.com',
    'gvt1.com',
    'recaptcha.net',
    'youtube.com'
];

const GOOGLE_UGC_HOSTS = [
    'sites.google.com'
];

// Google's sign-in serves Electron a lighter flow that it accepts, but sends the
// standardised Chrome identity into full Chrome checks that an embedded runtime
// fails ("This browser or app may not be secure"). Sign-in pages therefore get
// Electron's own User-Agent instead.
const GOOGLE_SIGNIN_HOST = 'accounts.google.com';
let googleSignInUserAgent = '';

// Called by main.js with Electron's default User-Agent, before it is replaced
function setGoogleSignInUserAgent(defaultUserAgent) {
    // Drop the app name token, keeping the Chrome and Electron versions
    googleSignInUserAgent = String(defaultUserAgent || '')
        .replace(/\(KHTML, like Gecko\) .*?Chrome\//, '(KHTML, like Gecko) Chrome/');
}

function getGoogleSignInUserAgent(hostname) {
    return hostname === GOOGLE_SIGNIN_HOST ? googleSignInUserAgent : '';
}

function isGoogleSignInRequest(details) {
    const hostOf = (url) => { try { return new URL(url).hostname; } catch (e) { return ''; } };
    // Navigations are judged by destination; the page URL is still the previous one here
    if (details.resourceType === 'mainFrame') return hostOf(details.url) === GOOGLE_SIGNIN_HOST;
    // Everything a sign-in page loads carries the same identity
    try {
        return !!details.webContents && hostOf(details.webContents.getURL()) === GOOGLE_SIGNIN_HOST;
    } catch (e) {
        return false;
    }
}

const PUBLIC_SUFFIX_BLOCKLIST = new Set([
    'co.uk',
    'org.uk',
    'ac.uk',
    'gov.uk',
    'me.uk',
    'com.au',
    'net.au',
    'org.au',
    'co.jp',
    'co.nz',
    'co.in',
    'co.za',
    'com.br',
    'com.cn',
    'com.mx',
    'com.tr',
    'github.io',
    'gitlab.io',
    'blogspot.com',
    'herokuapp.com',
    'appspot.com',
    'pages.dev',
    'netlify.app',
    'vercel.app',
    'web.app',
    'firebaseapp.com',
    'azurewebsites.net',
    'cloudfront.net',
    'amazonaws.com',
    'workers.dev'
]);

const DOMAIN_FORMAT_REGEX = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

function normalizeHostname(hostname) {
    if (!hostname && hostname !== 0) return '';
    let host = String(hostname).toLowerCase().trim();
    const colonCount = (host.match(/:/g) || []).length;
    if (colonCount === 1) {
        host = host.split(':')[0];
    }
    if (host.endsWith('.')) {
        host = host.slice(0, -1);
    }
    return host;
}

function isUserTrustedDomain(hostname) {
    const host = normalizeHostname(hostname);
    if (!host) return false;
    return trustedDomains.some(entry => host === entry || host.endsWith('.' + entry));
}

function isGoogleInfraHost(hostname) {
    const host = normalizeHostname(hostname);
    if (!host) return false;
    if (GOOGLE_UGC_HOSTS.some(ugc => host === ugc || host.endsWith('.' + ugc))) {
        return false;
    }
    return GOOGLE_AUTH_DOMAINS.some(gd => host === gd || host.endsWith('.' + gd));
}

function isTrustedDomain(hostname) {
    const host = normalizeHostname(hostname);
    if (!host) return false;
    return isGoogleInfraHost(host) || isUserTrustedDomain(host);
}

function isPermissionTrustedRequest(options) {
    if (!options || typeof options !== 'object') {
        return false;
    }
    const { requestingUrl, topLevelUrl, isMainFrame } = options;
    if (!requestingUrl || !topLevelUrl) {
        return false;
    }
    let reqHost = '';
    let topHost = '';
    try {
        reqHost = new URL(requestingUrl).hostname;
        topHost = new URL(topLevelUrl).hostname;
    } catch (_) {
        return false;
    }
    if (!reqHost || !topHost) {
        return false;
    }
    if (!isUserTrustedDomain(reqHost)) {
        return false;
    }
    if (isMainFrame === false && !isUserTrustedDomain(topHost)) {
        return false;
    }
    return true;
}

function normalizeTrustedDomains(list) {
    if (!Array.isArray(list)) {
        return [];
    }
    const result = [];
    const seen = new Set();
    let droppedCount = 0;

    for (const entry of list) {
        if (entry === null || entry === undefined) {
            droppedCount++;
            continue;
        }
        let domain = String(entry).trim().toLowerCase();
        if (domain.endsWith('.')) {
            domain = domain.slice(0, -1);
        }
        if (!DOMAIN_FORMAT_REGEX.test(domain) || PUBLIC_SUFFIX_BLOCKLIST.has(domain)) {
            droppedCount++;
            continue;
        }
        if (seen.has(domain)) {
            droppedCount++;
            continue;
        }
        seen.add(domain);
        result.push(domain);
    }

    if (droppedCount > 0) {
        console.warn(`Dropped ${droppedCount} invalid or duplicate trusted domain entries.`);
    }

    return result;
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

const ALLOWED = [
    'fullscreen',
    'clipboard-sanitized-write',
    'pointerLock',
    'keyboardLock',
    'storage-access',
    'top-level-storage-access',
    'speaker-selection'
];

function decidePermission(permission, { trusted, notificationsEnabled } = {}) {
    if (trusted === true) {
        return true;
    }
    if (permission === 'notifications') {
        return Boolean(notificationsEnabled);
    }
    if (ALLOWED.includes(permission)) {
        return true;
    }
    return false;
}

function applyWebRTCPolicy(targetSession, policy = 'default_public_interface_only') {
    if (!targetSession || typeof targetSession.setWebRTCIPHandlingPolicy !== 'function') return;
    const sessionPolicy = policy === 'disable_non_proxied_udp'
        ? 'disable_non_proxied_udp'
        : (policy === 'default' || policy === 'default_public_and_private_interfaces')
            ? policy
            : (policy === 'disabled' ? 'disable_non_proxied_udp' : 'default_public_interface_only');

    try {
        targetSession.setWebRTCIPHandlingPolicy(sessionPolicy);
    } catch (err) {
        console.error('Failed to configure WebRTC IP handling policy:', err);
    }
}

function hardenSession(targetSession, spellLang = 'en-GB', webrtcPolicy = 'default_public_interface_only') {
    applySpellcheckerLanguage(targetSession, spellLang);
    initialiseAdblocker(targetSession);

    // Apply WebRTC IP handling policy
    applyWebRTCPolicy(targetSession, webrtcPolicy);

    attachNetworkHandlers(targetSession);

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

            if (googleSignInUserAgent && isGoogleSignInRequest(details)) {
                const headers = details.requestHeaders || {};
                headers['User-Agent'] = googleSignInUserAgent;
                return callback({ requestHeaders: headers });
            }

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

// Electron keeps a single listener per webRequest event, so the ad-blocker's
// onBeforeRequest and onHeadersReceived would replace ours. Register one
// listener for each that runs Mise's rules first, then hands over to the blocker.
function attachNetworkHandlers(targetSession) {
    if (!targetSession.webRequest) return;

    const blockingEnabled = () => blockerInstance && blockerInstance.isBlockingEnabled(targetSession);

    targetSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        // Route Google authentication requests through the WebLite sign-in flow
        const url = details.url || '';
        if (url.includes('flowName=GlifWebSignIn') && /^https?:\/\/accounts\.google\.com\//i.test(url)) {
            return callback({ redirectURL: url.replaceAll('flowName=GlifWebSignIn', 'flowName=WebLiteSignIn') });
        }
        if (blockingEnabled()) return blockerInstance.onBeforeRequest(details, callback);
        callback({});
    });

    targetSession.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
        // Intercept main frame navigation to PDF documents and route to built-in viewer
        if ((details.resourceType === 'main_frame' || details.resourceType === 'mainFrame') && details.url) {
            const viewerPrefix = 'file://' + path.join(__dirname, 'assets', 'pdfjs', 'viewer.html');
            if (!details.url.startsWith(viewerPrefix)) {
                const headers = details.responseHeaders || {};
                let isPdf = false;
                for (const [headerKey, headerVal] of Object.entries(headers)) {
                    if (headerKey.toLowerCase() === 'content-type') {
                        const valStr = Array.isArray(headerVal) ? headerVal.join(' ') : String(headerVal);
                        const lowerVal = valStr.toLowerCase();
                        if (lowerVal.includes('application/pdf') || lowerVal.includes('application/x-pdf')) {
                            isPdf = true;
                            break;
                        }
                    }
                }
                if (isPdf) {
                    const viewerUrl = mintPdfViewerUrl(details.url);
                    return callback({ redirectURL: viewerUrl });
                }
            }
        }
        if (blockingEnabled()) return blockerInstance.onHeadersReceived(details, callback);
        callback({ responseHeaders: details.responseHeaders });
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
    const clean = normalizeTrustedDomains(domains);
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

// Sessions start together on startup. Share the pending engine build so
// they cannot download, deserialise, and retain separate copies of the filter set.
function getAdblocker() {
    if (!blockerInitialisation) {
        blockerInitialisation = (async () => {
            if (fs.existsSync(CACHE_PATH)) {
                try {
                    const buffer = fs.readFileSync(CACHE_PATH);
                    blockerInstance = ElectronBlocker.deserialize(buffer);
                } catch (_) {
                    console.warn('Adblocker cache version mismatch or corrupted file. Rebuilding cache...');
                    if (fs.existsSync(CACHE_PATH)) {
                        try { fs.unlinkSync(CACHE_PATH); } catch (e) {}
                    }
                }
            }
            if (!blockerInstance) {
                const built = await require('./adblocker-build')();
                blockerInstance = built.blocker;
                fs.writeFileSync(CACHE_PATH, built.cacheBytes);
            }
            try {
                blockerInstance.updateFromDiff({
                    added: [
                        'youtube.com#@#+js()',
                        'x.com#@#+js()',
                        'twitter.com#@#+js()'
                    ]
                });
            } catch (diffErr) {
                console.warn('Failed to apply adblocker exception rules:', diffErr);
            }
            await applyTrustedDomainExceptions();
            return blockerInstance;
        })().catch(err => {
            blockerInstance = null;
            blockerInitialisation = null;
            console.error('Failed to instantiate network filters:', err);
            return null;
        });
    }
    return blockerInitialisation;
}

async function initialiseAdblocker(targetSession) {
    if (!await getAdblocker()) return;

    try {
        if (ipcInitialized) {
            GHOSTERY_IPC_CHANNELS.forEach(channel => {
                try { ipcMain.removeHandler(channel); } catch (e) {}
            });
        }
        blockerInstance.enableBlockingInSession(targetSession);
        attachNetworkHandlers(targetSession);
        ipcInitialized = true;
    } catch (err) {
        console.error('Failed to attach network filters to session:', err);
    }
}

function hardenWebviewPreferences(webPreferences) {
    if (!webPreferences || typeof webPreferences !== 'object') return;
    webPreferences.webgl = true;
    webPreferences.accelerated2dCanvas = true;
    webPreferences.experimentalFeatures = false;
    webPreferences.sandbox = true;
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.nodeIntegrationInWorker = false;
    webPreferences.webviewTag = false;
    delete webPreferences.preloadURL;
}

function isValidPartitionName(name) {
    return typeof name === 'string' && /^(persist:)?[A-Za-z0-9_-]{1,200}$/.test(name);
}

function prepareWebviewAttach(webPreferences, params, options) {
    const { preloadPath } = options || {};

    if (webPreferences && typeof webPreferences === 'object') {
        hardenWebviewPreferences(webPreferences);
        webPreferences.preload = preloadPath;
    } else {
        hardenWebviewPreferences(webPreferences);
    }

    if (params && typeof params === 'object' && 'preload' in params) {
        params.preload = preloadPath;
    }

    const partition = (webPreferences && webPreferences.partition) || (params && params.partition);
    if (!isValidPartitionName(partition)) {
        return { allowed: false, reason: 'partition' };
    }

    const src = params && params.src;
    if (src !== undefined && src !== null && src !== '') {
        if (typeof src !== 'string') {
            return { allowed: false, reason: 'src' };
        }
        if (src !== 'about:blank') {
            try {
                const parsed = new URL(src);
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'file:') {
                    return { allowed: false, reason: 'src' };
                }
            } catch (e) {
                return { allowed: false, reason: 'src' };
            }
        }
    }

    return { allowed: true, reason: '' };
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

const activePdfTokens = new Map();
const PDF_TOKEN_TTL_MS = 30 * 60 * 1000;

function pruneExpiredPdfTokens() {
    const now = Date.now();
    for (const [tok, data] of activePdfTokens.entries()) {
        if (now - data.createdAt > PDF_TOKEN_TTL_MS) {
            activePdfTokens.delete(tok);
        }
    }
}

function isPdfExtension(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') return false;
    try {
        const cleanPath = targetPath.split('?')[0].split('#')[0];
        const ext = path.extname(cleanPath).toLowerCase();
        return ext === '.pdf';
    } catch (e) {
        return false;
    }
}

function mintPdfViewerUrl(targetUrl) {
    if (!targetUrl || typeof targetUrl !== 'string') return '';
    pruneExpiredPdfTokens();

    const token = crypto.randomUUID();
    activePdfTokens.set(token, {
        url: targetUrl,
        createdAt: Date.now()
    });

    const viewerPath = path.join(__dirname, 'assets', 'pdfjs', 'viewer.html');
    return `file://${viewerPath}?file=${encodeURIComponent(targetUrl)}&token=${token}`;
}

function validatePdfAccess(token, targetUrl, senderUrl) {
    const viewerPath = path.join(__dirname, 'assets', 'pdfjs', 'viewer.html');
    const viewerPrefix = 'file://' + viewerPath;

    // 1. Origin verification: sender must be the vendored viewer
    if (!senderUrl || typeof senderUrl !== 'string' || !senderUrl.startsWith(viewerPrefix)) {
        throw new Error('Authorisation failure: PDF bridge is restricted to the built-in PDF viewer.');
    }

    // 2. Token verification: token must exist and match target URL
    if (!token || typeof token !== 'string' || !activePdfTokens.has(token)) {
        throw new Error('Authorisation failure: Missing or invalid PDF capability token.');
    }

    const tokenData = activePdfTokens.get(token);
    if (!tokenData || tokenData.url !== targetUrl) {
        throw new Error('Authorisation failure: Capability token does not match requested PDF target.');
    }

    // 3. Path verification: local files must strictly possess a .pdf extension
    if (targetUrl.startsWith('file://') || targetUrl.startsWith('/')) {
        let filePath = targetUrl;
        if (targetUrl.startsWith('file://')) {
            try {
                filePath = new URL(targetUrl).pathname;
            } catch (e) {
                filePath = targetUrl.replace(/^file:\/\//, '');
            }
        }
        filePath = decodeURIComponent(filePath);
        if (!isPdfExtension(filePath)) {
            throw new Error('Authorisation failure: Target local file must possess a .pdf extension.');
        }
    }
}

function isSafeTabUrl(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 16384) return false;
    try {
        const p = new URL(url);
        return p.protocol === 'http:' || p.protocol === 'https:';
    } catch (e) { return false; }
}

function sanitiseTerminalCommand(commandStr, maxLength = 4096) {
    if (typeof commandStr !== 'string') return '';
    const clean = commandStr.replace(/[\0\r\n]+/g, ' ').trim();
    if (!clean) return '';
    const limit = Number.isInteger(maxLength) && maxLength > 0 ? maxLength : 4096;
    return clean.slice(0, limit).trim();
}

module.exports = {
    isValidPartitionName,
    decidePermission,
    hardenSession,
    hardenWebviewPreferences,
    prepareWebviewAttach,
    setTrustedDomains,
    normalizeTrustedDomains,
    isTrustedDomain,
    isUserTrustedDomain,
    isGoogleInfraHost,
    isPermissionTrustedRequest,
    applySpellcheckerLanguage,
    applyWebRTCPolicy,
    clearGoogleAuthCookies,
    setGoogleSignInUserAgent,
    getGoogleSignInUserAgent,
    isGoogleSignInRequest,
    attachNetworkHandlers,
    mintPdfViewerUrl,
    validatePdfAccess,
    isSafeTabUrl,
    sanitiseTerminalCommand
};
