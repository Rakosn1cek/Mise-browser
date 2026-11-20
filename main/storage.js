const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let electronModule;
try {
    electronModule = require('electron');
} catch (e) {
    electronModule = {};
}
const shell = (electronModule && electronModule.shell) ? electronModule.shell : {
    openPath: async () => null
};

const config = require('./config');
const { atomicWriteFileSync, readJsonFileOrBackup } = require('./atomicFile');
const CONFIG_DIR = config.CONFIG_DIR;

const NOTES_PATH = path.join(CONFIG_DIR, 'notes.md');
const BOOKMARKS_PATH = path.join(CONFIG_DIR, 'bookmarks.json');
const QUICKMARKS_PATH = path.join(CONFIG_DIR, 'quickmarks.json');
const historyPath = path.join(CONFIG_DIR, 'history.json');
const MAX_HISTORY_ITEMS = 500;
const MAX_HISTORY_TITLE_LENGTH = 512;
const MAX_STORAGE_SIZE = 5 * 1024 * 1024;

let inMemoryHistory = null;
let historyFlushTimer = null;
let keepHistoryEnabled = true;

function isPlainObject(val) {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function getHistoryCache(targetPath = historyPath) {
    if (inMemoryHistory === null) {
        try {
            inMemoryHistory = readJsonFileOrBackup(targetPath, Array.isArray, () => []);
        } catch (err) {
            inMemoryHistory = [];
        }
    }
    return inMemoryHistory;
}

function setInMemoryHistory(list) {
    inMemoryHistory = Array.isArray(list) ? list : (list === null ? null : []);
}

function flushHistoryToDisk(targetPath = historyPath) {
    if (historyFlushTimer) {
        clearTimeout(historyFlushTimer);
        historyFlushTimer = null;
    }
    if (inMemoryHistory === null) return;
    try {
        atomicWriteFileSync(targetPath, JSON.stringify(inMemoryHistory, null, 4));
    } catch (err) {}
}

function scheduleHistoryFlush(delayMs = 4000, targetPath = historyPath) {
    if (historyFlushTimer) return;
    historyFlushTimer = setTimeout(() => {
        historyFlushTimer = null;
        flushHistoryToDisk(targetPath);
    }, delayMs);
}

function setKeepHistoryEnabled(enabled) {
    keepHistoryEnabled = enabled !== false;
}

function getKeepHistoryEnabled() {
    return keepHistoryEnabled;
}

function isRecordableHistoryUrl(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 4096) {
        return false;
    }
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return false;
        }
        // Reject URLs containing embedded HTTP Basic Auth credentials
        if (parsed.username || parsed.password) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

function scrubSensitiveUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl || !/^https?:\/\//i.test(rawUrl)) return rawUrl;
    try {
        const parsed = new URL(rawUrl);
        let modified = false;
        if (parsed.username || parsed.password) {
            parsed.username = '';
            parsed.password = '';
            modified = true;
        }
        const sensitiveParamRe = /^(access_token|id_token|refresh_token|auth_token|oauth_token|token|auth|code|password|passwd|pwd|secret|api_key|apikey|client_secret|cvv|cvc|card_number|pin|otp|session_id|sid|jwt|bearer)$/i;
        for (const key of Array.from(parsed.searchParams.keys())) {
            if (sensitiveParamRe.test(key)) {
                parsed.searchParams.delete(key);
                modified = true;
            }
        }
        if (parsed.hash && /(?:access_token|id_token|refresh_token|auth_token|token|code|secret|password|passwd|api_key)=/i.test(parsed.hash)) {
            parsed.hash = '';
            modified = true;
        }
        return modified ? parsed.toString() : rawUrl;
    } catch (_) {
        return rawUrl;
    }
}

function sanitiseHistoryTitle(rawTitle, fallbackUrl = '') {
    if (typeof rawTitle !== 'string') return fallbackUrl;
    const clean = rawTitle
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_HISTORY_TITLE_LENGTH);
    return clean || fallbackUrl;
}

function logVisit(title, url, maxItems = MAX_HISTORY_ITEMS, targetPath = historyPath) {
    if (!keepHistoryEnabled || !isRecordableHistoryUrl(url)) return;

    const cleanUrl = scrubSensitiveUrl(url);
    const history = getHistoryCache(targetPath);
    if (history.length > 0 && history[0].url === cleanUrl) return;

    const newEntry = {
        title: sanitiseHistoryTitle(title, cleanUrl),
        url: cleanUrl,
        timestamp: Date.now()
    };

    history.unshift(newEntry);
    if (history.length > maxItems) {
        history.length = maxItems;
    }
    scheduleHistoryFlush(4000, targetPath);
}

