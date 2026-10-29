// main/permissions.js
// Granular Per-Domain Permission Vault and session permission controller

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app, session } = require('electron');
const { atomicWriteFileSync, readJsonFileOrBackup } = require('./atomicFile');
const config = require('./config');
const diagnostics = require('../diagnostics');

const CONFIG_DIR = config.CONFIG_DIR;
const PERMISSIONS_PATH = path.join(CONFIG_DIR, 'permissions.json');

const SAFE_BENIGN_PERMISSIONS = new Set([
    'fullscreen',
    'clipboard-sanitized-write',
    'pointerLock',
    'keyboardLock',
    'storage-access',
    'top-level-storage-access',
    'speaker-selection'
]);

const VALID_CAPABILITIES = new Set([
    'media:audio',
    'media:video',
    'geolocation',
    'clipboard-read',
    'notifications',
    'display-capture'
]);

const VALID_STATES = new Set(['allow', 'deny', 'prompt']);
const PROMPT_TIMEOUT_MS = 25000;

let permissionsCache = null;
const pendingPrompts = new Map();

function defaultVaultFactory() {
    return {
        version: 1,
        domains: Object.create(null)
    };
}

function isValidVault(data) {
    return Boolean(
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        data.version === 1 &&
        data.domains &&
        typeof data.domains === 'object' &&
        !Array.isArray(data.domains)
    );
}

function normalizeDomain(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let host = raw.toLowerCase().trim();
    if (host.includes('://')) {
        try {
            host = new URL(host).hostname;
        } catch (_) {
            return '';
        }
    }
    const colonIndex = host.indexOf(':');
    if (colonIndex !== -1) {
        host = host.slice(0, colonIndex);
    }
    if (host.endsWith('.')) {
        host = host.slice(0, -1);
    }
    return host;
}

function getPermissionsCache(targetPath = PERMISSIONS_PATH) {
    if (permissionsCache === null) {
        try {
            const loaded = readJsonFileOrBackup(targetPath, isValidVault, defaultVaultFactory);
            permissionsCache = {
                version: 1,
                domains: Object.create(null)
            };
            if (loaded && loaded.domains && typeof loaded.domains === 'object') {
                for (const [dom, perms] of Object.entries(loaded.domains)) {
                    const norm = normalizeDomain(dom);
                    if (norm && perms && typeof perms === 'object') {
                        permissionsCache.domains[norm] = sanitizeDomainPermissions(perms);
                    }
                }
            }
        } catch (_) {
            permissionsCache = defaultVaultFactory();
        }
    }
    return permissionsCache;
}

function sanitizeDomainPermissions(record) {
    const clean = Object.create(null);
    if (!record || typeof record !== 'object') return clean;
    for (const [cap, state] of Object.entries(record)) {
        if (VALID_CAPABILITIES.has(cap) && VALID_STATES.has(state)) {
            clean[cap] = state;
        }
    }
    if (record.updated_at && typeof record.updated_at === 'number') {
        clean.updated_at = record.updated_at;
    }
    return clean;
}

function persistVault(targetPath = PERMISSIONS_PATH) {
    const cache = getPermissionsCache(targetPath);
    const serialized = {
        version: 1,
        domains: {}
    };
    for (const [dom, perms] of Object.entries(cache.domains)) {
        serialized.domains[dom] = { ...perms };
    }
    try {
        atomicWriteFileSync(targetPath, JSON.stringify(serialized, null, 2), { mode: 0o600 });
        return true;
    } catch (err) {
        console.error('Failed to persist permissions vault:', err);
        return false;
    }
}

function isPrivateProfileSession(targetSession) {
    if (!targetSession) return false;
    try {
        if (session && typeof session.fromPartition === 'function') {
            const privateProfile = session.fromPartition('MisePrivateProfile');
            if (targetSession === privateProfile) return true;
        }
    } catch (_) {}
    return false;
}

function resolveRequiredCapabilities(permission, details) {
    if (permission === 'media') {
        const types = (details && Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0)
            ? details.mediaTypes
            : ['audio', 'video'];
        const caps = [];
        if (types.includes('audio')) caps.push('media:audio');
        if (types.includes('video')) caps.push('media:video');
        return caps.length > 0 ? caps : ['media:audio', 'media:video'];
    }
    if (permission === 'geolocation') return ['geolocation'];
    if (permission === 'clipboard-read') return ['clipboard-read'];
    if (permission === 'notifications') return ['notifications'];
    if (permission === 'display-capture') return ['display-capture'];
    return [permission];
}

