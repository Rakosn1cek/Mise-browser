const { app, BrowserWindow, ipcMain, session, Menu, MenuItem, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

// Require the security config module to isolate filtering and hardening rules
const security = require('./security');

// --- NATIVE CONFIG UTILITIES ---
const CONFIG_DIR = path.join(app.getPath('home'), '.config', 'mise-browser');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
    disable_gpu: false,          // Keep false by default for cool video playback!
    background_throttling: true,
    process_limit: 3
};

function loadBrowserConfig() {
    try {
        if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
        if (!fs.existsSync(CONFIG_PATH)) {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 4), 'utf-8');
            return { ...DEFAULT_CONFIG };
        }
        return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) };
    } catch (e) {
        return { ...DEFAULT_CONFIG };
    }
}

function saveBrowserConfig(cfg) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 4), 'utf-8');
        app.relaunch(); // Relaunches a clean window with the new flags active
        app.exit(0);    // Exits the current window
    } catch (e) {}
}

function initializeEngineSwitches() {
    const cfg = loadBrowserConfig();
	app.commandLine.appendSwitch('remote-debugging-port', '9229');

    // Force a generic Chrome Desktop User-Agent
    const standardUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
    app.commandLine.appendSwitch('user-agent', standardUA);

    // Lock down WebRTC local IP leaks
    app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default_public_interface_only');

    // Disable invasive background privacy-sandbox and tracking APIs
    app.commandLine.appendSwitch('disable-features', 
        'Translate,PrivacySandboxSettings4,PrivacySandboxAdsAPIsOverride,' +
        'PrivacySandboxAdsAPIsM1Override,InterestGroupStorage,' +
        'AttributionReportingCrossAppWeb,FencedFrames,WebUSB,WebBluetooth,Serial,GenericSensor,WebOTP'
    );

    if (cfg.disable_gpu) {
        app.commandLine.appendSwitch('disable-gpu');
        app.commandLine.appendSwitch('disable-gpu-compositing');
    } else {
        if (process.platform === 'linux') {
            app.commandLine.appendSwitch('ignore-gpu-blocklist');
            app.commandLine.appendSwitch('enable-zero-copy');
            app.commandLine.appendSwitch('enable-gpu-rasterization');
            app.commandLine.appendSwitch('enable-oop-rasterization');
            app.commandLine.appendSwitch('enable-accelerated-video-decode');
            app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder,CanvasOopRasterization,TLSExtensionGrease');
        } else {
            app.commandLine.appendSwitch('enable-features', 'TLSExtensionGrease');
        }
    }

    if (cfg.background_throttling) {
        app.commandLine.appendSwitch('enable-background-timer-throttling');
        app.commandLine.appendSwitch('add-delay-to-background-timer-tasks');
    }
    
    app.commandLine.appendSwitch('renderer-process-limit', String(cfg.process_limit || 3));

    app.commandLine.appendSwitch('disable-shared-workers');
    app.commandLine.appendSwitch('disable-features', 'Vulkan');
    app.commandLine.appendSwitch('disable-smooth-scrolling');
    app.commandLine.appendSwitch('enable-strict-mixed-content-checking');
    app.commandLine.appendSwitch('disable-battery-saver');
    app.commandLine.appendSwitch('log-level', '2');
    app.commandLine.appendSwitch('disable-speech-api');
}

// Fire the switches before the browser engine starts up
initializeEngineSwitches();

let mainWindow;
const sessionPath = path.join(app.getPath('home'), '.config', 'mise-browser', 'session.json');

// --- HISTORY CONFIGURATION & HELPERS ---
const historyPath = path.join(app.getPath('home'), '.config', 'mise-browser', 'history.json');
const MAX_HISTORY_ITEMS = 500; // Hard cap to prevent disk bloat

let privateBrowsingEnabled = false;

// Helper to read history safely
function readHistory() {
    try {
        if (fs.existsSync(historyPath)) {
            return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        }
    } catch (err) {}
    return [];
}