function updateVisitTitle(title, url, targetPath = historyPath) {
    if (!keepHistoryEnabled || !isRecordableHistoryUrl(url) || typeof title !== 'string') {
        return false;
    }
    const cleanUrl = scrubSensitiveUrl(url);
    const cleanTitle = sanitiseHistoryTitle(title, '');
    if (!cleanTitle || cleanTitle === cleanUrl) return false;

    const history = getHistoryCache(targetPath);
    const entry = history.find(item => item && item.url === cleanUrl);
    if (!entry || entry.title === cleanTitle) return false;

    entry.title = cleanTitle;
    scheduleHistoryFlush(4000, targetPath);
    return true;
}

function deleteHistoryItem(target, targetPath = historyPath) {
    try {
        let targetUrl = '';
        let targetTimestamp = null;
        if (typeof target === 'string') {
            targetUrl = target;
        } else if (isPlainObject(target)) {
            targetUrl = typeof target.url === 'string' ? target.url : '';
            if (typeof target.timestamp === 'number' && Number.isFinite(target.timestamp)) {
                targetTimestamp = target.timestamp;
            }
        }
        if (!targetUrl || targetUrl.length > 4096) return false;

        const history = getHistoryCache(targetPath);
        let idx = -1;
        if (targetTimestamp !== null) {
            idx = history.findIndex(item => item && item.url === targetUrl && item.timestamp === targetTimestamp);
        }
        if (idx === -1) {
            idx = history.findIndex(item => item && item.url === targetUrl);
        }
        if (idx === -1) return false;

        history.splice(idx, 1);
        flushHistoryToDisk(targetPath);
        return true;
    } catch (err) {
        return false;
    }
}

function searchHistory(query, targetPath = historyPath) {
    const history = getHistoryCache(targetPath);
    if (!query || !query.trim()) return history;

    const lowerQuery = query.toLowerCase();
    return history.filter(item => 
        (item.title && item.title.toLowerCase().includes(lowerQuery)) || 
        (item.url && item.url.toLowerCase().includes(lowerQuery))
    );
}

function purgeHistory(targetPath = historyPath) {
    try {
        inMemoryHistory = [];
        if (historyFlushTimer) {
            clearTimeout(historyFlushTimer);
            historyFlushTimer = null;
        }
        if (fs.existsSync(targetPath)) {
            atomicWriteFileSync(targetPath, JSON.stringify([], null, 4));
        }
        return true;
    } catch (err) {
        return false;
    }
}

function readBookmarks(targetPath = BOOKMARKS_PATH) {
    try {
        if (!fs.existsSync(targetPath)) {
            atomicWriteFileSync(targetPath, JSON.stringify([]));
            return [];
        }
        return readJsonFileOrBackup(targetPath, Array.isArray, () => []);
    } catch (err) {
        return [];
    }
}

function saveBookmarks(data, targetPath = BOOKMARKS_PATH) {
    try {
        if (!Array.isArray(data)) return false;
        const serialized = JSON.stringify(data, null, 4);
        if (typeof serialized !== 'string' || serialized.length > MAX_STORAGE_SIZE) return false;
        atomicWriteFileSync(targetPath, serialized);
        return true;
    } catch (err) {
        return false;
    }
}

function readQuickmarks(targetPath = QUICKMARKS_PATH) {
    try {
        if (!fs.existsSync(targetPath)) {
            atomicWriteFileSync(targetPath, JSON.stringify({}));
            return {};
        }
        return readJsonFileOrBackup(targetPath, isPlainObject, () => ({}));
    } catch (err) {
        return {};
    }
}

function saveQuickmarks(data, targetPath = QUICKMARKS_PATH) {
    try {
        if (!isPlainObject(data)) return false;
        const serialized = JSON.stringify(data, null, 4);
        if (typeof serialized !== 'string' || serialized.length > MAX_STORAGE_SIZE) return false;
        atomicWriteFileSync(targetPath, serialized);
        return true;
    } catch (err) {
        return false;
    }
}

function readNotes(targetPath = NOTES_PATH) {
    try {
        if (!fs.existsSync(targetPath)) {
            atomicWriteFileSync(targetPath, '');
            return '';
        }
        return fs.readFileSync(targetPath, 'utf-8');
    } catch (err) {
        return '';
    }
}

function saveNotes(content, targetPath = NOTES_PATH) {
    try {
        if (typeof content !== 'string' || content.length > MAX_STORAGE_SIZE) return false;
        atomicWriteFileSync(targetPath, content);
        return true;
    } catch (err) {
        return false;
    }
}

function resolveSafeNotesPath(customPath, targetConfigDir = CONFIG_DIR) {
    const defaultNotes = path.join(targetConfigDir, 'notes.md');
    if (!customPath || typeof customPath !== 'string') {
        return defaultNotes;
    }
    const resolvedPath = path.resolve(targetConfigDir, customPath);
    const resolvedDir = path.resolve(targetConfigDir);
    if (resolvedPath === defaultNotes || resolvedPath.startsWith(resolvedDir + path.sep)) {
        return resolvedPath;
    }
    return defaultNotes;
}

