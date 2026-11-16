const diagnostics = require('../diagnostics');

let electronModule;
try {
    electronModule = require('electron');
} catch (e) {
    electronModule = {};
}
const app = electronModule && typeof electronModule === 'object' && electronModule.app ? electronModule.app : null;

const LISTENERS_ATTACHED = Symbol('miseUpdaterListenersAttached');

const configuredOptions = {
    app: null,
    autoUpdater: null,
    diagnostics: null,
    getMainWindow: null
};

function getDefaultAutoUpdater() {
    try {
        const updaterModule = require('electron-updater');
        return updaterModule && updaterModule.autoUpdater ? updaterModule.autoUpdater : null;
    } catch (e) {
        return null;
    }
}

function mergeConfiguredOptions(options = {}) {
    if (!options || typeof options !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(options, 'app') && options.app !== undefined) {
        configuredOptions.app = options.app;
    }
    if (Object.prototype.hasOwnProperty.call(options, 'autoUpdater') && options.autoUpdater !== undefined) {
        configuredOptions.autoUpdater = options.autoUpdater;
    }
    if (Object.prototype.hasOwnProperty.call(options, 'diagnostics') && options.diagnostics !== undefined) {
        configuredOptions.diagnostics = options.diagnostics;
    }
    if (typeof options.getMainWindow === 'function') {
        configuredOptions.getMainWindow = options.getMainWindow;
    }
}

function setMainWindowGetter(getter) {
    if (typeof getter === 'function') {
        configuredOptions.getMainWindow = getter;
    }
}

function resolveApp(options = {}) {
    if (options && Object.prototype.hasOwnProperty.call(options, 'app') && options.app !== undefined) {
        return options.app;
    }
    if (configuredOptions.app !== null && configuredOptions.app !== undefined) {
        return configuredOptions.app;
    }
    return app;
}

function resolveDiagnostics(options = {}) {
    if (options && options.diagnostics) return options.diagnostics;
    if (configuredOptions.diagnostics) return configuredOptions.diagnostics;
    return diagnostics;
}

function resolveAutoUpdater(options = {}) {
    if (options && options.autoUpdater) return options.autoUpdater;
    if (configuredOptions.autoUpdater) return configuredOptions.autoUpdater;
    return getDefaultAutoUpdater();
}

function resolveMainWindow(options = {}) {
    if (options && options.mainWindow) return options.mainWindow;
    if (options && typeof options.getMainWindow === 'function') {
        try {
            return options.getMainWindow();
        } catch (e) {
            return null;
        }
    }
    if (typeof configuredOptions.getMainWindow === 'function') {
        try {
            return configuredOptions.getMainWindow();
        } catch (e) {
            return null;
        }
    }
    return null;
}

function logUpdaterEvent(diag, level, message, details = null) {
    if (diag && typeof diag.logEvent === 'function') {
        try {
            diag.logEvent(level, 'updater', message, details);
        } catch (e) {}
    }
}

function isNewerVersion(latest, current) {
    const cleanL = String(latest || '').replace(/^v/i, '').trim();
    const cleanC = String(current || '').replace(/^v/i, '').trim();
    const partsL = cleanL.split('.').map(n => parseInt(n, 10) || 0);
    const partsC = cleanC.split('.').map(n => parseInt(n, 10) || 0);
    const maxLen = Math.max(partsL.length, partsC.length);
    for (let i = 0; i < maxLen; i++) {
        const l = partsL[i] || 0;
        const c = partsC[i] || 0;
        if (l > c) return true;
        if (l < c) return false;
    }
    return false;
}

function getAppVersion(targetApp = app) {
    const effectiveApp = targetApp || resolveApp();
    return {
        version: effectiveApp && effectiveApp.getVersion ? effectiveApp.getVersion() : '1.0.0',
        electron: process.versions.electron || '',
        chrome: process.versions.chrome || '',
        node: process.versions.node || ''
    };
}

function initAutoUpdater(options = {}) {
    mergeConfiguredOptions(options);
    const updaterInstance = resolveAutoUpdater(options);
    if (!updaterInstance) return null;

    // Disable automatic download until packaged environment check confirms live streaming
    updaterInstance.autoDownload = false;

    if (updaterInstance[LISTENERS_ATTACHED] || typeof updaterInstance.on !== 'function') {
        return updaterInstance;
    }
    updaterInstance[LISTENERS_ATTACHED] = true;

    updaterInstance.on('update-available', (info) => {
        const diag = resolveDiagnostics();
        const targetApp = resolveApp();
        const version = (info && (info.version || info.tag_name || info.latestVersion)) || '';

        logUpdaterEvent(diag, 'info', `Update available: ${version || 'unknown'}`, { version });

        if (!targetApp || !targetApp.isPackaged) {
            logUpdaterEvent(diag, 'info', 'Bypassing background delta download in unpackaged environment', { version });
            return;
        }

        if (typeof updaterInstance.downloadUpdate === 'function') {
            try {
                Promise.resolve(updaterInstance.downloadUpdate()).catch((err) => {
                    const msg = err && err.message ? err.message : String(err || 'Download failed');
                    logUpdaterEvent(diag, 'error', `Delta update download failed: ${msg}`, { error: msg });
                });
            } catch (err) {
                const msg = err && err.message ? err.message : String(err || 'Download failed');
                logUpdaterEvent(diag, 'error', `Delta update download failed: ${msg}`, { error: msg });
            }
        }
    });

    updaterInstance.on('download-progress', (progressObj) => {
        const diag = resolveDiagnostics();
        const percent = Math.round((Number(progressObj && progressObj.percent) || 0) * 10) / 10;
        logUpdaterEvent(diag, 'info', `Update download progress: ${percent}%`, {
            percent,
            transferred: (progressObj && progressObj.transferred) || 0,
            total: (progressObj && progressObj.total) || 0,
            bytesPerSecond: (progressObj && progressObj.bytesPerSecond) || 0
        });
    });

    updaterInstance.on('update-downloaded', (info) => {
        const diag = resolveDiagnostics();
        const version = (info && (info.version || info.tag_name || info.latestVersion)) || '';

        logUpdaterEvent(diag, 'info', `Update downloaded and ready to install: ${version || 'unknown'}`, { version });

        const win = resolveMainWindow();
        if (win && (typeof win.isDestroyed !== 'function' || !win.isDestroyed()) && win.webContents && typeof win.webContents.send === 'function') {
            win.webContents.send('update-downloaded', {
                ...(info && typeof info === 'object' ? info : {}),
                version,
                latestVersion: version,
                releaseName: (info && info.releaseName) || version,
                releaseNotes: (info && info.releaseNotes) || '',
                downloadedAt: Date.now()
            });
        }
    });

    updaterInstance.on('error', (err) => {
        const diag = resolveDiagnostics();
        const message = err && err.message ? err.message : String(err || 'Unknown updater error');
        logUpdaterEvent(diag, 'error', `Updater error: ${message}`, { error: message });
    });

    return updaterInstance;
}

