// userContent.js
// Local User-Script and User-Style injection manager for Mise Browser
// Monitors ~/.config/mise-browser/scripts and ~/.config/mise-browser/styles
// Injects matching .user.js and .user.css on dom-ready without extension runtime overhead

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, shell, ipcMain, net } = require('electron');
const dns = require('dns');
const nodeNet = require('net');
const crypto = require('crypto');
const atomicFile = require('./main/atomicFile');
let UndiciAgent = null;
try {
    UndiciAgent = require('undici').Agent;
} catch {}

const defaultBaseDir = path.join(os.homedir(), '.config', 'mise-browser');
let scriptsDir = path.join(defaultBaseDir, 'scripts');
let stylesDir = path.join(defaultBaseDir, 'styles');
let storageDir = path.join(defaultBaseDir, 'script-storage');
let cachedMainWindow = null;

let loadedScripts = [];
let loadedStyles = [];

let scriptsWatcher = null;
let stylesWatcher = null;
let debounceTimerScripts = null;
let debounceTimerStyles = null;

const scriptStorageCache = new Map();
const storageDebounceTimers = new Map();
const MAX_STORAGE_VALUE_CHARS = 1048576;
const MAX_STORAGE_KEYS = 1000;
const MAX_STORAGE_TOTAL_CHARS = 5 * 1024 * 1024;
const STORAGE_DEBOUNCE_MS = 500;
let beforeQuitRegistered = false;
const activeTokens = new Map();
const TOKEN_IDLE_MS = 6 * 60 * 60 * 1000;
const MAX_TOKENS = 2000;
const wiredSenders = new WeakSet();

