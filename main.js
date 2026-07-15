const { app, BrowserWindow, ipcMain, session, Menu, MenuItem } = require('electron');
const path = require('path');
const fs = require('fs');

// Require the security config module to isolate filtering and hardening rules
const security = require('./security');

let mainWindow;
const sessionPath = path.join(app.getPath('home'), '.config', 'mise-browser', 'session.json');

let privateBrowsingEnabled = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 1040,
        frame: true,
        autoHideMenuBar: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true
        }
    });
    
    mainWindow.setMenu(null);
    mainWindow.loadFile('index.html');

    // Safe context configuration deferred until the main layout tree completes mounting
    mainWindow.webContents.once('dom-ready', () => {
        try {
            const defaultUA = session.defaultSession.getUserAgent();
            const privateSession = session.fromPartition('MisePrivateProfile');
            privateSession.setUserAgent(defaultUA);
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

    ipcMain.on('show-context-menu', (event, params) => {
        const menu = new Menu();
        // Dynamically append dictionary corrections at the top of the menu list for misspelled targets
        if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
            params.dictionarySuggestions.forEach(suggestion => {
                menu.append(new MenuItem({
                    label: suggestion,
                    click: () => {
                        // Instruct the specific webContents source to replace the misspelled text selection
                        event.sender.replaceMisspelling(suggestion);
                    }
                }));
            });
            // Add a visual separator between spelling corrections and standard utility actions
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
            menu.append(new MenuItem({ label: 'Back', click: () => { event.sender.send('master-shortcut', 'go-back-signal'); } }));
            menu.append(new MenuItem({ label: 'Forward', click: () => { event.sender.send('master-shortcut', 'go-forward-signal'); } }));
            menu.append(new MenuItem({ label: 'Reload', click: () => { event.sender.reload(); } }));
        }
        menu.popup(BrowserWindow.fromWebContents(event.sender));
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
            // Decouple from command palette and toggle private state variables securely
            event.preventDefault();
            privateBrowsingEnabled = !privateBrowsingEnabled;
            mainWindow.webContents.send('master-shortcut', 'toggle-private-mode', privateBrowsingEnabled);
        }
        else if (isCtrl && key === 'p') {
            // Keep pure Ctrl + P assigned exclusively to the Command Palette modal overlay
            event.preventDefault();
            mainWindow.webContents.send('master-shortcut', 'toggle-palette');
        }
    });
}

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

// Toggle menu bar visibility on demand
ipcMain.on('toggle-menu-bar', () => {
    const isVisible = mainWindow.isMenuBarVisible();
    mainWindow.setMenuBarVisibility(!isVisible);
});

const { clipboard } = require('electron');
const { exec, spawn } = require('child_process');

ipcMain.on('execute-terminal-command', (event, commandStr) => {
    if (!commandStr || !commandStr.trim()) return;

    // Securely write the formatted text to the system clipboard
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
        // Safe Darwin launch via the native open command without shell argument passing
        spawn('open', ['-a', 'Terminal'], { detached: true, stdio: 'ignore' }).unref();
    } 
    else if (platform === 'win32') {
        // Distro-agnostic Windows logic checks for modern Windows Terminal or falls back to cmd
        exec('where wt', (err) => {
            if (!err) {
                spawn('wt', [], { detached: true, stdio: 'ignore' }).unref();
            } else {
                // Spawn a clean cmd instance using the creation flags to detach it as a separate window
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
        
        // Intercept right-clicks inside guest frames and handle spellcheck corrections natively
        webContents.on('context-menu', (contextEvent, params) => {
            contextEvent.preventDefault();
            
            const menu = new Menu();

            // Populate spelling suggestions directly from the active guest frame configuration
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
        });
    }
});

app.whenReady().then(createWindow);