async function checkAppUpdates(manual = false, options = {}) {
    const merged = { ...configuredOptions, ...(options || {}) };
    if (options && options.autoUpdater) {
        initAutoUpdater(merged);
    }

    const targetApp = resolveApp(options);
    const diag = merged.diagnostics || diagnostics;
    const currentVersion = (targetApp && typeof targetApp.getVersion === 'function')
        ? targetApp.getVersion()
        : (merged.currentVersion || '1.0.0');

    if (!targetApp || !targetApp.isPackaged) {
        logUpdaterEvent(diag, 'info', 'Bypassing live update check in unpackaged environment', {
            currentVersion,
            manual
        });
        return {
            updateAvailable: false,
            bypassed: true,
            currentVersion,
            checkedAt: Date.now(),
            manual
        };
    }

    const updaterInstance = resolveAutoUpdater(merged);
    if (!updaterInstance || typeof updaterInstance.checkForUpdates !== 'function') {
        const errorMsg = 'Auto-updater subsystem is unavailable';
        logUpdaterEvent(diag, 'error', `Update check failed: ${errorMsg}`, { error: errorMsg, manual });
        return {
            error: errorMsg,
            updateAvailable: false,
            currentVersion,
            checkedAt: Date.now(),
            manual
        };
    }

    try {
        initAutoUpdater(merged);
        const checkResult = await updaterInstance.checkForUpdates();
        const updateInfo = (checkResult && checkResult.updateInfo) ? checkResult.updateInfo : checkResult;
        const rawTag = updateInfo && (updateInfo.version || updateInfo.tag_name || updateInfo.latestVersion);
        const latestTag = rawTag ? String(rawTag) : '';
        const updateAvailable = latestTag
            ? isNewerVersion(latestTag, currentVersion)
            : Boolean(updateInfo && updateInfo.updateAvailable);

        return {
            updateAvailable,
            currentVersion,
            latestVersion: latestTag || currentVersion,
            version: latestTag || currentVersion,
            releaseName: (updateInfo && (updateInfo.releaseName || updateInfo.name)) || latestTag || currentVersion,
            releaseUrl: (updateInfo && (updateInfo.releaseUrl || updateInfo.html_url)) || 'https://github.com/Rakosn1cek/Mise-browser/releases',
            publishedAt: (updateInfo && (updateInfo.releaseDate || updateInfo.published_at)) || null,
            releaseNotes: (updateInfo && (updateInfo.releaseNotes || updateInfo.body)) || '',
            checkedAt: Date.now(),
            manual
        };
    } catch (err) {
        const message = err && err.message ? err.message : String(err || 'Update check error');
        logUpdaterEvent(diag, 'error', `Update check failed: ${message}`, { error: message, manual });
        return {
            error: message,
            updateAvailable: false,
            currentVersion,
            checkedAt: Date.now(),
            manual
        };
    }
}

function quitAndInstall(options = {}) {
    const merged = { ...configuredOptions, ...(options || {}) };
    const targetApp = resolveApp(options);
    const diag = merged.diagnostics || diagnostics;

    if (!targetApp || !targetApp.isPackaged) {
        logUpdaterEvent(diag, 'info', 'Bypassing quit-and-install in unpackaged environment');
        return { installed: false, bypassed: true };
    }

    const updaterInstance = resolveAutoUpdater(merged);
    if (!updaterInstance || typeof updaterInstance.quitAndInstall !== 'function') {
        logUpdaterEvent(diag, 'error', 'Cannot quit and install: autoUpdater unavailable');
        return { installed: false, error: 'Auto-updater subsystem is unavailable' };
    }

    logUpdaterEvent(diag, 'info', 'Restarting Mise Browser to apply downloaded update');
    updaterInstance.quitAndInstall();
    return { installed: true };
}

function registerUpdaterIpc(ipcMain, options = {}) {
    initAutoUpdater(options);

    ipcMain.handle('get-app-version', () => {
        return getAppVersion(resolveApp(options));
    });

    ipcMain.handle('check-for-updates', async (event, manual = false) => {
        return checkAppUpdates(manual, options);
    });

    ipcMain.handle('quit-and-install', () => {
        return quitAndInstall(options);
    });
}

module.exports = {
    isNewerVersion,
    getAppVersion,
    initAutoUpdater,
    checkAppUpdates,
    quitAndInstall,
    registerUpdaterIpc,
    setMainWindowGetter
};
