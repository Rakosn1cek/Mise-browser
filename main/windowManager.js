const path = require('path');
const fs = require('fs');
const { BrowserWindow, Menu, nativeTheme, session } = require('electron');
const security = require('../security');
const diagnostics = require('../diagnostics');
const keybinds = require('../keybinds');
const userContent = require('../userContent');
const updater = require('./updater');
const config = require('./config');
const { loadBrowserConfig } = config;
const { buildSettingsSubmenu, openSettingsMenu } = require('./contextMenus');

const appDir = path.resolve(__dirname, '..');

let mainWindow = null;
let isRendererReady = false;
const pendingUrls = [];

function getMainWindow() {
    return mainWindow;
}

function setRendererReady(ready = true) {
    isRendererReady = !!ready;
    if (isRendererReady) {
        flushPendingUrls();
    }
}

function isWindowReady() {
    return isRendererReady;
}

function extractUrlsFromArgs(argv) {
    if (!argv || !Array.isArray(argv)) return [];
    const urls = [];
    for (let i = 1; i < argv.length; i++) {
        let arg = (argv[i] || '').trim();
        if (!arg) continue;
        if (arg.startsWith('-')) continue;
        arg = arg.replace(/^["']|["']$/g, '');
        if (arg === '.' || arg.endsWith('main.js') || arg === appDir) continue;

        if (/^https?:\/\//i.test(arg) || /^file:\/\//i.test(arg)) {
            urls.push(arg);
        } else if (/^localhost(:\d+)?(\/.*)?$/i.test(arg) || /^127\.0\.0\.1(:\d+)?(\/.*)?$/i.test(arg)) {
            urls.push('http://' + arg);
        } else if (/^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(\/.*)?$/i.test(arg)) {
            urls.push('https://' + arg);
        } else {
            try {
                if (fs.existsSync(arg) && fs.statSync(arg).isFile() && !arg.endsWith('.js') && !arg.endsWith('.json')) {
                    urls.push('file://' + path.resolve(arg));
                }
            } catch (e) {}
        }
    }
    return urls;
}

function dispatchTabUrl(url) {
    if (!url) return;
    if (isRendererReady && mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('master-shortcut', 'spawn-tab-with-url', url);
    } else {
        pendingUrls.push(url);
    }
}

function flushPendingUrls() {
    if (!mainWindow || !mainWindow.webContents) return;
    while (pendingUrls.length > 0) {
        const nextUrl = pendingUrls.shift();
        mainWindow.webContents.send('master-shortcut', 'spawn-tab-with-url', nextUrl);
    }
}

function handleAppAction(action, sourceWebContents) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (action === 'toggle-menu-bar') {
        openSettingsMenu(mainWindow);
        return;
    }

    if (action === 'reload-active-tab') {
        if (sourceWebContents && sourceWebContents !== mainWindow.webContents) {
            sourceWebContents.reload();
        } else {
            mainWindow.webContents.send('master-shortcut', 'reload-active-tab');
        }
        return;
    }

    mainWindow.webContents.send('master-shortcut', action);
}

function registerWindowIpc(ipcMain) {
    ipcMain.on('renderer-ready', () => {
        setRendererReady(true);
    });

    ipcMain.on('toggle-menu-bar', () => {
        openSettingsMenu(mainWindow);
    });

    ipcMain.on('window-minimize', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.minimize();
        }
    });

    ipcMain.on('window-toggle-maximize', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });

    ipcMain.on('window-close', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.close();
        }
    });

    ipcMain.handle('window-is-maximized', () => {
        return (mainWindow && !mainWindow.isDestroyed()) ? mainWindow.isMaximized() : false;
    });

    ipcMain.on('bubble-webview-key', (event, action) => {
        if (typeof action !== 'string' || action.length > 64) return;
        const metadata = keybinds.getActionMetadata();
        if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, action)) return;
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('master-shortcut', action);
        }
    });
}