function sanitizeScriptId(scriptId) {
    return String(scriptId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getScriptStoragePath(scriptId) {
    const cleanId = sanitizeScriptId(scriptId);
    return path.join(storageDir, `${cleanId}.json`);
}

function isValidStorageKey(key) {
    if (typeof key !== 'string' && typeof key !== 'number') return false;
    const strKey = String(key);
    if (strKey.length === 0 || strKey.length > 1024) return false;
    if (strKey === '__proto__' || strKey === 'constructor' || strKey === 'prototype') return false;
    return true;
}

function sanitizeStorageObject(rawObj) {
    const clean = Object.create(null);
    if (rawObj && typeof rawObj === 'object' && !Array.isArray(rawObj)) {
        for (const [k, v] of Object.entries(rawObj)) {
            if (isValidStorageKey(k)) {
                clean[k] = v;
            }
        }
    }
    return clean;
}

function loadScriptStorage(scriptId) {
    const cleanId = sanitizeScriptId(scriptId);
    if (scriptStorageCache.has(cleanId)) {
        return scriptStorageCache.get(cleanId);
    }
    const filePath = getScriptStoragePath(cleanId);
    const raw = atomicFile.readJsonFileOrBackup(
        filePath,
        (val) => val !== null && typeof val === 'object' && !Array.isArray(val),
        () => Object.create(null)
    );
    const data = sanitizeStorageObject(raw);
    scriptStorageCache.set(cleanId, data);
    return data;
}

function saveScriptStorage(scriptId, store) {
    const cleanId = sanitizeScriptId(scriptId);
    if (storageDebounceTimers.has(cleanId)) {
        clearTimeout(storageDebounceTimers.get(cleanId));
        storageDebounceTimers.delete(cleanId);
    }
    const cleanStore = sanitizeStorageObject(store);
    scriptStorageCache.set(cleanId, cleanStore);
    try {
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        const filePath = getScriptStoragePath(cleanId);
        atomicFile.atomicWriteFileSync(filePath, JSON.stringify(cleanStore, null, 2), { mode: 0o600 });
    } catch (err) {
        console.error(`Failed to save script storage for ${cleanId}:`, err);
    }
}

function scheduleDeferredSave(cleanId, store) {
    if (storageDebounceTimers.has(cleanId)) {
        clearTimeout(storageDebounceTimers.get(cleanId));
    }
    const timer = setTimeout(() => {
        storageDebounceTimers.delete(cleanId);
        saveScriptStorage(cleanId, store);
    }, STORAGE_DEBOUNCE_MS);
    if (typeof timer.unref === 'function') {
        timer.unref();
    }
    storageDebounceTimers.set(cleanId, timer);
}

function flushScriptStorage(scriptId) {
    if (scriptId !== undefined) {
        const cleanId = sanitizeScriptId(scriptId);
        const timer = storageDebounceTimers.get(cleanId);
        if (timer) {
            clearTimeout(timer);
            storageDebounceTimers.delete(cleanId);
            const store = scriptStorageCache.get(cleanId) || loadScriptStorage(cleanId);
            saveScriptStorage(cleanId, store);
        }
        return;
    }
    const pendingIds = Array.from(storageDebounceTimers.keys());
    for (const cleanId of pendingIds) {
        const timer = storageDebounceTimers.get(cleanId);
        if (timer) {
            clearTimeout(timer);
            storageDebounceTimers.delete(cleanId);
        }
        const store = scriptStorageCache.get(cleanId) || loadScriptStorage(cleanId);
        saveScriptStorage(cleanId, store);
    }
}

function setScriptValue(scriptId, key, value, { defer = false } = {}) {
    if (!isValidStorageKey(key)) {
        throw new Error(`Invalid or forbidden userscript storage key: ${key}`);
    }

    let serializedValue;
    try {
        serializedValue = JSON.stringify(value);
        if (typeof serializedValue !== 'string') {
            throw new Error('Unsupported storage value');
        }
    } catch (_) {
        throw new Error('Unsupported storage value');
    }

    if (serializedValue.length > MAX_STORAGE_VALUE_CHARS) {
        throw new Error('Storage quota exceeded');
    }

    const cleanId = sanitizeScriptId(scriptId);
    const store = loadScriptStorage(cleanId);
    const strKey = String(key);
    const hadKey = Object.prototype.hasOwnProperty.call(store, strKey);

    if (!hadKey && Object.keys(store).length >= MAX_STORAGE_KEYS) {
        throw new Error('Storage quota exceeded');
    }

    const prevValue = store[strKey];
    store[strKey] = value;

    let serializedStore;
    try {
        serializedStore = JSON.stringify(store, null, 2);
    } catch (_) {
        if (hadKey) {
            store[strKey] = prevValue;
        } else {
            delete store[strKey];
        }
        throw new Error('Unsupported storage value');
    }

    if (typeof serializedStore !== 'string' || serializedStore.length > MAX_STORAGE_TOTAL_CHARS) {
        if (hadKey) {
            store[strKey] = prevValue;
        } else {
            delete store[strKey];
        }
        throw new Error('Storage quota exceeded');
    }

    if (defer) {
        scheduleDeferredSave(cleanId, store);
    } else {
        saveScriptStorage(cleanId, store);
    }
}

function deleteScriptValue(scriptId, key, { defer = false } = {}) {
    if (!isValidStorageKey(key)) return;
    const cleanId = sanitizeScriptId(scriptId);
    const store = loadScriptStorage(cleanId);
    delete store[String(key)];
    if (defer) {
        scheduleDeferredSave(cleanId, store);
    } else {
        saveScriptStorage(cleanId, store);
    }
}

function generateScriptToken(scriptId, pageHostname = '', connects = [], grants = [], pageOrigin = undefined) {
    const now = Date.now();
    for (const [tok, data] of activeTokens.entries()) {
        const lastUsed = data.lastUsedAt || data.createdAt || 0;
        if (now - lastUsed > TOKEN_IDLE_MS) {
            activeTokens.delete(tok);
        }
    }

    if (activeTokens.size > MAX_TOKENS) {
        for (const tok of activeTokens.keys()) {
            activeTokens.delete(tok);
            if (activeTokens.size <= 1500) {
                break;
            }
        }
    }

    const token = crypto.randomUUID();
    activeTokens.set(token, {
        token,
        scriptId: sanitizeScriptId(scriptId),
        pageHostname: String(pageHostname || '').toLowerCase(),
        pageOrigin: pageOrigin !== undefined ? String(pageOrigin) : undefined,
        connects: Array.isArray(connects) ? connects.map(c => String(c).trim()).filter(Boolean) : [],
        grants: Array.isArray(grants) ? grants.map(g => String(g).trim()).filter(Boolean) : [],
        createdAt: now,
        lastUsedAt: now,
        boundSenderId: null
    });

    if (activeTokens.size > MAX_TOKENS) {
        for (const tok of activeTokens.keys()) {
            activeTokens.delete(tok);
            if (activeTokens.size <= 1500) {
                break;
            }
        }
    }

    return token;
}

function revokeTokensForSender(senderId) {
    if (senderId === undefined || senderId === null) return;
    for (const [tok, data] of activeTokens.entries()) {
        if (data && data.boundSenderId === senderId) {
            activeTokens.delete(tok);
        }
    }
}

function validateTokenSender(tokenData, event) {
    if (!tokenData) {
        throw new Error('Unauthorized: Invalid or expired GM token');
    }
    const now = Date.now();
    if (tokenData.lastUsedAt && (now - tokenData.lastUsedAt > TOKEN_IDLE_MS)) {
        if (tokenData.token) {
            activeTokens.delete(tokenData.token);
        } else {
            for (const [tok, data] of activeTokens.entries()) {
                if (data === tokenData) {
                    activeTokens.delete(tok);
                    break;
                }
            }
        }
        throw new Error('Unauthorized: Invalid or expired GM token');
    }

    if (!event || !event.sender) {
        throw new Error('Authorisation failure: Unable to verify GM token sender');
    }

    if (event.senderFrame === null) {
        throw new Error('Authorisation failure: Sender frame mismatch');
    }

    if (event.sender.mainFrame !== undefined && event.sender.mainFrame !== null) {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
            throw new Error('Authorisation failure: Sender frame mismatch');
        }
    } else if (event.senderFrame !== undefined) {
        if (event.senderFrame !== event.sender.mainFrame) {
            throw new Error('Authorisation failure: Sender frame mismatch');
        }
    }

    let senderUrl = '';
    let senderHost = '';
    let senderProtocol = '';
    let senderOrigin = '';
    try {
        senderUrl = typeof event.sender.getURL === 'function' ? event.sender.getURL() : '';
        if (senderUrl) {
            const parsed = new URL(senderUrl);
            senderHost = parsed.hostname.toLowerCase();
            senderProtocol = parsed.protocol.toLowerCase();
            senderOrigin = parsed.origin;
        }
    } catch (e) {}

    if (typeof tokenData.pageOrigin === 'string') {
        if (tokenData.pageOrigin === 'null') {
            if (senderProtocol !== 'file:') {
                throw new Error('Authorisation failure: Origin mismatch for GM token');
            }
        } else {
            if (senderOrigin !== tokenData.pageOrigin) {
                throw new Error('Authorisation failure: Origin mismatch for GM token');
            }
        }
    } else {
        const expectedHost = tokenData.pageHostname || '';
        if (!expectedHost) {
            if (senderProtocol !== 'file:' || senderHost !== '') {
                throw new Error('Authorisation failure: Origin mismatch for GM token');
            }
        } else {
            if (senderHost !== expectedHost && !senderHost.endsWith('.' + expectedHost)) {
                throw new Error('Authorisation failure: Origin mismatch for GM token');
            }
        }
    }

    if (tokenData.boundSenderId === null || tokenData.boundSenderId === undefined) {
        tokenData.boundSenderId = event.sender.id;
    } else if (tokenData.boundSenderId !== event.sender.id) {
        throw new Error('Authorisation failure: token bound to another webContents');
    }

    if (event.sender && typeof event.sender === 'object') {
        if (!wiredSenders.has(event.sender)) {
            wiredSenders.add(event.sender);
            if (typeof event.sender.on === 'function') {
                event.sender.on('did-navigate', () => {
                    revokeTokensForSender(event.sender.id);
                });
            }
            if (typeof event.sender.once === 'function') {
                event.sender.once('destroyed', () => {
                    revokeTokensForSender(event.sender.id);
                });
            }
        }
    }

    tokenData.lastUsedAt = Date.now();
}

const blockedIPList = new nodeNet.BlockList();
// IPv4 restricted subnets
blockedIPList.addSubnet('0.0.0.0', 8, 'ipv4');
blockedIPList.addSubnet('10.0.0.0', 8, 'ipv4');
blockedIPList.addSubnet('100.64.0.0', 10, 'ipv4');
blockedIPList.addSubnet('127.0.0.0', 8, 'ipv4');
blockedIPList.addSubnet('169.254.0.0', 16, 'ipv4');
blockedIPList.addSubnet('172.16.0.0', 12, 'ipv4');
blockedIPList.addSubnet('192.168.0.0', 16, 'ipv4');
for (const [a, p] of [['192.0.0.0',24],['192.0.2.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blockedIPList.addSubnet(a, p, 'ipv4');

// IPv6 restricted subnets
blockedIPList.addSubnet('::1', 128, 'ipv6');
blockedIPList.addSubnet('::', 128, 'ipv6');
blockedIPList.addSubnet('fc00::', 7, 'ipv6');
blockedIPList.addSubnet('fe80::', 10, 'ipv6');
blockedIPList.addSubnet('64:ff9b::', 96, 'ipv6');
blockedIPList.addSubnet('2002::', 16, 'ipv6');
for (const [a, p] of [['ff00::',8],['2001:db8::',32],['100::',64],['fec0::',10],['2001::',32],['::ffff:0:0:0',96]]) blockedIPList.addSubnet(a, p, 'ipv6');

function normaliseIPAddress(ip) {
    if (!ip || typeof ip !== 'string') return '';
    let clean = ip.trim();
    if (clean.includes('://')) {
        try {
            clean = new URL(clean).hostname;
        } catch {
            return '';
        }
    }
    clean = clean.replace(/^\[|\]$/g, '').trim().toLowerCase();

    // Normalise decimal or integer IP representation
    if (/^\d+$/.test(clean)) {
        try {
            clean = new URL(`http://${clean}`).hostname;
        } catch {
            return '';
        }
    }

    // Normalise IPv4-mapped dotted format (e.g. ::ffff:127.0.0.1)
    if (clean.startsWith('::ffff:') && nodeNet.isIPv4(clean.slice(7))) {
        return clean.slice(7);
    }

    // Normalise IPv4-compatible dotted format (e.g. ::127.0.0.1)
    if (clean.startsWith('::') && !clean.startsWith('::ffff:') && nodeNet.isIPv4(clean.slice(2))) {
        return clean.slice(2);
    }

    // Normalise IPv4-mapped or IPv4-compatible hex format (e.g. ::ffff:7f00:1 or ::7f00:1)
    const hexMatch = clean.match(/^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
        const high = parseInt(hexMatch[1], 16);
        const low = parseInt(hexMatch[2], 16);
        return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
    }

    return clean;
}

function isPrivateOrBlockedIP(ip) {
    if (!ip || typeof ip !== 'string') return true;
    const cleanIp = normaliseIPAddress(ip);
    if (!cleanIp) return true;

    if (nodeNet.isIPv4(cleanIp)) {
        return blockedIPList.check(cleanIp, 'ipv4');
    }
    if (nodeNet.isIPv6(cleanIp)) {
        return blockedIPList.check(cleanIp, 'ipv6');
    }
    return true;
}

function isHostAllowed(targetHostname, pageHostname, allowedConnects) {
    if (!targetHostname) return false;
    const target = targetHostname.toLowerCase();
    const page = (pageHostname || '').toLowerCase();

    // Same-origin and subdomains of the hosting page are implicitly permitted
    if (page && (target === page || target.endsWith('.' + page))) {
        return true;
    }

    if (!Array.isArray(allowedConnects) || allowedConnects.length === 0) {
        return false;
    }

    for (const rule of allowedConnects) {
        let pattern = String(rule || '').trim().toLowerCase();
        if (!pattern) continue;

        if (pattern.includes('://')) {
            try {
                pattern = new URL(pattern).hostname.toLowerCase();
            } catch {
                // Ignore parse errors, continue with pattern
            }
        }

        // Universal wildcard permits any public host
        if (pattern === '*') {
            return true;
        }

        // 'self' keyword explicitly matches the hosting page
        if (pattern === 'self') {
            if (page && (target === page || target.endsWith('.' + page))) {
                return true;
            }
            continue;
        }

        // Wildcard subdomain prefix (e.g. *.example.com)
        if (pattern.startsWith('*.')) {
            const root = pattern.slice(2);
            if (target === root || target.endsWith('.' + root)) {
                return true;
            }
            continue;
        }

        // Exact host match or parent domain matching all subdomains
        if (target === pattern || target.endsWith('.' + pattern)) {
            return true;
        }
    }

    return false;
}

async function validateRequestDestination(targetUrl, tokenData) {
    if (!targetUrl || typeof targetUrl !== 'string') {
        throw new Error('Valid URL string is required for request');
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(targetUrl);
    } catch {
        throw new Error(`Invalid URL provided: "${targetUrl}"`);
    }

    const protocol = parsedUrl.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
        throw new Error(`Unsupported protocol "${protocol}". Only http: and https: requests are permitted`);
    }

    // Verify @grant authorisation if grants are declared by the userscript
    if (tokenData && Array.isArray(tokenData.grants) && tokenData.grants.length > 0) {
        const hasNetGrant = tokenData.grants.some(g => {
            const lower = String(g).trim().toLowerCase();
            return lower === 'gm_xmlhttprequest' || lower === 'gm.xmlhttprequest' || lower === '*' || lower === 'gm_*';
        });
        if (!hasNetGrant) {
            throw new Error('Permission denied: userscript does not declare @grant GM_xmlhttpRequest');
        }
    }

    const targetHostname = parsedUrl.hostname.toLowerCase();
    const cleanHost = targetHostname.replace(/^\[|\]$/g, '');

    // Validate declared @connect host permissions
    const pageHostname = (tokenData && tokenData.pageHostname) || '';
    const allowedConnects = (tokenData && tokenData.connects) || [];
    if (!isHostAllowed(targetHostname, pageHostname, allowedConnects)) {
        throw new Error(`Permission denied: host "${targetHostname}" is not declared in userscript @connect directives`);
    }

    // Reject internal or local domain names unconditionally
    if (
        cleanHost === 'localhost' ||
        cleanHost.endsWith('.localhost') ||
        cleanHost.endsWith('.local') ||
        cleanHost.endsWith('.lan') ||
        cleanHost.endsWith('.internal') ||
        cleanHost.endsWith('.home.arpa')
    ) {
        throw new Error(`SSRF protection: host "${targetHostname}" is a restricted local or internal domain`);
    }

    // Direct IP address validation against restricted ranges
    if (nodeNet.isIP(cleanHost)) {
        if (isPrivateOrBlockedIP(cleanHost)) {
            throw new Error(`SSRF protection: destination IP "${cleanHost}" belongs to a private or restricted network range`);
        }
        parsedUrl.pinnedIp = cleanHost;
        parsedUrl.pinnedFamily = nodeNet.isIP(cleanHost);
        return parsedUrl;
    }

    // Resolve domain name via DNS to prevent DNS rebinding or internal IP mapping
    let addresses = [];
    try {
        addresses = await dns.promises.lookup(cleanHost, { all: true });
    } catch (dnsErr) {
        throw new Error(`DNS resolution failed for host "${targetHostname}": ${dnsErr.message}`);
    }

    if (!addresses || addresses.length === 0) {
        throw new Error(`DNS resolution returned no records for host "${targetHostname}"`);
    }

    for (const record of addresses) {
        if (isPrivateOrBlockedIP(record.address)) {
            throw new Error(`SSRF protection: host "${targetHostname}" resolved to restricted IP ${record.address}`);
        }
    }

    parsedUrl.pinnedIp = addresses[0].address;
    parsedUrl.pinnedFamily = addresses[0].family;
    return parsedUrl;
}

function hasStorageGrant(tokenData) {
    if (!tokenData || !Array.isArray(tokenData.grants) || tokenData.grants.length === 0) {
        return true;
    }
    return tokenData.grants.some(g => {
        const lower = String(g).trim().toLowerCase();
        return lower === 'gm_setvalue' || lower === 'gm_getvalue' || lower === 'gm_deletevalue' ||
               lower === 'gm_listvalues' || lower === 'gm.*' || lower === '*' || lower === 'gm_*';
    });
}

function createPinnedDispatcher(targetValidation) {
    if (targetValidation && targetValidation.pinnedIp && !nodeNet.isIP(targetValidation.hostname)) {
        if (!UndiciAgent) {
            try {
                UndiciAgent = require('undici').Agent;
            } catch {}
        }
        if (!UndiciAgent) {
            throw new Error('DNS pinning failed: undici is not available');
        }
        return new UndiciAgent({
            connect: {
                lookup: (hostname, opts, cb) => {
                    cb(null, [{ address: targetValidation.pinnedIp, family: targetValidation.pinnedFamily }]);
                }
            }
        });
    }
    return null;
}

function removeHeadersCaseInsensitive(headers, namesToRemove) {
    if (!headers || typeof headers !== 'object') return;
    const lowerNames = namesToRemove.map(n => n.toLowerCase());
    for (const key of Object.keys(headers)) {
        if (lowerNames.includes(key.toLowerCase())) {
            delete headers[key];
        }
    }
}

function filterCrossOriginHeaders(headers) {
    const sensitive = ['authorization', 'cookie', 'proxy-authorization'];
    const filtered = {};
    for (const [key, value] of Object.entries(headers || {})) {
        if (!sensitive.includes(key.toLowerCase())) {
            filtered[key] = value;
        }
    }
    return filtered;
}

async function readBoundedResponseBody(res, maxResponseBytes, controller) {
    const clHeader = res.headers && typeof res.headers.get === 'function'
        ? res.headers.get('content-length')
        : (res.headers && res.headers['content-length']);

    if (clHeader !== null && clHeader !== undefined && String(clHeader).trim() !== '') {
        const contentLength = Number(clHeader);
        if (!isNaN(contentLength) && contentLength > maxResponseBytes) {
            if (controller && typeof controller.abort === 'function') {
                controller.abort();
            }
            throw new Error('Response exceeds size limit');
        }
    }

    if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let text = '';
        let bytesRead = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                if (value) {
                    const chunkLength = (value && typeof value.byteLength === 'number')
                        ? value.byteLength
                        : ((value && value.length) || 0);
                    bytesRead += chunkLength;
                    if (bytesRead > maxResponseBytes) {
                        if (controller && typeof controller.abort === 'function') {
                            controller.abort();
                        }
                        try {
                            await reader.cancel();
                        } catch {}
                        throw new Error('Response exceeds size limit');
                    }
                    text += decoder.decode(value, { stream: true });
                }
            }
            text += decoder.decode();
            return text;
        } catch (err) {
            try {
                await reader.cancel();
            } catch {}
            throw err;
        }
    }

    if (typeof res.text === 'function') {
        const text = await res.text();
        const byteLength = Buffer.byteLength(text, 'utf-8');
        if (byteLength > maxResponseBytes || text.length > maxResponseBytes) {
            if (controller && typeof controller.abort === 'function') {
                controller.abort();
            }
            throw new Error('Response exceeds size limit');
        }
        return text;
    }

    return '';
}