// Helper to save history safely
function saveHistory(historyData) {
    try {
        const dir = path.dirname(historyPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(historyPath, JSON.stringify(historyData, null, 4), 'utf8');
    } catch (err) {}
}

// Helper to log user-initiated page visits
function logVisit(title, url) {
    if (!url || url === 'about:blank' || url.startsWith('file://')) return;

    let history = readHistory();
    
    const newEntry = {
        title: title || url,
        url: url,
        timestamp: Date.now()
    };

    if (history.length > 0 && history[0].url === url) return;

    history.unshift(newEntry);

    if (history.length > MAX_HISTORY_ITEMS) {
        history = history.slice(0, MAX_HISTORY_ITEMS);
    }

    saveHistory(history);
}
// ---------------------------------------

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 1040,
        frame: true,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true
        }
    });
    
    const cfg = loadBrowserConfig();
    const menuTemplate = [
        {
            label: 'Mise Settings',
            submenu: [
                {
                    label: 'Disable GPU Hardware Acceleration',
                    type: 'checkbox',
                    checked: cfg.disable_gpu,
                    click: (menuItem) => {
                        cfg.disable_gpu = menuItem.checked;
                        saveBrowserConfig(cfg);
                    }
                },
                {
                    label: 'Enable Background Throttling',
                    type: 'checkbox',
                    checked: cfg.background_throttling,
                    click: (menuItem) => {
                        cfg.background_throttling = menuItem.checked;
                        saveBrowserConfig(cfg);
                    }
                },
                { type: 'separator' },
                {
                    label: 'Renderer Process Limit',
                    submenu: [2, 3, 4, 5].map(num => ({
                        label: `Limit to ${num} processes`,
                        type: 'radio',
                        checked: cfg.process_limit === num,
                        click: () => {
                            cfg.process_limit = num;
                            saveBrowserConfig(cfg);
                        }
                    }))
                },
                { type: 'separator' },
                {
                    label: 'Restart Browser Now',
                    click: () => { app.relaunch(); app.exit(0); }
                }
            ]
        }
    ];

    const systemMenu = Menu.buildFromTemplate(menuTemplate);
    mainWindow.setMenu(systemMenu);
    mainWindow.setMenuBarVisibility(false);
    
    mainWindow.loadFile('index.html');

    mainWindow.webContents.once('dom-ready', () => {
        try {
            const standardUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
            session.defaultSession.setUserAgent(standardUA);
            const privateSession = session.fromPartition('MisePrivateProfile');
            privateSession.setUserAgent(standardUA);
        } catch (err) {
            console.error('Failed to configure private session user agent:', err);
        }
    });

    // Enforce isolated sessions and intercept filters via security module
    security.hardenSession(session.defaultSession);
    security.hardenSession(session.fromPartition('MisePrivateProfile'));

    // Intercept webviews before they attach to strip out unwanted capabilities like WebGL
    mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
        security.hardenWebviewPreferences(webPreferences);
    });

    ipcMain.handle('clear-domain-cookies', async (event, { urlStr, isPrivate }) => {
        const targetSession = isPrivate ? session.fromPartition('MisePrivateProfile') : session.defaultSession;
        try {
            const urlObj = new URL(urlStr);
            const host = urlObj.hostname.toLowerCase();
            if (!host || urlStr === "about:blank") return "All profile cookies cleared globally";
            
            const rootDomain = host.split('.').slice(-2).join('.');
            const cookies = await targetSession.cookies.get({});
            
            for (const cookie of cookies) {
                if (cookie.domain.toLowerCase().includes(rootDomain)) {
                    const cookieUrl = `http${cookie.secure ? 's' : ''}://${cookie.domain}${cookie.path}`;
                    await targetSession.cookies.remove(cookieUrl, cookie.name);
                }
            }
            return `Cookies cleared for ${rootDomain}`;
        } catch (err) {
            await targetSession.clearStorageData({ storages: ['cookies'] });
            return "All profile cookies cleared globally";
        }
    });

    ipcMain.handle('clear-active-cache', async (event, isPrivate) => {
        const targetSession = isPrivate ? session.fromPartition('MisePrivateProfile') : session.defaultSession;
        try {
            await targetSession.clearCache();
            return "Browser HTTP network cache cleared";
        } catch (err) {
            return `Cache clear initialization failed: ${err.message}`;
        }
    });

    ipcMain.on('bubble-webview-key', (event, action) => {
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('master-shortcut', action);
        }
    });

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;

        const isCtrl = input.control;
        const isShift = input.shift;
        const key = input.key.toLowerCase();

        if (isCtrl && key === 't') { event.preventDefault(); mainWindow.webContents.send('master-shortcut', 'spawn-tab'); }
        else if (isCtrl && key === 'l') { event.preventDefault(); mainWindow.webContents.send('master-shortcut', 'toggle-address'); }
        else if (isCtrl && isShift && key === 'w') { event.preventDefault(); mainWindow.webContents.send('master-shortcut', 'toggle-dashboard'); }
        else if (isCtrl && key === 'r') { event.preventDefault(); mainWindow.webContents.send('master-shortcut', 'reload-active-tab'); }
        else if (isCtrl && key === 'd') { event.preventDefault(); mainWindow.webContents.send('master-shortcut', 'remove-tab'); }
        else if (isCtrl && key === 'w') { event.preventDefault(); mainWindow.webContents.send('master-shortcut', 'remove-tab'); }
        else if (isCtrl && key === 'm') { event.preventDefault(); mainWindow.webContents.send('master-shortcut', 'focus-sidebar'); }
        else if (isCtrl && key === 'b') { event.preventDefault(); mainWindow.webContents.send('master-shortcut', 'focus-webview'); }
        else if (isCtrl && key === 'f') { event.preventDefault(); mainWindow.webContents.send('master-shortcut', 'trigger-hints'); }
        else if (isCtrl && key === 'h') { event.preventDefault(); mainWindow.webContents.send('master-shortcut', 'toggle-help'); }
        else if (isCtrl && isShift && key === 'p') {
            event.preventDefault();
            privateBrowsingEnabled = !privateBrowsingEnabled;
            mainWindow.webContents.send('master-shortcut', 'toggle-private-mode', privateBrowsingEnabled);
        }
        else if (isCtrl && key === 'p') {
            event.preventDefault();
            mainWindow.webContents.send('master-shortcut', 'toggle-palette');
        }
        else if (isCtrl && key === 's') { 
            event.preventDefault(); 
            mainWindow.webContents.send('master-shortcut', 'toggle-find'); 
        }
        else if (isCtrl && isShift && key === 'i') {
            event.preventDefault();
            mainWindow.webContents.send('master-shortcut', 'toggle-devtools');
        }
    });
}

