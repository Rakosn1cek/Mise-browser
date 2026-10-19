const { app, BrowserWindow, ipcMain, session, Menu, MenuItem, nativeTheme, Notification, clipboard, shell, webContents, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn, execSync, spawnSync } = require('child_process');
const v8 = require('v8');
const vm = require('vm');

// Expose GC in Node main process for memory compaction
try {
    v8.setFlagsFromString(['-', '-', 'expose-gc'].join(''));
    global.gc = vm.runInNewContext('gc');
} catch (e) {
    // Ignore if flag modification is not supported
}

// Single instance lock to prevent duplicate windows when opening external links
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
}

// Canonical application identity for Wayland and X11 desktop integration
app.setName('mise-browser');
app.setAppUserModelId('io.github.rakosn1cek.mise-browser');

// Require the security config module to isolate filtering and hardening rules
const security = require('./security');
const keybinds = require('./keybinds');
const userContent = require('./userContent');
const diagnostics = require('./diagnostics');
const downloads = require('./main/downloads');
const config = require('./main/config');
const {
    CONFIG_DIR,
    CONFIG_PATH,
    DEFAULT_CONFIG,
    DEFAULT_THEME_COLORS,
    loadBrowserConfig,
    saveBrowserConfig,
    writeConfigFile,
    updateBrowserConfig,
    restartApp
} = config;

const sessionStore = require('./main/sessionStore');
const {
    sessionPath,
    sessionBackupPath,
    sentinelPath,
    checkAndInitializeSentinel,
    markSentinelState,
    isCrashRecoveryState,
    flushSessionToDisk,
    scheduleSessionSave,
    readCurrentSession,
    registerSessionIpc
} = sessionStore;

const storage = require('./main/storage');
const {
    flushHistoryToDisk,
    logVisit
} = storage;

const updater = require('./main/updater');

// Initialise keybinds configuration
keybinds.initializeKeybinds(CONFIG_DIR);