async function executeGmXmlHttpRequest(details, tokenData = null, deps = {}) {
    if (!details || typeof details !== 'object' || !details.url) {
        throw new Error('Valid URL is required for GM_xmlhttpRequest');
    }

    const method = String(details.method || 'GET').toUpperCase();
    const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    if (!ALLOWED_METHODS.includes(method)) {
        throw new Error('Unsupported HTTP method');
    }

    let bodyData = undefined;
    if (details.data !== undefined && details.data !== null) {
        const serialized = typeof details.data === 'object' ? JSON.stringify(details.data) : String(details.data);
        if (serialized.length > 5 * 1024 * 1024) {
            throw new Error('Request body too large');
        }
        if (method !== 'GET' && method !== 'HEAD') {
            bodyData = serialized;
        }
    }

    let rawTimeout = Number(details.timeout);
    if (details.timeout === undefined || details.timeout === null || isNaN(rawTimeout)) {
        rawTimeout = 30000;
    }
    const timeout = Math.min(Math.max(rawTimeout, 1000), 120000);

    const actualDeps = deps || {};
    const fetchFn = actualDeps.fetchFn || ((typeof globalThis.fetch === 'function')
        ? globalThis.fetch
        : ((net && typeof net.fetch === 'function') ? net.fetch : null));
    const validate = actualDeps.validate || validateRequestDestination;
    const createDispatcher = actualDeps.createDispatcher || createPinnedDispatcher;
    const setTimeoutFn = actualDeps.setTimeoutFn || setTimeout;
    const maxResponseBytes = typeof actualDeps.maxResponseBytes === 'number'
        ? actualDeps.maxResponseBytes
        : 10 * 1024 * 1024;

    if (!fetchFn) {
        throw new Error('No fetch implementation available in runtime');
    }

    const headers = Object.assign({}, details.headers || {});
    const hasUserAgent = Object.keys(headers).some(k => k.toLowerCase() === 'user-agent');
    if (!hasUserAgent) {
        headers['User-Agent'] = actualDeps.userAgent
            || (app && app.userAgentFallback)
            || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
    }

    const controller = new AbortController();
    const timer = setTimeoutFn(() => controller.abort(), timeout);

    const init = {
        method,
        headers,
        signal: controller.signal
    };
    if (bodyData !== undefined) {
        init.body = bodyData;
    }

    let currentUrl = details.url;
    const isManualRedirect = (details.redirect === 'manual' || details.redirect === 'error');
    const maxRedirects = 5;
    let redirectCount = 0;
    let activeDispatcher = null;

    try {
        let validated = await validate(currentUrl, tokenData);
        let res;
        while (true) {
            const reqInit = Object.assign({}, init, {
                headers: Object.assign({}, init.headers),
                redirect: 'manual'
            });
            if (activeDispatcher && typeof activeDispatcher.destroy === 'function') {
                activeDispatcher.destroy();
                activeDispatcher = null;
            }
            activeDispatcher = createDispatcher(validated);
            if (activeDispatcher) {
                reqInit.dispatcher = activeDispatcher;
            }

            res = await fetchFn(currentUrl, reqInit);

            const isRedirectStatus = [301, 302, 303, 307, 308].includes(res.status);
            if (isRedirectStatus) {
                if (details.redirect === 'error') {
                    throw new Error('Encountered unexpected redirect with redirect=error');
                }
                if (!isManualRedirect) {
                    const locationHeader = res.headers && typeof res.headers.get === 'function'
                        ? res.headers.get('location')
                        : (res.headers && res.headers.location);

                    if (locationHeader) {
                        if (redirectCount >= maxRedirects) {
                            throw new Error('Too many redirects encountered');
                        }
                        redirectCount++;
                        const nextUrl = new URL(locationHeader, currentUrl).href;
                        validated = await validate(nextUrl, tokenData);

                        if (new URL(nextUrl).origin !== new URL(currentUrl).origin) {
                            init.headers = filterCrossOriginHeaders(init.headers);
                        }

                        if (res.status === 303) {
                            if (init.method !== 'HEAD') {
                                init.method = 'GET';
                            }
                            delete init.body;
                            removeHeadersCaseInsensitive(init.headers, ['content-type', 'content-length', 'transfer-encoding']);
                        } else if ((res.status === 301 || res.status === 302) && init.method === 'POST') {
                            init.method = 'GET';
                            delete init.body;
                            removeHeadersCaseInsensitive(init.headers, ['content-type', 'content-length', 'transfer-encoding']);
                        }

                        currentUrl = nextUrl;
                        continue;
                    }
                }
            }
            break;
        }

        const responseText = await readBoundedResponseBody(res, maxResponseBytes, controller);
        let responseHeaders = '';
        if (res.headers && typeof res.headers.forEach === 'function') {
            res.headers.forEach((val, key) => {
                responseHeaders += `${key}: ${val}\r\n`;
            });
        } else if (res.headers && typeof res.headers === 'object') {
            for (const [key, val] of Object.entries(res.headers)) {
                responseHeaders += `${key}: ${val}\r\n`;
            }
        }

        return {
            status: res.status,
            statusText: res.statusText,
            readyState: 4,
            responseText,
            responseHeaders,
            finalUrl: currentUrl
        };
    } catch (err) {
        const isTimeout = err.name === 'AbortError' || err.code === 'ETIMEDOUT';
        throw {
            isTimeout,
            message: err.message || 'Request failed',
            status: isTimeout ? 0 : 0,
            statusText: isTimeout ? 'Timeout' : 'Error'
        };
    } finally {
        if (timer !== null) {
            try {
                clearTimeout(timer);
            } catch {}
        }
        if (activeDispatcher && typeof activeDispatcher.destroy === 'function') {
            activeDispatcher.destroy();
            activeDispatcher = null;
        }
    }
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patternToRegex(pattern) {
    if (!pattern || typeof pattern !== 'string') return null;
    const trimmed = pattern.trim();
    if (!trimmed) return null;

    if (trimmed === '<all_urls>' || trimmed === '*' || trimmed === '*://*/*') {
        return /^https?:\/\/.+/i;
    }

    if (trimmed.startsWith('/') && trimmed.endsWith('/') && trimmed.length > 2) {
        try {
            return new RegExp(trimmed.slice(1, -1), 'i');
        } catch {
            return null;
        }
    }

    const matchScheme = trimmed.match(/^(\*|https?|file|ftp):\/\/(?:(\*|(?:\*\.)?[^\/]+))(\/.*)?$/i);
    if (matchScheme) {
        const scheme = matchScheme[1];
        const host = matchScheme[2];
        const pathPart = matchScheme[3] || '/*';

        const schemeRegex = (scheme === '*') ? 'https?' : escapeRegex(scheme);
        let hostRegex;
        if (host === '*') {
            hostRegex = '[^\\/]+';
        } else if (host.startsWith('*.')) {
            const rootDomain = escapeRegex(host.slice(2));
            hostRegex = `(?:[^\\/]+\\.)?${rootDomain}`;
        } else {
            hostRegex = escapeRegex(host);
        }

        const pathRegex = escapeRegex(pathPart).replace(/\\\*/g, '.*');
        return new RegExp(`^${schemeRegex}:\\/\\/${hostRegex}${pathRegex}$`, 'i');
    }

    const escaped = escapeRegex(trimmed).replace(/\\\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
}

function parseUserScriptMetadata(content, filename) {
    const meta = {
        name: path.basename(filename, path.extname(filename)).replace(/\.user$/, ''),
        version: '1.0',
        description: '',
        author: '',
        namespace: '',
        homepage: '',
        matches: [],
        includes: [],
        excludes: [],
        connects: [],
        grants: [],
        runAt: 'document-end',
        matchRegexes: [],
        includeRegexes: [],
        excludeRegexes: []
    };

    const blockMatch = content.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/i);
    if (blockMatch) {
        const lines = blockMatch[1].split(/\r?\n/);
        for (const line of lines) {
            const matchDirective = line.match(/^\s*(?:\/\/|\*|\/\*)?\s*@([a-zA-Z0-9_-]+)(?:\s+(.*))?/);
            if (matchDirective) {
                const directive = matchDirective[1].toLowerCase();
                const value = (matchDirective[2] || '').trim();
                if (!value) continue;

                if (directive === 'name') {
                    meta.name = value;
                } else if (directive === 'version') {
                    meta.version = value;
                } else if (directive === 'description') {
                    meta.description = value;
                } else if (directive === 'author') {
                    meta.author = value;
                } else if (directive === 'namespace') {
                    meta.namespace = value;
                } else if (directive === 'homepage' || directive === 'homepageurl') {
                    meta.homepage = value;
                } else if (directive === 'match') {
                    meta.matches.push(value);
                } else if (directive === 'include') {
                    meta.includes.push(value);
                } else if (directive === 'exclude') {
                    meta.excludes.push(value);
                } else if (directive === 'connect') {
                    meta.connects.push(value);
                } else if (directive === 'grant') {
                    meta.grants.push(value);
                } else if (directive === 'run-at' || directive === 'runat') {
                    meta.runAt = value.toLowerCase();
                }
            }
        }
    }

    meta.matchRegexes = meta.matches.map(patternToRegex).filter(Boolean);
    meta.includeRegexes = meta.includes.map(patternToRegex).filter(Boolean);
    meta.excludeRegexes = meta.excludes.map(patternToRegex).filter(Boolean);

    return meta;
}

function parseUserStyleMetadata(content, filename) {
    const meta = {
        name: path.basename(filename, path.extname(filename)).replace(/\.user$/, ''),
        matches: [],
        includes: [],
        excludes: [],
        matchRegexes: [],
        includeRegexes: [],
        excludeRegexes: [],
        sections: [],
        hasMozDoc: false
    };

    const blockMatch = content.match(/(?:\/\*|\/\/)\s*==UserStyle==([\s\S]*?)(?:==\/UserStyle==\s*\*\/|\/\/\s*==\/UserStyle==)/i);
    if (blockMatch) {
        const lines = blockMatch[1].split(/\r?\n/);
        for (const line of lines) {
            const matchDirective = line.match(/^\s*(?:\/\/|\*|\/\*)?\s*@([a-zA-Z0-9_-]+)(?:\s+(.*))?/);
            if (matchDirective) {
                const directive = matchDirective[1].toLowerCase();
                const value = (matchDirective[2] || '').trim().replace(/\*\/$/, '').trim();
                if (!value) continue;

                if (directive === 'name') {
                    meta.name = value;
                } else if (directive === 'match') {
                    meta.matches.push(value);
                } else if (directive === 'include') {
                    meta.includes.push(value);
                } else if (directive === 'exclude') {
                    meta.excludes.push(value);
                }
            }
        }
    }

    meta.matchRegexes = meta.matches.map(patternToRegex).filter(Boolean);
    meta.includeRegexes = meta.includes.map(patternToRegex).filter(Boolean);
    meta.excludeRegexes = meta.excludes.map(patternToRegex).filter(Boolean);

    // Support classic @-moz-document scoping rules
    const mozDocRegex = /@-moz-document\s+([^{]+)\{([\s\S]*?)\}(?=\s*(?:@-moz-document|$))/gi;
    let match;
    while ((match = mozDocRegex.exec(content)) !== null) {
        meta.hasMozDoc = true;
        const conditionStr = match[1];
        const cssRules = match[2];
        const conditions = [];

        const fnRegex = /(domain|url-prefix|url|regexp)\(\s*["']?([^"')]+)["']?\s*\)/gi;
        let fnMatch;
        while ((fnMatch = fnRegex.exec(conditionStr)) !== null) {
            conditions.push({
                type: fnMatch[1].toLowerCase(),
                value: fnMatch[2].trim()
            });
        }

        meta.sections.push({
            conditions,
            css: cssRules
        });
    }

    return meta;
}

function urlMatchesRule(url, meta) {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('about:') || url.startsWith('chrome:') || url.startsWith('devtools:')) {
        return false;
    }

    if (Array.isArray(meta.excludeRegexes) && meta.excludeRegexes.length > 0) {
        for (const regex of meta.excludeRegexes) {
            if (regex && regex.test(url)) return false;
        }
    }

    const hasExplicitMatches = (meta.matchRegexes && meta.matchRegexes.length > 0) ||
                               (meta.includeRegexes && meta.includeRegexes.length > 0);

    if (!hasExplicitMatches) {
        return url.startsWith('http://') || url.startsWith('https://');
    }

    if (Array.isArray(meta.matchRegexes)) {
        for (const regex of meta.matchRegexes) {
            if (regex && regex.test(url)) return true;
        }
    }

    if (Array.isArray(meta.includeRegexes)) {
        for (const regex of meta.includeRegexes) {
            if (regex && regex.test(url)) return true;
        }
    }

    return false;
}

function matchesMozDocCondition(url, hostname, condition) {
    const type = condition.type;
    const val = condition.value;

    if (type === 'domain') {
        const lowerHost = hostname.toLowerCase();
        const lowerVal = val.toLowerCase();
        return lowerHost === lowerVal || lowerHost.endsWith('.' + lowerVal);
    }
    if (type === 'url') {
        return url === val;
    }
    if (type === 'url-prefix') {
        return url.startsWith(val);
    }
    if (type === 'regexp') {
        try {
            const re = new RegExp(val, 'i');
            return re.test(url);
        } catch {
            return false;
        }
    }
    return false;
}

function reloadScripts() {
    const nextScripts = [];
    try {
        if (!fs.existsSync(scriptsDir)) {
            fs.mkdirSync(scriptsDir, { recursive: true });
        }
        const entries = fs.readdirSync(scriptsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (entry.name.startsWith('.')) continue;
            if (!entry.name.endsWith('.js')) continue;

            const filePath = path.join(scriptsDir, entry.name);
            try {
                const code = fs.readFileSync(filePath, 'utf8');
                const meta = parseUserScriptMetadata(code, entry.name);
                nextScripts.push({
                    name: meta.name,
                    filename: entry.name,
                    filePath,
                    code,
                    meta
                });
            } catch (fileErr) {
                console.error(`Failed to read user script ${entry.name}:`, fileErr);
            }
        }
    } catch (err) {
        console.error('Failed to read scripts directory:', err);
    }

    loadedScripts = nextScripts;
    return loadedScripts.length;
}

function reloadStyles() {
    const nextStyles = [];
    try {
        if (!fs.existsSync(stylesDir)) {
            fs.mkdirSync(stylesDir, { recursive: true });
        }
        const entries = fs.readdirSync(stylesDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (entry.name.startsWith('.')) continue;
            if (!entry.name.endsWith('.css')) continue;

            const filePath = path.join(stylesDir, entry.name);
            try {
                const css = fs.readFileSync(filePath, 'utf8');
                const meta = parseUserStyleMetadata(css, entry.name);
                nextStyles.push({
                    name: meta.name,
                    filename: entry.name,
                    filePath,
                    css,
                    meta
                });
            } catch (fileErr) {
                console.error(`Failed to read user style ${entry.name}:`, fileErr);
            }
        }
    } catch (err) {
        console.error('Failed to read styles directory:', err);
    }

    loadedStyles = nextStyles;
    return loadedStyles.length;
}

function notifyRenderer(kind) {
    if (cachedMainWindow && !cachedMainWindow.isDestroyed()) {
        cachedMainWindow.webContents.send('user-content-updated', kind);
    }
}

function setupWatchers() {
    try {
        if (scriptsWatcher) scriptsWatcher.close();
        if (fs.existsSync(scriptsDir)) {
            scriptsWatcher = fs.watch(scriptsDir, (eventType, filename) => {
                if (debounceTimerScripts) clearTimeout(debounceTimerScripts);
                debounceTimerScripts = setTimeout(() => {
                    reloadScripts();
                    notifyRenderer('scripts');
                }, 200);
            });
        }
    } catch (err) {
        console.error('Failed to setup user scripts watcher:', err);
    }

    try {
        if (stylesWatcher) stylesWatcher.close();
        if (fs.existsSync(stylesDir)) {
            stylesWatcher = fs.watch(stylesDir, (eventType, filename) => {
                if (debounceTimerStyles) clearTimeout(debounceTimerStyles);
                debounceTimerStyles = setTimeout(() => {
                    reloadStyles();
                    notifyRenderer('styles');
                }, 200);
            });
        }
    } catch (err) {
        console.error('Failed to setup user styles watcher:', err);
    }
}

function createTemplateFilesIfEmpty() {
    try {
        const scriptTemplatePath = path.join(scriptsDir, 'template.user.js');
        if (!fs.existsSync(scriptTemplatePath)) {
            const sampleScript = `// ==UserScript==
// @name         Example User Script
// @match        https://example.com/*
// @run-at       document-end
// ==/UserScript==

// Local user script executed automatically on matching pages
console.log('[Mise UserScript] Active on:', window.location.href);
`;
            fs.writeFileSync(scriptTemplatePath, sampleScript, 'utf8');
        }

        const styleTemplatePath = path.join(stylesDir, 'template.user.css');
        if (!fs.existsSync(styleTemplatePath)) {
            const sampleStyle = `/* ==UserStyle==
@name           Example User Style
@match          https://example.com/*
==/UserStyle== */

/* Custom CSS injected into matching web pages */
body {
    /* outline: 2px solid #7aa2f7 !important; */
}
`;
            fs.writeFileSync(styleTemplatePath, sampleStyle, 'utf8');
        }
    } catch (err) {
        console.error('Failed to write template user files:', err);
    }
}

function getMatchingUserStyles(targetUrl) {
    if (!targetUrl || typeof targetUrl !== 'string') {
        return { styles: [] };
    }

    let hostname = '';
    try {
        const parsed = new URL(targetUrl);
        hostname = parsed.hostname.toLowerCase();
    } catch {
        return { styles: [] };
    }

    const matchingStyles = [];
    for (const item of loadedStyles) {
        if (item.meta && item.meta.hasMozDoc && Array.isArray(item.meta.sections) && item.meta.sections.length > 0) {
            let combinedSectionCss = '';
            for (const section of item.meta.sections) {
                const matchesAny = section.conditions && section.conditions.some(cond => matchesMozDocCondition(targetUrl, hostname, cond));
                if (matchesAny) {
                    combinedSectionCss += section.css + '\n';
                }
            }
            if (combinedSectionCss.trim()) {
                matchingStyles.push({
                    name: item.name,
                    filename: item.filename,
                    css: combinedSectionCss
                });
            }
        } else if (item.meta && urlMatchesRule(targetUrl, item.meta)) {
            matchingStyles.push({
                name: item.name,
                filename: item.filename,
                css: item.css
            });
        }
    }

    return { styles: matchingStyles };
}

function getMatchingUserContent(targetUrl) {
    if (!targetUrl || typeof targetUrl !== 'string') {
        return { scripts: [], styles: [] };
    }

    let hostname = '';
    let pageOrigin = undefined;
    try {
        const parsed = new URL(targetUrl);
        hostname = parsed.hostname.toLowerCase();
        pageOrigin = parsed.origin;
    } catch {
        return { scripts: [], styles: [] };
    }

    const matchingScripts = [];
    for (const item of loadedScripts) {
        if (urlMatchesRule(targetUrl, item.meta)) {
            const scriptId = item.filename.replace(/\.js$/, '');
            matchingScripts.push({
                name: item.name,
                filename: item.filename,
                scriptId: scriptId,
                code: item.code,
                runAt: item.meta.runAt,
                meta: item.meta,
                storage: loadScriptStorage(scriptId),
                token: generateScriptToken(scriptId, hostname, item.meta.connects, item.meta.grants, pageOrigin)
            });
        }
    }

    const matchingStyles = getMatchingUserStyles(targetUrl).styles;

    return {
        scripts: matchingScripts,
        styles: matchingStyles
    };
}

function initializeUserContent(configDir, mainWindow) {
    scriptsDir = path.join(configDir, 'scripts');
    stylesDir = path.join(configDir, 'styles');
    storageDir = path.join(configDir, 'script-storage');
    cachedMainWindow = mainWindow;

    if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
    if (!fs.existsSync(stylesDir)) fs.mkdirSync(stylesDir, { recursive: true });
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

    createTemplateFilesIfEmpty();
    reloadScripts();
    reloadStyles();
    setupWatchers();

    if (!beforeQuitRegistered && app && typeof app.on === 'function') {
        app.on('before-quit', () => {
            flushScriptStorage();
        });
        beforeQuitRegistered = true;
    }

    ipcMain.handle('get-user-content-for-url', (event, url) => {
        return getMatchingUserContent(url);
    });

    ipcMain.handle('get-user-styles-for-url', (event, url) => {
        return getMatchingUserStyles(url);
    });

    ipcMain.handle('reload-user-content', () => {
        const scCount = reloadScripts();
        const stCount = reloadStyles();
        notifyRenderer('all');
        return { scriptsCount: scCount, stylesCount: stCount };
    });

    ipcMain.handle('open-user-scripts-dir', async () => {
        if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
        return shell.openPath(scriptsDir);
    });

    ipcMain.handle('open-user-styles-dir', async () => {
        if (!fs.existsSync(stylesDir)) fs.mkdirSync(stylesDir, { recursive: true });
        return shell.openPath(stylesDir);
    });

    ipcMain.handle('open-user-script-storage-dir', async () => {
        if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
        return shell.openPath(storageDir);
    });

    ipcMain.handle('get-user-content-summary', () => {
        return {
            scriptsCount: loadedScripts.length,
            stylesCount: loadedStyles.length,
            scripts: loadedScripts.map(s => ({ name: s.name, filename: s.filename })),
            styles: loadedStyles.map(s => ({ name: s.name, filename: s.filename }))
        };
    });

    ipcMain.handle('gm-xmlhttprequest', async (event, payload) => {
        const { token, details } = payload || {};
        if (!token || !activeTokens.has(token)) {
            throw new Error('Unauthorized: Invalid or expired GM token');
        }
        const tokenData = activeTokens.get(token);
        validateTokenSender(tokenData, event);
        return executeGmXmlHttpRequest(details, tokenData);
    });

    ipcMain.handle('gm-storage-set', async (event, payload) => {
        const { token, scriptId, key, value } = payload || {};
        if (!token || !activeTokens.has(token)) {
            throw new Error('Unauthorized: Invalid or expired GM token');
        }
        const tokenData = activeTokens.get(token);
        validateTokenSender(tokenData, event);
        if (!tokenData || tokenData.scriptId !== sanitizeScriptId(scriptId)) {
            throw new Error('Unauthorized: Script ID mismatch');
        }
        if (!hasStorageGrant(tokenData)) {
            throw new Error('Permission denied: userscript does not declare storage @grant');
        }
        if (!isValidStorageKey(key)) {
            throw new Error('Permission denied: invalid or forbidden storage key');
        }
        setScriptValue(scriptId, key, value, { defer: true });
        return true;
    });

    ipcMain.handle('gm-storage-delete', async (event, payload) => {
        const { token, scriptId, key } = payload || {};
        if (!token || !activeTokens.has(token)) {
            throw new Error('Unauthorized: Invalid or expired GM token');
        }
        const tokenData = activeTokens.get(token);
        validateTokenSender(tokenData, event);
        if (!tokenData || tokenData.scriptId !== sanitizeScriptId(scriptId)) {
            throw new Error('Unauthorized: Script ID mismatch');
        }
        if (!hasStorageGrant(tokenData)) {
            throw new Error('Permission denied: userscript does not declare storage @grant');
        }
        if (!isValidStorageKey(key)) {
            return true;
        }
        deleteScriptValue(scriptId, key, { defer: true });
        return true;
    });

    ipcMain.handle('gm-storage-get', async (event, payload) => {
        const { token, scriptId } = payload || {};
        if (!token || !activeTokens.has(token)) {
            throw new Error('Unauthorized: Invalid or expired GM token');
        }
        const tokenData = activeTokens.get(token);
        validateTokenSender(tokenData, event);
        if (!tokenData || tokenData.scriptId !== sanitizeScriptId(scriptId)) {
            throw new Error('Unauthorized: Script ID mismatch');
        }
        if (!hasStorageGrant(tokenData)) {
            throw new Error('Permission denied: userscript does not declare storage @grant');
        }
        return loadScriptStorage(scriptId);
    });
}

module.exports = {
    initializeUserContent,
    reloadScripts,
    reloadStyles,
    getMatchingUserContent,
    getMatchingUserStyles,
    loadScriptStorage,
    saveScriptStorage,
    isValidStorageKey,
    sanitizeStorageObject,
    setScriptValue,
    deleteScriptValue,
    flushScriptStorage,
    generateScriptToken,
    revokeTokensForSender,
    validateTokenSender,
    executeGmXmlHttpRequest,
    isPrivateOrBlockedIP,
    isHostAllowed,
    validateRequestDestination,
    createPinnedDispatcher,
    __test_setStorageDir: (dir) => { storageDir = dir; },
    __test_getStorageDir: () => storageDir,
    __test_storageCache: scriptStorageCache,
    __test_storageDebounceTimers: storageDebounceTimers,
    __test_activeTokens: activeTokens,
    __test_TOKEN_IDLE_MS: TOKEN_IDLE_MS,
    __test_MAX_TOKENS: MAX_TOKENS,
    __test_wiredSenders: wiredSenders,
    __test_setLoadedContent: (scripts, styles) => {
        if (Array.isArray(scripts)) loadedScripts = scripts;
        if (Array.isArray(styles)) loadedStyles = styles;
    }
};
