// userContent.js
// Local User-Script and User-Style injection manager for Mise Browser
// Monitors ~/.config/mise-browser/scripts and ~/.config/mise-browser/styles
// Injects matching .user.js and .user.css on dom-ready without extension runtime overhead

const fs = require('fs');
const path = require('path');
const os = require('os');
const { shell, ipcMain, net } = require('electron');
const crypto = require('crypto');

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
const activeTokens = new Map();

function sanitizeScriptId(scriptId) {
    return String(scriptId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getScriptStoragePath(scriptId) {
    const cleanId = sanitizeScriptId(scriptId);
    return path.join(storageDir, `${cleanId}.json`);
}

function loadScriptStorage(scriptId) {
    const cleanId = sanitizeScriptId(scriptId);
    if (scriptStorageCache.has(cleanId)) {
        return scriptStorageCache.get(cleanId);
    }
    const filePath = getScriptStoragePath(cleanId);
    let data = {};
    try {
        if (fs.existsSync(filePath)) {
            data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        data = {};
    }
    scriptStorageCache.set(cleanId, data);
    return data;
}

function saveScriptStorage(scriptId, store) {
    const cleanId = sanitizeScriptId(scriptId);
    scriptStorageCache.set(cleanId, store);
    try {
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        const filePath = getScriptStoragePath(cleanId);
        fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
        console.error(`Failed to save script storage for ${cleanId}:`, err);
    }
}

function setScriptValue(scriptId, key, value) {
    const store = loadScriptStorage(scriptId);
    store[String(key)] = value;
    saveScriptStorage(scriptId, store);
}

function deleteScriptValue(scriptId, key) {
    const store = loadScriptStorage(scriptId);
    delete store[String(key)];
    saveScriptStorage(scriptId, store);
}

function generateScriptToken(scriptId) {
    const token = crypto.randomUUID();
    activeTokens.set(token, {
        scriptId: sanitizeScriptId(scriptId),
        createdAt: Date.now()
    });
    if (activeTokens.size > 5000) {
        const now = Date.now();
        for (const [tok, data] of activeTokens.entries()) {
            if (now - data.createdAt > 24 * 60 * 60 * 1000) {
                activeTokens.delete(tok);
            }
        }
    }
    return token;
}

async function executeGmXmlHttpRequest(details) {
    if (!details || typeof details !== 'object' || !details.url) {
        throw new Error('Valid URL is required for GM_xmlhttpRequest');
    }

    const url = details.url;
    const method = (details.method || 'GET').toUpperCase();
    const timeout = Number(details.timeout) || 30000;

    const headers = Object.assign({}, details.headers || {});
    if (!headers['User-Agent'] && !headers['user-agent']) {
        headers['User-Agent'] = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const init = {
        method,
        headers,
        signal: controller.signal,
        redirect: 'follow'
    };

    if (details.data && method !== 'GET' && method !== 'HEAD') {
        init.body = typeof details.data === 'object' ? JSON.stringify(details.data) : String(details.data);
    }

    try {
        const fetchFn = (net && typeof net.fetch === 'function') ? net.fetch : globalThis.fetch;
        const res = await fetchFn(url, init);
        clearTimeout(timer);

        const responseText = await res.text();
        let responseHeaders = '';
        if (res.headers && typeof res.headers.forEach === 'function') {
            res.headers.forEach((val, key) => {
                responseHeaders += `${key}: ${val}\r\n`;
            });
        }

        return {
            status: res.status,
            statusText: res.statusText,
            readyState: 4,
            responseText,
            responseHeaders,
            finalUrl: res.url || url
        };
    } catch (err) {
        clearTimeout(timer);
        const isTimeout = err.name === 'AbortError' || err.code === 'ETIMEDOUT';
        throw {
            isTimeout,
            message: err.message || 'Request failed',
            status: isTimeout ? 0 : 0,
            statusText: isTimeout ? 'Timeout' : 'Error'
        };
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

function getMatchingUserContent(targetUrl) {
    if (!targetUrl || typeof targetUrl !== 'string') {
        return { scripts: [], styles: [] };
    }

    let hostname = '';
    try {
        hostname = new URL(targetUrl).hostname.toLowerCase();
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
                token: generateScriptToken(scriptId)
            });
        }
    }

    const matchingStyles = [];
    for (const item of loadedStyles) {
        if (item.meta.hasMozDoc && item.meta.sections.length > 0) {
            let combinedSectionCss = '';
            for (const section of item.meta.sections) {
                const matchesAny = section.conditions.some(cond => matchesMozDocCondition(targetUrl, hostname, cond));
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
        } else if (urlMatchesRule(targetUrl, item.meta)) {
            matchingStyles.push({
                name: item.name,
                filename: item.filename,
                css: item.css
            });
        }
    }

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

    ipcMain.handle('get-user-content-for-url', (event, url) => {
        return getMatchingUserContent(url);
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
        return executeGmXmlHttpRequest(details);
    });

    ipcMain.handle('gm-storage-set', async (event, payload) => {
        const { token, scriptId, key, value } = payload || {};
        if (!token || !activeTokens.has(token)) {
            throw new Error('Unauthorized: Invalid or expired GM token');
        }
        const tokenData = activeTokens.get(token);
        if (!tokenData || tokenData.scriptId !== sanitizeScriptId(scriptId)) {
            throw new Error('Unauthorized: Script ID mismatch');
        }
        setScriptValue(scriptId, key, value);
        return true;
    });

    ipcMain.handle('gm-storage-delete', async (event, payload) => {
        const { token, scriptId, key } = payload || {};
        if (!token || !activeTokens.has(token)) {
            throw new Error('Unauthorized: Invalid or expired GM token');
        }
        const tokenData = activeTokens.get(token);
        if (!tokenData || tokenData.scriptId !== sanitizeScriptId(scriptId)) {
            throw new Error('Unauthorized: Script ID mismatch');
        }
        deleteScriptValue(scriptId, key);
        return true;
    });

    ipcMain.handle('gm-storage-get', async (event, payload) => {
        const { token, scriptId } = payload || {};
        if (!token || !activeTokens.has(token)) {
            throw new Error('Unauthorized: Invalid or expired GM token');
        }
        const tokenData = activeTokens.get(token);
        if (!tokenData || tokenData.scriptId !== sanitizeScriptId(scriptId)) {
            throw new Error('Unauthorized: Script ID mismatch');
        }
        return loadScriptStorage(scriptId);
    });
}

module.exports = {
    initializeUserContent,
    reloadScripts,
    reloadStyles,
    getMatchingUserContent,
    loadScriptStorage,
    saveScriptStorage,
    setScriptValue,
    deleteScriptValue,
    generateScriptToken,
    executeGmXmlHttpRequest
};
