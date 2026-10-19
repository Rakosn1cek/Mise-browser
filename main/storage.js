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
const MAX_STORAGE_SIZE = 5 * 1024 * 1024;

let inMemoryHistory = null;
let historyFlushTimer = null;

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

function isRecordableHistoryUrl(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 4096) {
        return false;
    }
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function logVisit(title, url, maxItems = MAX_HISTORY_ITEMS, targetPath = historyPath) {
    if (!isRecordableHistoryUrl(url)) return;

    const history = getHistoryCache(targetPath);
    if (history.length > 0 && history[0].url === url) return;

    const newEntry = {
        title: title || url,
        url: url,
        timestamp: Date.now()
    };

    history.unshift(newEntry);
    if (history.length > maxItems) {
        history.length = maxItems;
    }
    scheduleHistoryFlush(4000, targetPath);
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

async function openNotesInExternalApp(customPath, targetConfigDir = CONFIG_DIR) {
    try {
        const cfg = config.loadBrowserConfig(targetConfigDir, path.join(targetConfigDir, 'config.json'));
        const targetPath = customPath || NOTES_PATH;
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
        const cfg = config.loadBrowserConfig(targetConfigDir, path.join(targetConfigDir, 'config.json'));
        const clippingsDir = path.join(targetConfigDir, 'clippings');
        if (!fs.existsSync(clippingsDir)) fs.mkdirSync(clippingsDir, { recursive: true });

        const safeTitle = (title || 'article')
            .replace(/[^a-zA-Z0-9_\-\u00C0-\u017F ]/g, '')
            .trim()
            .replace(/\s+/g, '_')
            .slice(0, 60) || 'article';
        const timestamp = Date.now();
        const filename = `${safeTitle}_${timestamp}.md`;
        const targetPath = path.join(clippingsDir, filename);

        atomicWriteFileSync(targetPath, markdown || '');

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

    ipcMain.handle('open-notes-in-external-app', async (event, customPath) => {
        return openNotesInExternalApp(customPath);
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
    isRecordableHistoryUrl,
    getHistoryCache,
    setInMemoryHistory,
    flushHistoryToDisk,
    scheduleHistoryFlush,
    logVisit,
    searchHistory,
    purgeHistory,
    readBookmarks,
    saveBookmarks,
    readQuickmarks,
    saveQuickmarks,
    readNotes,
    saveNotes,
    openNotesInExternalApp,
    exportArticleToExternal,
    registerStorageIpc
};