function configureSessionPermissions(targetSession, options = {}) {
    if (!targetSession) return;

    targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        let hostname = '';
        try {
            const rawUrl = (details && details.requestingUrl) || (webContents && webContents.getURL()) || '';
            hostname = new URL(rawUrl).hostname;
        } catch (_) {}
        const domain = normalizeDomain(hostname);
        const requestingUrl = (details && details.requestingUrl) || (webContents && webContents.getURL()) || '';
        const topLevelUrl = (webContents && webContents.getURL()) || requestingUrl;
        const isMainFrame = !details || details.isMainFrame !== false;

        // 1. Safe non-identifying UI capabilities permitted in all profiles
        if (SAFE_BENIGN_PERMISSIONS.has(permission)) {
            callback(true);
            return;
        }

        // 2. Strict Zero-Trust Sensor Lockdown for MisePrivateProfile
        if (isPrivateProfileSession(targetSession)) {
            diagnostics.logEvent('info', 'permissions', 'Blocked sensor request in Private Profile', {
                permission,
                hostname: domain
            });
            callback(false);
            return;
        }

        // 3. Subframe validation: cross-origin embedded frames fail closed
        if (!isMainFrame) {
            let topHost = '';
            try { topHost = new URL(topLevelUrl).hostname; } catch (_) {}
            if (normalizeDomain(topHost) !== domain) {
                diagnostics.logEvent('warn', 'permissions', 'Blocked cross-origin iframe permission', {
                    permission,
                    requestingHost: domain,
                    topLevelHost: topHost
                });
                callback(false);
                return;
            }
        }

        const requiredCaps = resolveRequiredCapabilities(permission, details);
        const vault = getPermissionsCache();
        const domainRecord = vault.domains[domain] || {};

        let allAllowed = true;
        let anyDenied = false;
        let needsPrompt = false;

        for (const cap of requiredCaps) {
            const state = domainRecord[cap];
            if (state === 'allow') {
                continue;
            } else if (state === 'deny') {
                anyDenied = true;
                allAllowed = false;
                break;
            } else {
                allAllowed = false;
                needsPrompt = true;
            }
        }

        if (allAllowed) {
            callback(true);
            return;
        }

        if (anyDenied) {
            diagnostics.logEvent('warn', 'permissions', 'Denied permission from vault', {
                permission,
                domain
            });
            callback(false);
            return;
        }

        // 4. Broker interactive prompt for unset or prompt states
        const win = (typeof options.getMainWindow === 'function') ? options.getMainWindow() : null;
        if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) {
            callback(false);
            return;
        }

        const requestId = crypto.randomUUID
            ? crypto.randomUUID()
            : `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

        const promptTimer = setTimeout(() => {
            if (pendingPrompts.has(requestId)) {
                pendingPrompts.delete(requestId);
                try { callback(false); } catch (_) {}
                diagnostics.logEvent('info', 'permissions', 'Permission prompt timed out', {
                    permission,
                    domain
                });
            }
        }, PROMPT_TIMEOUT_MS);

        pendingPrompts.set(requestId, {
            callback,
            timer: promptTimer,
            domain,
            permission,
            capabilities: requiredCaps
        });

        win.webContents.send('permission-prompt-requested', {
            requestId,
            domain,
            permission,
            capabilities: requiredCaps,
            details: {
                requestingUrl,
                topLevelUrl,
                isMainFrame
            }
        });
    });

    targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
        if (SAFE_BENIGN_PERMISSIONS.has(permission)) {
            return true;
        }

        if (isPrivateProfileSession(targetSession)) {
            return false;
        }

        let hostname = '';
        try {
            hostname = new URL(requestingOrigin).hostname;
        } catch (_) {}
        const domain = normalizeDomain(hostname);
        if (!domain) return false;

        const vault = getPermissionsCache();
        const domainRecord = vault.domains[domain];
        if (!domainRecord) {
            // Notifications fallback to global toggle if not explicitly recorded
            if (permission === 'notifications' && typeof options.areNotificationsEnabled === 'function') {
                return Boolean(options.areNotificationsEnabled());
            }
            return false;
        }

        const requiredCaps = resolveRequiredCapabilities(permission, details);
        for (const cap of requiredCaps) {
            if (domainRecord[cap] !== 'allow') {
                return false;
            }
        }
        return true;
    });
}

function resolvePermissionPrompt(requestId, { allow, remember } = {}) {
    if (!pendingPrompts.has(requestId)) return false;
    const req = pendingPrompts.get(requestId);
    pendingPrompts.delete(requestId);
    clearTimeout(req.timer);

    const isAllowed = Boolean(allow);
    try {
        req.callback(isAllowed);
    } catch (_) {}

    if (remember && req.domain) {
        const cache = getPermissionsCache();
        if (!cache.domains[req.domain]) {
            cache.domains[req.domain] = Object.create(null);
        }
        const stateToSave = isAllowed ? 'allow' : 'deny';
        for (const cap of req.capabilities) {
            if (VALID_CAPABILITIES.has(cap)) {
                cache.domains[req.domain][cap] = stateToSave;
            }
        }
        cache.domains[req.domain].updated_at = Date.now();
        persistVault();
    }

    return true;
}

function getPermissionsVault() {
    const cache = getPermissionsCache();
    const result = {
        version: 1,
        domains: {}
    };
    for (const [dom, perms] of Object.entries(cache.domains)) {
        result.domains[dom] = { ...perms };
    }
    return result;
}

function getDomainPermissions(domain) {
    const norm = normalizeDomain(domain);
    if (!norm) return {};
    const cache = getPermissionsCache();
    return cache.domains[norm] ? { ...cache.domains[norm] } : {};
}

function setDomainPermission(domain, capability, state) {
    const norm = normalizeDomain(domain);
    if (!norm) return { success: false, reason: 'Invalid domain' };
    if (!VALID_CAPABILITIES.has(capability)) {
        return { success: false, reason: 'Invalid capability' };
    }
    if (!VALID_STATES.has(state)) {
        return { success: false, reason: 'Invalid state' };
    }

    const cache = getPermissionsCache();
    if (!cache.domains[norm]) {
        cache.domains[norm] = Object.create(null);
    }
    cache.domains[norm][capability] = state;
    cache.domains[norm].updated_at = Date.now();
    const ok = persistVault();
    return { success: ok, permissions: { ...cache.domains[norm] } };
}

function revokeDomainPermissions(domain) {
    const norm = normalizeDomain(domain);
    if (!norm) return { success: false, reason: 'Invalid domain' };
    const cache = getPermissionsCache();
    if (cache.domains[norm]) {
        delete cache.domains[norm];
        const ok = persistVault();
        return { success: ok };
    }
    return { success: true };
}

function clearAllPermissions() {
    const cache = getPermissionsCache();
    cache.domains = Object.create(null);
    const ok = persistVault();
    return { success: ok };
}

function registerPermissionsIpc(ipcMain, options = {}) {
    ipcMain.handle('get-permissions-vault', async () => {
        return getPermissionsVault();
    });

    ipcMain.handle('get-domain-permissions', async (event, domain) => {
        return getDomainPermissions(domain);
    });

    ipcMain.handle('set-domain-permission', async (event, domain, capability, state) => {
        return setDomainPermission(domain, capability, state);
    });

    ipcMain.handle('revoke-domain-permissions', async (event, domain) => {
        return revokeDomainPermissions(domain);
    });

    ipcMain.handle('clear-all-permissions', async () => {
        return clearAllPermissions();
    });

    ipcMain.handle('resolve-permission-prompt', async (event, payload) => {
        if (!payload || typeof payload !== 'object') return false;
        const { requestId, allow, remember } = payload;
        return resolvePermissionPrompt(requestId, { allow, remember });
    });
}

function resetPermissionsCacheForTesting() {
    permissionsCache = null;
    for (const [id, req] of pendingPrompts.entries()) {
        clearTimeout(req.timer);
    }
    pendingPrompts.clear();
}

module.exports = {
    PERMISSIONS_PATH,
    SAFE_BENIGN_PERMISSIONS,
    VALID_CAPABILITIES,
    VALID_STATES,
    normalizeDomain,
    getPermissionsCache,
    getPermissionsVault,
    getDomainPermissions,
    setDomainPermission,
    revokeDomainPermissions,
    clearAllPermissions,
    resolvePermissionPrompt,
    configureSessionPermissions,
    registerPermissionsIpc,
    isPrivateProfileSession,
    resetPermissionsCacheForTesting
};