ipcMain.on('toggle-active-devtools', (event) => {
    if (!mainWindow) return;

    // Send a signal back to renderer to handle webview DevTools directly
    mainWindow.webContents.send('master-shortcut', 'toggle-devtools');
});

// Sync system theme settings with the main process
ipcMain.on('set-native-theme', (event, mode) => {
    nativeTheme.themeSource = mode;
});

// --- IPC CONFIG CHANNELS FOR THE UI ---
ipcMain.handle('get-browser-settings', async () => {
    return loadBrowserConfig();
});

// --- IPC CHANNELS AND UTILITY HANDLERS ---
ipcMain.on('get-webview-preload-path', (event) => { event.returnValue = path.join(__dirname, 'webview-preload.js'); });

ipcMain.handle('read-hinter-code', async () => {
    try {
        const hinterPath = path.join(__dirname, 'hinter.js');
        if (fs.existsSync(hinterPath)) return fs.readFileSync(hinterPath, 'utf8');
    } catch (err) {}
    return '';
});

ipcMain.handle('get-session', async () => {
    try {
        if (fs.existsSync(sessionPath)) return JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    } catch (err) {}
    return { current_workspace: "Workspace 1", workspaces: { "Workspace 1": ["https://duckduckgo.com"] } };
});
ipcMain.handle('save-session', async (event, sessionData) => {
    try {
        const dir = path.dirname(sessionPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 4), 'utf8');
        return true;
    } catch (err) { return false; }
});

// --- IPC HISTORY CHANNELS ---
ipcMain.handle('search-history', async (event, query) => {
    const history = readHistory();
    if (!query || !query.trim()) return history;

    const lowerQuery = query.toLowerCase();
    return history.filter(item => 
        item.title.toLowerCase().includes(lowerQuery) || 
        item.url.toLowerCase().includes(lowerQuery)
    );
});

ipcMain.handle('purge-history', async () => {
    try {
        if (fs.existsSync(historyPath)) {
            fs.writeFileSync(historyPath, JSON.stringify([], null, 4), 'utf8');
        }
        return true;
    } catch (err) {
        return false;
    }
});

// Toggle menu bar visibility on demand
ipcMain.on('toggle-menu-bar', () => {
    const isVisible = mainWindow.isMenuBarVisible();
    mainWindow.setMenuBarVisibility(!isVisible);
});