function initializeEngineSwitches() {
    const cfg = loadBrowserConfig();

    app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default_public_interface_only');

    // Privacy and unwanted Web API feature restrictions
    const disabledFeatures = [
        'Translate', 'PrivacySandboxSettings4',
        'PrivacySandboxAdsAPIsOverride', 'PrivacySandboxAdsAPIsM1Override',
        'PrivacySandboxAdsAPIs', 'BrowsingTopics',
        'BrowsingTopicsDocumentAPI', 'Fledge',
        'FencedFrames', 'SharedStorage', 'PrivateAggregationApi',
        'InterestGroupStorage', 'AttributionReportingCrossAppWeb',
        'WebUSB', 'WebBluetooth', 'Serial',
        'GenericSensor', 'Vulkan',
        'VulkanFromANGLE', 'DefaultANGLEVulkan',
        'WebGPU', 'SkiaGraphite'
    ];
    app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));
    app.commandLine.appendSwitch('disable-vulkan-surface');

    if (cfg.disable_gpu) {
        app.commandLine.appendSwitch('disable-gpu');
        app.commandLine.appendSwitch('disable-gpu-compositing');
    } else {
        if (process.platform === 'linux') {
            app.commandLine.appendSwitch('ignore-gpu-blocklist');
            app.commandLine.appendSwitch('enable-gpu-rasterization');
            app.commandLine.appendSwitch('enable-accelerated-video-decode');
            // Kept VA-API hardware decode/encode and CanvasOopRasterization for parallel GPU tile rasterization
            app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder,CanvasOopRasterization,TLSExtensionGrease');
        } else {
            app.commandLine.appendSwitch('enable-features', 'TLSExtensionGrease');
        }
    }

    if (cfg.background_throttling) {
        app.commandLine.appendSwitch('enable-background-timer-throttling');
        app.commandLine.appendSwitch('add-delay-to-background-timer-tasks');
    }
    
    // Compositor texture boundary allocation
    app.commandLine.appendSwitch('force-gpu-mem-available-mb', '512');

    app.commandLine.appendSwitch('renderer-process-limit', String(cfg.process_limit || 4));
    app.commandLine.appendSwitch('disable-smooth-scrolling');
    app.commandLine.appendSwitch('enable-strict-mixed-content-checking');
    app.commandLine.appendSwitch('disable-battery-saver');
    app.commandLine.appendSwitch('log-level', '3');
    app.commandLine.appendSwitch('disable-speech-api');

    // Explicit disk and media cache caps (150MB and 50MB) to prevent profile bloat
    app.commandLine.appendSwitch('disk-cache-size', '157286400');
    app.commandLine.appendSwitch('media-cache-size', '52428800');

    // Google sign-in needs Electron's own identity, see security.js
    security.setGoogleSignInUserAgent(app.userAgentFallback);

    // Standardise baseline User-Agent string across all renderers and network requests
    const realChromeMajor = (process.versions && process.versions.chrome) ? process.versions.chrome.split('.')[0] : '132';
    app.userAgentFallback = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${realChromeMajor}.0.0.0 Safari/537.36`;
}

initializeEngineSwitches();

let mainWindow;
let privateBrowsingEnabled = false;

// URL queue and readiness tracking for external link dispatch
let isRendererReady = false;
const pendingUrls = [];

function extractUrlsFromArgs(argv) {
    if (!argv || !Array.isArray(argv)) return [];
    const urls = [];
    for (let i = 1; i < argv.length; i++) {
        let arg = (argv[i] || '').trim();
        if (!arg) continue;
        if (arg.startsWith('-')) continue;
        arg = arg.replace(/^["']|["']$/g, '');
        if (arg === '.' || arg.endsWith('main.js') || arg === __dirname) continue;

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

// Queue initial command line URLs received on cold start
extractUrlsFromArgs(process.argv).forEach(url => pendingUrls.push(url));


function sendSystemNotification(title, body) {
    if (!Notification.isSupported()) return;

    const notification = new Notification({
        title: title,
        body: body,
        icon: path.join(__dirname, 'assets', 'icons', 'Mise-logo256.png'),
        urgency: 'low',
        silent: true
    });

    notification.show();
}

let globalNotificationsEnabled = true;

// Generates a filesystem-safe persistent container partition string for a workspace
function getWorkspacePartition(workspaceName) {
    if (!workspaceName) return 'persist:default';
    const clean = String(workspaceName).trim().toLowerCase().replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return `persist:${clean || 'default'}`;
}

function getSessionForContext(context) {
    if (typeof context === 'string') {
        return session.fromPartition(context);
    }
    if (context && typeof context === 'object') {
        if (context.isPrivate) return session.fromPartition('MisePrivateProfile');
        if (context.partition) return session.fromPartition(context.partition);
        if (context.workspace) return session.fromPartition(getWorkspacePartition(context.workspace));
    }
    if (context === true) return session.fromPartition('MisePrivateProfile');
    return session.defaultSession;
}

const configuredSessions = new WeakSet();
const activeSessions = new Set();
function applySpellcheckerToAllSessions(lang) {
    for (const sess of activeSessions) {
        security.applySpellcheckerLanguage(sess, lang);
    }
}

function configureAndHardenSession(targetSession) {
    if (!targetSession) return;
    activeSessions.add(targetSession);
    if (configuredSessions.has(targetSession)) return;
    configuredSessions.add(targetSession);

    const cfg = loadBrowserConfig();
    security.hardenSession(targetSession, cfg.spellchecker_language || 'en-GB');
    configureSessionPermissions(targetSession);
    downloads.configureDownloads(targetSession, {
        getMainWindow: () => mainWindow,
        sendNotification: sendSystemNotification,
        areNotificationsEnabled: () => globalNotificationsEnabled
    });
}

function configureSessionPermissions(targetSession) {
    targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
        let hostname = '';
        try { hostname = new URL(webContents.getURL()).hostname; } catch (e) {}
        const trusted = security.isTrustedDomain(hostname);
        const allowed = security.decidePermission(permission, {
            trusted,
            notificationsEnabled: globalNotificationsEnabled
        });
        if (!allowed) {
            diagnostics.logEvent('warn', 'permissions', 'Denied permission', { permission, hostname });
        }
        callback(allowed);
    });

    targetSession.setPermissionCheckHandler((webContents, permission, origin) => {
        let hostname = '';
        try { hostname = new URL(origin).hostname; } catch (e) {}
        const trusted = security.isTrustedDomain(hostname);
        const allowed = security.decidePermission(permission, {
            trusted,
            notificationsEnabled: globalNotificationsEnabled
        });
        if (!allowed) {
            diagnostics.logEvent('warn', 'permissions', 'Denied permission', { permission, hostname });
        }
        return allowed;
    });
}

ipcMain.handle('toggle-global-notifications', (event, enabled) => {
    globalNotificationsEnabled = enabled;
    return globalNotificationsEnabled;
});

// Register download lifecycle and file manager IPC channels
downloads.registerDownloadIpc(ipcMain, {
    sendNotification: sendSystemNotification
});

// Register version information and update check IPC channels
updater.registerUpdaterIpc(ipcMain, { app });

ipcMain.handle('open-external', async (event, url) => {
    if (!url || typeof url !== 'string') return false;
    try {
        const parsed = new URL(url);
        const allowedProtocols = ['http:', 'https:', 'obsidian:', 'logseq:', 'notes:', 'mailto:'];
        if (allowedProtocols.includes(parsed.protocol)) {
            await shell.openExternal(url);
            return true;
        }
    } catch (e) {}
    return false;
});

// IPC HANDLERS
ipcMain.handle('flush-session-store', async (event, context) => {
    flushSessionToDisk();
    const targetSession = getSessionForContext(context);
    try {
        if (targetSession && targetSession.cookies) {
            await targetSession.cookies.flushStore();
            return true;
        }
    } catch (err) {
        return false;
    }
    return false;
});

ipcMain.handle('clear-active-cache', async (event, context) => {
    const targetSession = getSessionForContext(context);
    try {
        await targetSession.clearCache();
        await targetSession.clearStorageData({
            storages: ['cachestorage', 'serviceworkers', 'shadercache']
        });
        sendSystemNotification('Mise Browser', 'Cache and storage cleared successfully.');
        return true;
    } catch (err) {
        sendSystemNotification('Mise Error', `Cache clear failed: ${err.message}`);
        return false;
    }
});

ipcMain.handle('clear-domain-cookies', async (event, data) => {
    const targetSession = getSessionForContext(data);
    try {
        const parsed = new URL(data.urlStr);
        const cookies = await targetSession.cookies.get({ domain: parsed.hostname });
        
        for (const cookie of cookies) {
            const protocol = cookie.secure ? 'https://' : 'http://';
            const domain = cookie.domain.replace(/^\./, '');
            await targetSession.cookies.remove(`${protocol}${domain}${cookie.path}`, cookie.name);
        }

        sendSystemNotification('Mise Browser', `Cookies cleared for ${parsed.hostname}`);
        return true;
    } catch (err) {
        sendSystemNotification('Mise Error', `Cookie wipe failed: ${err.message}`);
        return false;
    }
});

ipcMain.handle('get-workspace-partition', (event, name) => {
    return getWorkspacePartition(name);
});

ipcMain.on('toggle-active-devtools', () => {
    if (!mainWindow) return;
    mainWindow.webContents.send('master-shortcut', 'toggle-devtools');
});

ipcMain.on('set-native-theme', (event, mode) => {
    if (mode === 'dark' || mode === 'light' || mode === 'system') {
        nativeTheme.themeSource = mode;
        return;
    }
    const cfg = loadBrowserConfig();
    nativeTheme.themeSource = cfg.webview_theme || 'dark';
});

// Register configuration and preference IPC handlers
config.registerConfigIpc(ipcMain, {
    onTrustedDomainsChange: security.setTrustedDomains,
    onSpellcheckerChange: applySpellcheckerToAllSessions,
    onDiagnosticsChange: diagnostics.setDiagnosticsEnabled
});

ipcMain.on('renderer-ready', () => {
    isRendererReady = true;
    flushPendingUrls();
});

ipcMain.on('get-webview-preload-path', (event) => { 
    event.returnValue = path.join(__dirname, 'webview-preload.js'); 
});

ipcMain.on('get-pdf-viewer-path', (event) => { 
    event.returnValue = 'file://' + path.join(__dirname, 'assets', 'pdfjs', 'viewer.html'); 
});

ipcMain.on('get-pdf-viewer-url', (event, targetUrl) => { 
    event.returnValue = security.mintPdfViewerUrl(targetUrl); 
});

ipcMain.on('get-whats-new-path', (event) => { 
    event.returnValue = 'file://' + path.join(__dirname, 'assets', 'whats-new.html'); 
});

ipcMain.on('get-welcome-path', (event) => { 
    event.returnValue = 'file://' + path.join(__dirname, 'assets', 'welcome.html'); 
});

ipcMain.handle('read-pdf-data', async (event, payload) => {
    const { token, url: sourceUrl } = payload || {};
    if (!sourceUrl || typeof sourceUrl !== 'string') {
        throw new Error('Invalid PDF URL specified.');
    }

    security.validatePdfAccess(token, sourceUrl, event.sender ? event.sender.getURL() : '');

    if (sourceUrl.startsWith('file://') || sourceUrl.startsWith('/')) {
        let filePath = sourceUrl;
        if (sourceUrl.startsWith('file://')) {
            try {
                filePath = new URL(sourceUrl).pathname;
            } catch (e) {
                filePath = sourceUrl.replace(/^file:\/\//, '');
            }
        }
        filePath = decodeURIComponent(filePath);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Local file not found: ${filePath}`);
        }
        const data = await fs.promises.readFile(filePath);
        return data;
    }

    if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
        const callerSession = event.sender ? event.sender.session : session.defaultSession;
        const netFetch = (callerSession && callerSession.net && typeof callerSession.net.fetch === 'function')
            ? callerSession.net.fetch.bind(callerSession.net)
            : net.fetch;

        const response = await netFetch(sourceUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch PDF: HTTP ${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    if (sourceUrl.startsWith('data:application/pdf;base64,')) {
        const base64Data = sourceUrl.split(',')[1];
        return Buffer.from(base64Data, 'base64');
    }

    throw new Error(`Unsupported protocol for PDF loading: ${sourceUrl}`);
});