async function openNotesInExternalApp(customPath, targetConfigDir = CONFIG_DIR) {
    try {
        const cfg = config.loadBrowserConfig(targetConfigDir, path.join(targetConfigDir, 'config.json'));
        const targetPath = resolveSafeNotesPath(customPath, targetConfigDir);
        if (!fs.existsSync(targetPath)) {
            atomicWriteFileSync(targetPath, '');
        }
        const cmd = (cfg.external_notes_command || '').trim();
        if (cmd) {
            const tokens = cmd.split(/\s+/);
            const proc = spawn(tokens[0], [...tokens.slice(1), targetPath], {
                detached: true,
                stdio: 'ignore'
            });
            proc.on('error', () => {});
            proc.unref();
            return { success: true, app: tokens[0] };
        } else {
            const err = await shell.openPath(targetPath);
            return { success: !err, error: err || null, app: 'system-default' };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function exportArticleToExternal({ title, markdown } = {}, targetConfigDir = CONFIG_DIR) {
    try {
        const mdString = typeof markdown === 'string' ? markdown : (markdown === undefined ? '' : null);
        if (mdString === null) {
            return { success: false, error: 'Invalid markdown payload' };
        }
        if (Buffer.byteLength(mdString, 'utf8') > 1024 * 1024) {
            return { success: false, error: 'Markdown content exceeds 1 MB limit' };
        }

        const clippingsDir = path.join(targetConfigDir, 'clippings');
        if (fs.existsSync(clippingsDir)) {
            const existingFiles = fs.readdirSync(clippingsDir);
            if (existingFiles.length >= 200) {
                return { success: false, error: 'Clippings directory file limit reached (200 files maximum)' };
            }
        } else {
            fs.mkdirSync(clippingsDir, { recursive: true, mode: 0o700 });
        }

        const cfg = config.loadBrowserConfig(targetConfigDir, path.join(targetConfigDir, 'config.json'));

        const safeTitle = (title || 'article')
            .replace(/[^a-zA-Z0-9_\-\u00C0-\u017F ]/g, '')
            .trim()
            .replace(/\s+/g, '_')
            .slice(0, 60) || 'article';
        const timestamp = Date.now();
        const filename = `${safeTitle}_${timestamp}.md`;
        const targetPath = path.join(clippingsDir, filename);

        atomicWriteFileSync(targetPath, mdString);

        const cmd = (cfg.external_notes_command || '').trim();
        if (cmd) {
            const tokens = cmd.split(/\s+/);
            const proc = spawn(tokens[0], [...tokens.slice(1), targetPath], {
                detached: true,
                stdio: 'ignore'
            });
            proc.on('error', () => {});
            proc.unref();
            return { success: true, path: targetPath, app: tokens[0] };
        } else {
            const err = await shell.openPath(targetPath);
            return { success: !err, error: err || null, path: targetPath, app: 'system-default' };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function registerStorageIpc(ipcMain) {
    ipcMain.handle('read-notes', async () => {
        return readNotes();
    });

    ipcMain.handle('save-notes', async (event, content) => {
        return saveNotes(content);
    });

    ipcMain.handle('open-notes-in-external-app', async () => {
        return openNotesInExternalApp();
    });

    ipcMain.handle('export-article-to-external', async (event, data) => {
        return exportArticleToExternal(data);
    });

    ipcMain.handle('search-history', async (event, query) => {
        return searchHistory(query);
    });

    ipcMain.handle('purge-history', async () => {
        return purgeHistory();
    });

    ipcMain.handle('delete-history-item', async (event, target) => {
        return deleteHistoryItem(target);
    });

    ipcMain.handle('read-bookmarks', async () => {
        return readBookmarks();
    });

    ipcMain.handle('save-bookmarks', async (event, data) => {
        return saveBookmarks(data);
    });

    ipcMain.handle('read-quickmarks', async () => {
        return readQuickmarks();
    });

    ipcMain.handle('save-quickmarks', async (event, data) => {
        return saveQuickmarks(data);
    });
}

module.exports = {
    NOTES_PATH,
    BOOKMARKS_PATH,
    QUICKMARKS_PATH,
    historyPath,
    MAX_HISTORY_ITEMS,
    MAX_HISTORY_TITLE_LENGTH,
    setKeepHistoryEnabled,
    getKeepHistoryEnabled,
    isRecordableHistoryUrl,
    scrubSensitiveUrl,
    sanitiseHistoryTitle,
    getHistoryCache,
    setInMemoryHistory,
    flushHistoryToDisk,
    scheduleHistoryFlush,
    logVisit,
    updateVisitTitle,
    deleteHistoryItem,
    searchHistory,
    purgeHistory,
    readBookmarks,
    saveBookmarks,
    readQuickmarks,
    saveQuickmarks,
    readNotes,
    saveNotes,
    resolveSafeNotesPath,
    openNotesInExternalApp,
    exportArticleToExternal,
    registerStorageIpc
};