const { clipboard } = require('electron');
const { exec, spawn } = require('child_process');

ipcMain.on('execute-terminal-command', (event, commandStr) => {
    if (!commandStr || !commandStr.trim()) return;

    clipboard.writeText(commandStr);

    const platform = process.platform;

    if (platform === 'linux') {
        const emulators = ["kitty", "alacritty", "foot", "st", "xterm"];
        exec("which " + emulators.join(" "), (err, stdout) => {
            let chosenTerm = "";
            if (stdout) {
                const paths = stdout.trim().split("\n");
                if (paths.length > 0) {
                    chosenTerm = paths[0].split("/").pop();
                }
            }
            if (!chosenTerm) {
                chosenTerm = "xdg-terminal-exec";
            }
            spawn(chosenTerm, [], { detached: true, stdio: 'ignore' }).unref();
        });
    } 
    else if (platform === 'darwin') {
        spawn('open', ['-a', 'Terminal'], { detached: true, stdio: 'ignore' }).unref();
    } 
    else if (platform === 'win32') {
        exec('where wt', (err) => {
            if (!err) {
                spawn('wt', [], { detached: true, stdio: 'ignore' }).unref();
            } else {
                spawn('cmd.exe', [], { 
                    detached: true, 
                    stdio: 'ignore',
                    windowsHide: false
                }).unref();
            }
        });
    }
});

// Monitor all global frame allocations to catch child webview tags securely
app.on('web-contents-created', (event, webContents) => {
    if (webContents.getType() === 'webview') {

        webContents.on('did-navigate', (navEvent, url) => {
            const title = webContents.getTitle();
            logVisit(title, url);
        });

        webContents.on('did-navigate-in-page', (navEvent, url) => {
            const title = webContents.getTitle();
            logVisit(title, url);
        });

        webContents.on('context-menu', (contextEvent, params) => {
            contextEvent.preventDefault();
            
            const menu = new Menu();

            if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
                params.dictionarySuggestions.forEach(suggestion => {
                    menu.append(new MenuItem({
                        label: suggestion,
                        click: () => webContents.replaceMisspelling(suggestion)
                    }));
                });
                menu.append(new MenuItem({ type: 'separator' }));
            }

            if (params.selectionText && params.selectionText.trim() !== '') {
                menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
            }
            if (params.linkURL && params.linkURL.trim() !== '') {
                menu.append(new MenuItem({
                    label: 'Open Link in New Tab',
                    click: () => {
                        if (mainWindow && mainWindow.webContents) {
                            mainWindow.webContents.send('master-shortcut', 'spawn-tab-with-url', params.linkURL);
                        }
                    }
                }));
            }
            if (params.isEditable) {
                menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
                menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
                menu.append(new MenuItem({ label: 'Select All', role: 'selectall' }));
            }
            if (params.mediaType === 'image') {
                menu.append(new MenuItem({
                    label: 'Save Image As...',
                    click: () => { if (mainWindow) mainWindow.webContents.downloadURL(params.srcURL); }
                }));
                menu.append(new MenuItem({
                    label: 'Copy Image Address',
                    click: () => { const { clipboard } = require('electron'); clipboard.writeText(params.srcURL); }
                }));
            }
            if (menu.items.length === 0) {
                menu.append(new MenuItem({ label: 'Back', click: () => { webContents.send('master-shortcut', 'go-back-signal'); } }));
                menu.append(new MenuItem({ label: 'Forward', click: () => { webContents.send('master-shortcut', 'go-forward-signal'); } }));
                menu.append(new MenuItem({ label: 'Reload', click: () => { webContents.reload(); } }));
            }

            menu.popup({ window: mainWindow });
        });

        webContents.setWindowOpenHandler((details) => {
            if (details.url && details.url !== 'about:blank') {
                if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('master-shortcut', 'spawn-tab-with-url', details.url);
                }
            }
            return { action: 'deny' };
        });

        webContents.on('before-input-event', (inputEvent, input) => {
            if (input.type !== 'keyDown') return;
            const isCtrl = input.control;
            const key = input.key.toLowerCase();
            
            if (isCtrl && key === 'r') {
                inputEvent.preventDefault();
                webContents.reload();
            }
            else if (isCtrl && key === 's') {
                inputEvent.preventDefault();
                if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('master-shortcut', 'toggle-find');
                }
            }
        });
    }
});

app.whenReady().then(createWindow);