ipcMain.handle('save-pdf-file', async (event, payload) => {
    try {
        const { token, options } = payload || {};
        const { url, suggestedName, data } = options || {};

        security.validatePdfAccess(token, url, event.sender ? event.sender.getURL() : '');

        let cleanName = suggestedName || 'document.pdf';
        if (!cleanName.toLowerCase().endsWith('.pdf')) cleanName += '.pdf';

        const defaultSavePath = path.join(app.getPath('downloads'), cleanName);

        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Save PDF Document',
            defaultPath: defaultSavePath,
            filters: [
                { name: 'PDF Documents', extensions: ['pdf'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (canceled || !filePath) {
            return { success: false, canceled: true };
        }

        if (data && (Buffer.isBuffer(data) || data instanceof Uint8Array || ArrayBuffer.isView(data))) {
            await fs.promises.writeFile(filePath, Buffer.from(data));
        } else if (url && (url.startsWith('file://') || url.startsWith('/'))) {
            let srcPath = url.startsWith('file://') ? new URL(url).pathname : url;
            srcPath = decodeURIComponent(srcPath);
            await fs.promises.copyFile(srcPath, filePath);
        } else if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            const callerSession = event.sender ? event.sender.session : session.defaultSession;
            const netFetch = (callerSession && callerSession.net && typeof callerSession.net.fetch === 'function')
                ? callerSession.net.fetch.bind(callerSession.net)
                : net.fetch;
            const resp = await netFetch(url);
            const arrayBuf = await resp.arrayBuffer();
            await fs.promises.writeFile(filePath, Buffer.from(arrayBuf));
        } else {
            throw new Error('No PDF payload or valid source URL provided.');
        }

        const stats = await fs.promises.stat(filePath);
        const record = {
            id: `dl_pdf_${Date.now()}`,
            filename: path.basename(filePath),
            totalBytes: stats.size,
            receivedBytes: stats.size,
            state: 'completed',
            savePath: filePath,
            url: url || ''
        };

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-done', record);
        }

        if (globalNotificationsEnabled) {
            sendSystemNotification('PDF Saved', `${path.basename(filePath)} saved successfully.`);
        }

        return { success: true, filePath };
    } catch (err) {
        console.error('Failed to save PDF document:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('read-hinter-code', async () => {
    try {
        const hinterPath = path.join(__dirname, 'hinter.js');
        if (fs.existsSync(hinterPath)) return fs.readFileSync(hinterPath, 'utf8');
    } catch (err) {}
    return '';
});

let cachedReaderDistillerCode = null;
ipcMain.handle('read-reader-code', async () => {
    if (cachedReaderDistillerCode) return cachedReaderDistillerCode;
    try {
        const distillerPath = path.join(__dirname, 'modules', 'readerDistiller.js');
        if (fs.existsSync(distillerPath)) {
            cachedReaderDistillerCode = fs.readFileSync(distillerPath, 'utf8');
            return cachedReaderDistillerCode;
        }
    } catch (err) {}
    return '';
});

// Register session persistence and crash recovery IPC channels
sessionStore.registerSessionIpc(ipcMain);

// Register storage and local data IPC channels
storage.registerStorageIpc(ipcMain);

ipcMain.on('toggle-menu-bar', () => {
    openSettingsMenu();
});

// Window management controls
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

ipcMain.handle('get-keybinds', async () => {
    return keybinds.getKeybinds();
});

ipcMain.handle('save-keybinds', async (event, binds) => {
    return keybinds.saveKeybinds(CONFIG_DIR, binds);
});

ipcMain.handle('get-action-metadata', async () => {
    return keybinds.getActionMetadata();
});

ipcMain.handle('reload-keybinds', async () => {
    return keybinds.initializeKeybinds(CONFIG_DIR);
});

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
    } else if (platform === 'darwin') {
        spawn('open', ['-a', 'Terminal'], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'win32') {
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



ipcMain.handle('get-system-diagnostics', async (event, sessionStats) => {
    return diagnostics.gatherSystemDiagnostics(sessionStats);
});

ipcMain.handle('clear-diagnostics-logs', async () => {
    diagnostics.clearLogs();
    return true;
});

ipcMain.handle('set-diagnostics-enabled', async (event, enabled) => {
    diagnostics.setDiagnosticsEnabled(enabled);
    try {
        const cfg = loadBrowserConfig();
        cfg.enable_diagnostics = !!enabled;
        if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
        writeConfigFile(cfg);
    } catch (e) {}
    return true;
});

ipcMain.handle('log-diagnostics-event', async (event, data) => {
    if (data && typeof data === 'object') {
        diagnostics.logEvent(data.level, data.category, data.message, data.details);
    }
    return true;
});

function initializeMemoryWatcher() {
    setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const metrics = app.getAppMetrics();
        let shouldHibernate = false;
        metrics.forEach(metric => {
            // Electron returns residentSet in KiB; 200 * 1024 KiB = 200 MB
            if (metric.type === 'Renderer' && metric.memory.residentSet > 200 * 1024) {
                const wc = webContents.fromId(metric.webContentsId);
                if (wc && !wc.isFocused()) {
                    shouldHibernate = true;
                }
            }
        });
        if (shouldHibernate) {
            mainWindow.webContents.send('master-shortcut', 'hibernate-inactive-tabs');
            if (typeof global.gc === 'function') {
                setTimeout(() => { try { global.gc(); } catch (e) {} }, 1000);
            }
        }
    }, 15000);
}

ipcMain.handle('compact-memory', () => {
    if (typeof global.gc === 'function') {
        try {
            global.gc();
            return true;
        } catch (e) {}
    }
    return false;
});

function buildSettingsSubmenu(cfg) {
    return [
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
            submenu: [1, 2, 3, 4, 5].map(num => ({
                label: `Limit to ${num} process${num === 1 ? '' : 'es'}`,
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
            label: 'Tab Hibernation (Sleep Timeout)',
            submenu: [
                { minutes: 5, label: '5 minutes' },
                { minutes: 15, label: '15 minutes (Default)' },
                { minutes: 30, label: '30 minutes' },
                { minutes: 60, label: '1 hour' },
                { minutes: 0, label: 'Never (Disabled)' }
            ].map(opt => ({
                label: opt.label,
                type: 'radio',
                checked: (cfg.tab_sleep_timeout_minutes ?? 15) === opt.minutes,
                click: () => {
                    cfg.tab_sleep_timeout_minutes = opt.minutes;
                    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
                    writeConfigFile(cfg);
                }
            }))
        },
        { type: 'separator' },
        {
            label: 'Auto-Collapse Sidebar (36px Strip)',
            type: 'checkbox',
            checked: cfg.sidebar_auto_collapse !== false,
            click: (menuItem) => {
                cfg.sidebar_auto_collapse = menuItem.checked;
                if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
                writeConfigFile(cfg);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('master-shortcut', 'toggle-sidebar-collapse-mode', menuItem.checked);
                }
            }
        },
        {
            label: 'Window Controls (Sidebar)',
            type: 'checkbox',
            checked: !!cfg.show_window_controls,
            click: (menuItem) => {
                cfg.show_window_controls = menuItem.checked;
                if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
                writeConfigFile(cfg);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('master-shortcut', 'toggle-window-controls', menuItem.checked);
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Open User Scripts Directory',
            click: () => {
                const sDir = path.join(CONFIG_DIR, 'scripts');
                if (!fs.existsSync(sDir)) fs.mkdirSync(sDir, { recursive: true });
                shell.openPath(sDir);
            }
        },
        {
            label: 'Open User Styles Directory',
            click: () => {
                const stDir = path.join(CONFIG_DIR, 'styles');
                if (!fs.existsSync(stDir)) fs.mkdirSync(stDir, { recursive: true });
                shell.openPath(stDir);
            }
        },
        {
            label: 'Open Full Preferences Overlay',
            accelerator: 'Ctrl+H',
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('master-shortcut', 'toggle-help');
                }
            }
        },
        {
            label: 'Restart Browser Now',
            click: () => restartApp()
        }
    ];
}

function openSettingsMenu() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const cfg = loadBrowserConfig();
    const menu = Menu.buildFromTemplate(buildSettingsSubmenu(cfg));
    menu.popup({ window: mainWindow, x: 14, y: 14 });
}

function handleAppAction(action, sourceWebContents) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (action === 'toggle-menu-bar') {
        openSettingsMenu();
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

    if (action === 'toggle-private-mode') {
        privateBrowsingEnabled = !privateBrowsingEnabled;
        mainWindow.webContents.send('master-shortcut', 'toggle-private-mode', privateBrowsingEnabled);
        return;
    }

    mainWindow.webContents.send('master-shortcut', action);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 1040,
        icon: path.join(__dirname, 'assets', 'icons', 'Mise-logo256.png'),
        frame: true,
        autoHideMenuBar: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
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
            submenu: buildSettingsSubmenu(cfg)
        }
    ]);
    mainWindow.setMenu(systemMenu);
    mainWindow.setMenuBarVisibility(false);
    
    // Configure default and volatile private sessions
    configureAndHardenSession(session.defaultSession);
    configureAndHardenSession(session.fromPartition('MisePrivateProfile'));

    // Configure active workspace partition; other partitions configure lazily on demand
    try {
        const initialSession = readCurrentSession();
        const activeWs = (initialSession && initialSession.current_workspace) || 'default';
        configureAndHardenSession(session.fromPartition(getWorkspacePartition(activeWs)));
    } catch (err) {
        console.error('Failed to initialise active workspace session:', err);
    }

    security.setTrustedDomains(loadBrowserConfig().trusted_domains || []);

    mainWindow.loadFile('index.html');

    mainWindow.on('close', () => {
        markSentinelState(true);
        flushSessionToDisk();
        flushHistoryToDisk();
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
                isRendererReady = true;
                flushPendingUrls();
            }
            // Trigger idle heap sweep to release startup deserialisation buffers
            if (typeof global.gc === 'function') {
                try { global.gc(); } catch (e) {}
            }
        }, 1200);

        // Check for updates in background after startup
        setTimeout(async () => {
            try {
                const updateInfo = await checkAppUpdates(false);
                if (updateInfo && updateInfo.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-available', updateInfo);
                }
            } catch (e) {}
        }, 6000);
    });

    ipcMain.on('is-trusted-domain', (event, hostname) => {
        event.returnValue = security.isTrustedDomain(hostname);
    });

    ipcMain.on('get-google-signin-user-agent', (event, hostname) => {
        event.returnValue = security.getGoogleSignInUserAgent(hostname);
    });

    ipcMain.handle('clear-google-auth-cookies', async (event, partitionName) => {
        const targetSession = partitionName ? session.fromPartition(partitionName) : session.fromPartition('MisePrivateProfile');
        await security.clearGoogleAuthCookies(targetSession);
        return true;
    });

    userContent.initializeUserContent(CONFIG_DIR, mainWindow);

    mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
        security.hardenWebviewPreferences(webPreferences);
        const partitionStr = (webPreferences && webPreferences.partition) || (params && params.partition);
        if (partitionStr) {
            configureAndHardenSession(session.fromPartition(partitionStr));
        }
    });

    ipcMain.on('bubble-webview-key', (event, action) => {
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('master-shortcut', action);
        }
    });

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;

        const action = keybinds.getActionForInput(input);
        if (action) {
            event.preventDefault();
            handleAppAction(action, mainWindow.webContents);
        }
    });
}