function createMainWindow(options = {}) {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 1040,
        icon: path.join(appDir, 'assets', 'icons', 'Mise-logo256.png'),
        frame: true,
        autoHideMenuBar: false,
        webPreferences: {
            preload: path.join(appDir, 'preload.js'),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true
        }
    });

    const cfg = loadBrowserConfig();
    nativeTheme.themeSource = cfg.webview_theme || 'dark';
    const systemMenu = Menu.buildFromTemplate([
        {
            label: 'Mise Settings',
            submenu: buildSettingsSubmenu(cfg, { getMainWindow: () => mainWindow })
        }
    ]);
    mainWindow.setMenu(systemMenu);
    mainWindow.setMenuBarVisibility(false);

    // Initialise default and volatile private sessions
    if (options && typeof options.configureAndHardenSession === 'function') {
        options.configureAndHardenSession(session.defaultSession);
        options.configureAndHardenSession(session.fromPartition('MisePrivateProfile'));

        // Initialise active workspace partition
        try {
            const initialSession = (typeof options.readCurrentSession === 'function')
                ? options.readCurrentSession()
                : null;
            const activeWs = (initialSession && initialSession.current_workspace) || 'default';
            const partName = (typeof options.getWorkspacePartition === 'function')
                ? options.getWorkspacePartition(activeWs)
                : 'persist:default';
            options.configureAndHardenSession(session.fromPartition(partName));
        } catch (err) {
            console.error('Failed to initialise active workspace session:', err);
        }
    }

    security.setTrustedDomains(loadBrowserConfig().trusted_domains || []);

    // Guard main window from navigating away from application shell
    const appIndexPath = path.resolve(appDir, 'index.html');
    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        let isAppIndex = false;
        try {
            const parsed = new URL(navigationUrl);
            if (parsed.protocol === 'file:') {
                const targetFilePath = path.resolve(decodeURIComponent(parsed.pathname));
                if (targetFilePath === appIndexPath) {
                    isAppIndex = true;
                }
            }
        } catch (e) {}

        if (isAppIndex) return;

        event.preventDefault();
        if (security.isSafeTabUrl(navigationUrl) && mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.send('master-shortcut', 'spawn-tab-with-url', navigationUrl);
        }
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
        if (details.url && security.isSafeTabUrl(details.url) && mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.send('master-shortcut', 'spawn-tab-with-url', details.url);
        }
        return { action: 'deny' };
    });

    mainWindow.loadFile('index.html');

    mainWindow.on('close', () => {
        if (options && typeof options.onClose === 'function') {
            options.onClose();
        }
    });

    mainWindow.on('maximize', () => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.send('window-maximized-state', true);
        }
    });

    mainWindow.on('unmaximize', () => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.send('window-maximized-state', false);
        }
    });

    mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(() => {
            if (!isRendererReady) {
                setRendererReady(true);
            }
            if (typeof global.gc === 'function') {
                try { global.gc(); } catch (e) {}
            }
        }, 1200);

        // Check for updates in background after startup
        setTimeout(async () => {
            try {
                const updateInfo = await updater.checkAppUpdates(false);
                if (updateInfo && updateInfo.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-available', updateInfo);
                }
            } catch (e) {}
        }, 6000);
    });

    if (options && typeof options.attachWebviewSecurityGuards === 'function') {
        options.attachWebviewSecurityGuards(mainWindow.webContents);
    }

    if (options && options.CONFIG_DIR) {
        userContent.initializeUserContent(options.CONFIG_DIR, mainWindow);
    }

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;

        const action = keybinds.getActionForInput(input);
        if (action) {
            event.preventDefault();
            handleAppAction(action, mainWindow.webContents);
        }
    });

    return mainWindow;
}

module.exports = {
    getMainWindow,
    createMainWindow,
    setRendererReady,
    isWindowReady,
    extractUrlsFromArgs,
    dispatchTabUrl,
    flushPendingUrls,
    handleAppAction,
    registerWindowIpc
};