app.on('web-contents-created', (event, webContents) => {
    if (webContents.session) {
        configureAndHardenSession(webContents.session);
    }

    if (webContents.getType() === 'webview') {
        webContents.setMaxListeners(30);

        const isPrivate = webContents.session === session.fromPartition('MisePrivateProfile');

        webContents.on('did-navigate', (navEvent, url) => {
            if (!isPrivate) {
                logVisit(webContents.getTitle(), url);
            }
            if (url) {
                try {
                    const parsedUrl = new URL(url);
                    if ((parsedUrl.hostname === 'accounts.google.com' || parsedUrl.hostname.endsWith('.accounts.google.com')) &&
                        parsedUrl.pathname.includes('signin/rejected')) {
                        security.clearGoogleAuthCookies(webContents.session);
                    }
                } catch (e) {
                    // Ignore URL parsing errors
                }
            }
        });

        webContents.on('did-navigate-in-page', (navEvent, url) => {
            if (!isPrivate) {
                logVisit(webContents.getTitle(), url);
            }
        });

        webContents.on('context-menu', (contextEvent, params) => {
            contextEvent.preventDefault();
            
            const menu = new Menu();

            const openShareModal = (url) => {
                if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('master-shortcut', 'open-transient-share', url);
                }
            };

            const openLinkTab = (url) => {
                if (security.isSafeTabUrl(url) && mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('master-shortcut', 'spawn-tab-with-url', url);
                }
            };

            const openLinkInSplit = (url) => {
                if (security.isSafeTabUrl(url) && mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('master-shortcut', 'open-link-in-split', url);
                }
            };

            const saveSelectionToNotes = (selectionText, sourceUrl, pageTitle) => {
                if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('master-shortcut', 'save-selection-to-notes', {
                        text: selectionText,
                        url: sourceUrl,
                        title: pageTitle
                    });
                }
            };

            const targetUrl = params.linkURL || params.srcURL || params.pageURL || webContents.getURL();
            const targetText = params.selectionText ? params.selectionText.trim() : webContents.getTitle();
            
            const encodedUrl = encodeURIComponent(targetUrl || '');
            const encodedText = encodeURIComponent(targetText || '');
        
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
                const selectedText = params.selectionText.trim();
                const pageTitle = webContents.getTitle() || 'Web clipping';
                const currentUrl = params.pageURL || webContents.getURL() || '';

                menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
                menu.append(new MenuItem({
                    label: 'Save to Notes',
                    click: () => {
                        saveSelectionToNotes(selectedText, currentUrl, pageTitle);
                    }
                }));
            }
            
            if (params.linkURL && params.linkURL.trim() !== '') {
                menu.append(new MenuItem({
                    label: 'Open Link in New Tab',
                    click: () => openLinkTab(params.linkURL)
                }));
                menu.append(new MenuItem({
                    label: 'Open Link in Split View',
                    click: () => openLinkInSplit(params.linkURL)
                }));
                menu.append(new MenuItem({
                    label: 'Copy Link Address',
                    click: () => {
                        clipboard.writeText(params.linkURL);
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
                    click: () => { 
                        clipboard.writeText(params.srcURL); 
                    }
                }));
            }

            if (menu.items.length === 0) {
                menu.append(new MenuItem({ label: 'Back', click: () => { webContents.send('master-shortcut', 'go-back-signal'); } }));
                menu.append(new MenuItem({ label: 'Forward', click: () => { webContents.send('master-shortcut', 'go-forward-signal'); } }));
                menu.append(new MenuItem({ label: 'Reload', click: () => { webContents.reload(); } }));
            }
        
            if (menu.items.length > 0) {
                menu.append(new MenuItem({ type: 'separator' }));
            }
        
            const shareSubmenu = new Menu();
            shareSubmenu.append(new MenuItem({
                label: 'Share to WhatsApp',
                click: () => openShareModal(`https://web.whatsapp.com/send?text=${encodedText}%20${encodedUrl}`)
            }));
            shareSubmenu.append(new MenuItem({
                label: 'Share to X (Twitter)',
                click: () => openShareModal(`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`)
            }));
            shareSubmenu.append(new MenuItem({
                label: 'Share to Telegram',
                click: () => openShareModal(`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`)
            }));
            shareSubmenu.append(new MenuItem({
                label: 'Share to Reddit',
                click: () => openShareModal(`https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`)
            }));
        
            shareSubmenu.append(new MenuItem({
                label: 'Share via Email',
                click: () => {
                    const cfg = loadBrowserConfig();
                    const handler = cfg.email_handler || 'system';
        
                    const pageTitle = webContents.getTitle() || 'Shared link';
                    const currentUrl = params.pageURL || webContents.getURL() || '';
                    const selectedSnippet = params.selectionText ? params.selectionText.trim() : '';
                    const imageSrc = params.srcURL || '';
        
                    let emailSubject = pageTitle;
                    let emailBody = '';
        
                    if (selectedSnippet) {
                        emailSubject = `Snippet from: ${pageTitle}`;
                        emailBody = `${selectedSnippet}\n\nSource: ${currentUrl}`;
                        clipboard.writeText(selectedSnippet);
                    } else if (imageSrc) {
                        emailSubject = `Image from: ${pageTitle}`;
                        emailBody = `${imageSrc}\n\nPage: ${currentUrl}`;
                    } else {
                        emailSubject = pageTitle;
                        emailBody = currentUrl;
                    }
        
                    const encSubject = encodeURIComponent(emailSubject);
                    const encBody = encodeURIComponent(emailBody);
        
                    if (handler === 'system') {
                        const mailto = `mailto:?subject=${encSubject}&body=${encBody}`;
                        shell.openExternal(mailto).catch(() => {
                            openShareModal(`https://mail.google.com/mail/?view=cm&fs=1&su=${encSubject}&body=${encBody}`);
                        });
                    } else {
                        let composeUrl = handler;
                        if (composeUrl.includes('%s')) {
                            composeUrl = composeUrl.replace('%s', encSubject);
                        }
                        if (composeUrl.includes('%b')) {
                            composeUrl = composeUrl.replace('%b', encBody);
                        }
                        openShareModal(composeUrl);
                    }
                }
            }));
        
            shareSubmenu.append(new MenuItem({ type: 'separator' }));
            shareSubmenu.append(new MenuItem({
                label: 'Copy Markdown Link',
                click: () => {
                    const md = `[${targetText || targetUrl}](${targetUrl})`;
                    clipboard.writeText(md);
                }
            }));
        
            menu.append(new MenuItem({
                label: 'Share...',
                submenu: shareSubmenu
            }));
        
            menu.popup({ window: mainWindow });
        });

        webContents.setWindowOpenHandler((details) => {
            if (details.url && details.url !== 'about:blank') {
                if (security.isSafeTabUrl(details.url)) {
                    if (mainWindow && mainWindow.webContents) {
                        mainWindow.webContents.send('master-shortcut', 'spawn-tab-with-url', details.url);
                    }
                } else {
                    let scheme = 'unknown';
                    try {
                        scheme = new URL(details.url).protocol;
                    } catch (e) {
                        if (typeof details.url === 'string') {
                            scheme = details.url.split(':')[0] || 'unknown';
                        }
                    }
                    diagnostics.logEvent('warn', 'navigation', 'Blocked popup URL', { scheme });
                }
            }
            return { action: 'deny' };
        });

        webContents.on('before-input-event', (inputEvent, input) => {
            if (input.type !== 'keyDown') return;
            if (!mainWindow || !mainWindow.webContents) return;

            const action = keybinds.getActionForInput(input);
            if (action) {
                inputEvent.preventDefault();
                handleAppAction(action, webContents);
            }
        });

        webContents.on('render-process-gone', (event, details) => {
            diagnostics.logEvent('error', 'webview', `Webview render process terminated: reason=${details.reason} exitCode=${details.exitCode}`);
        });

        webContents.on('unresponsive', () => {
            diagnostics.logEvent('warn', 'performance', 'Webview became unresponsive');
        });

        webContents.on('responsive', () => {
            diagnostics.logEvent('info', 'performance', 'Webview regained responsiveness');
        });

        webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
            if (errorCode === -3) return;
            diagnostics.logEvent('warn', 'network', `Navigation failed: code=${errorCode} description=${errorDescription}`, { url: validatedURL });
        });
    }
});

app.on('render-process-gone', (event, wc, details) => {
    diagnostics.logEvent('error', 'process', `Render process gone: reason=${details.reason} exitCode=${details.exitCode}`);
});

app.on('child-process-gone', (event, details) => {
    diagnostics.logEvent('warn', 'process', `Child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
});

if (gotSingleInstanceLock) {
    app.on('second-instance', (event, commandLine) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();

            const incomingUrls = extractUrlsFromArgs(commandLine);
            incomingUrls.forEach(url => dispatchTabUrl(url));
        }
    });

    app.on('open-url', (event, url) => {
        event.preventDefault();
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
        if (security.isSafeTabUrl(url)) {
            dispatchTabUrl(url);
        }
    });

    app.on('before-quit', () => {
        markSentinelState(true);
        flushSessionToDisk();
        flushHistoryToDisk();
    });

    app.whenReady().then(() => {
        checkAndInitializeSentinel();
        diagnostics.initDiagnostics(loadBrowserConfig());
        if (isCrashRecoveryState()) {
            diagnostics.logEvent('warn', 'session', 'Detected previous unclean shutdown or crash, initialising recovery mode');
        }
        createWindow();
        initializeMemoryWatcher();
    });
}

