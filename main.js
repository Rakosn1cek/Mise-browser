const { app, BrowserWindow, ipcMain, session, Menu, MenuItem, nativeTheme, Notification, clipboard, shell, webContents, dialog, net } = require('electron');
const { installIpcGuard, GUEST_CHANNELS } = require('./main/ipcGuard');

installIpcGuard(ipcMain, {
    getMainWindow: () => mainWindow,
    guestChannels: GUEST_CHANNELS
});

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
const permissions = require('./main/permissions');
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
const dohResolver = require('./main/dohResolver');
const { applyDoHConfiguration } = dohResolver;
const contextMenus = require('./main/contextMenus');
const {
    buildSettingsSubmenu,
    openSettingsMenu,
    showWebviewContextMenu
} = contextMenus;
const systemIpc = require('./main/systemIpc');
const webContentsPolicy = require('./main/webContentsPolicy');

// Initialise keybinds configuration
keybinds.initializeKeybinds(CONFIG_DIR);

function initializeEngineSwitches() {
    const cfg = loadBrowserConfig();

    const webrtcPolicy = cfg.webrtc_policy || 'default_public_interface_only';
    const cliWebRTCPolicy = webrtcPolicy === 'disabled' ? 'disable_non_proxied_udp' : webrtcPolicy;
    app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', cliWebRTCPolicy);

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
contextMenus.setMainWindowGetter(() => mainWindow);

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
    if (String(workspaceName).trim().toLowerCase() === 'private') return 'MisePrivateProfile';
    const clean = String(workspaceName).trim().toLowerCase().replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return `persist:${clean || 'default'}`;
}

function getSessionForContext(context) {
    if (typeof context === 'string') {
        if (!security.isValidPartitionName(context)) {
            throw new Error('Invalid partition');
        }
        return session.fromPartition(context);
    }
    if (context && typeof context === 'object' && !Array.isArray(context)) {
        if (context.isPrivate) return session.fromPartition('MisePrivateProfile');
        if (context.partition !== undefined && context.partition !== null) {
            if (!security.isValidPartitionName(context.partition)) {
                throw new Error('Invalid partition');
            }
            return session.fromPartition(context.partition);
        }
        if (context.workspace !== undefined && context.workspace !== null) {
            const part = getWorkspacePartition(context.workspace);
            if (!security.isValidPartitionName(part)) {
                throw new Error('Invalid partition');
            }
            return session.fromPartition(part);
        }
    }
    if (context === true) return session.fromPartition('MisePrivateProfile');
    if (context === undefined || context === null) return session.defaultSession;
    throw new Error('Invalid partition');
}

const configuredSessions = new WeakSet();
const activeSessions = new Set();
function applySpellcheckerToAllSessions(lang) {
    for (const sess of activeSessions) {
        security.applySpellcheckerLanguage(sess, lang);
    }
}

function applyWebRTCPolicyToAllSessions(policy) {
    for (const sess of activeSessions) {
        security.applyWebRTCPolicy(sess, policy);
    }
}

function configureAndHardenSession(targetSession) {
    if (!targetSession) return;
    activeSessions.add(targetSession);
    if (configuredSessions.has(targetSession)) return;
    configuredSessions.add(targetSession);

    const cfg = loadBrowserConfig();
    security.hardenSession(
        targetSession,
        cfg.spellchecker_language || 'en-GB',
        cfg.webrtc_policy || 'default_public_interface_only'
    );
    permissions.configureSessionPermissions(targetSession, {
        getMainWindow: () => mainWindow,
        areNotificationsEnabled: () => globalNotificationsEnabled
    });
    downloads.configureDownloads(targetSession, {
        getMainWindow: () => mainWindow,
        sendNotification: sendSystemNotification,
        areNotificationsEnabled: () => globalNotificationsEnabled
    });
}

// Register permissions vault and interactive prompt broker IPC channels
permissions.registerPermissionsIpc(ipcMain, {
    getMainWindow: () => mainWindow,
    areNotificationsEnabled: () => globalNotificationsEnabled
});

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
    if (!url || typeof url !== 'string' || url.length > 2048) return false;
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
    try {
        const targetSession = getSessionForContext(context);
        flushSessionToDisk();
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
    try {
        const targetSession = getSessionForContext(context);
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
    try {
        if (!data || typeof data !== 'object') return false;
        const targetSession = getSessionForContext(data);
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
    if (!security.isValidPartitionName(name)) {
        return false;
    }
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
    onDiagnosticsChange: diagnostics.setDiagnosticsEnabled,
    onWebRTCPolicyChange: applyWebRTCPolicyToAllSessions,
    onDoHChange: (provider, customUrl) => applyDoHConfiguration(app, provider, customUrl)
});

ipcMain.on('renderer-ready', () => {
    isRendererReady = true;
    flushPendingUrls();
});

// Register system services, PDF, and code ingestion IPC channels
systemIpc.registerSystemIpc(ipcMain, {
    getMainWindow: () => mainWindow,
    sendNotification: sendSystemNotification,
    areNotificationsEnabled: () => globalNotificationsEnabled
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
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return false;
    }
    const allowedLevels = ['info', 'warn', 'error'];
    if (!allowedLevels.includes(data.level)) {
        return false;
    }
    if (typeof data.category !== 'string' || data.category.length > 200) {
        return false;
    }
    if (typeof data.message !== 'string' || data.message.length > 200) {
        return false;
    }
    diagnostics.logEvent(data.level, data.category, data.message, data.details);
    return true;
});





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

    // Guard main window from navigating away from application shell
    const appIndexPath = path.resolve(__dirname, 'index.html');
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
                const updateInfo = await updater.checkAppUpdates(false);
                if (updateInfo && updateInfo.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-available', updateInfo);
                }
            } catch (e) {}
        }, 6000);
    });

    ipcMain.on('is-trusted-domain', (event, hostname) => {
        event.returnValue = security.isTrustedDomain(hostname);
    });

    ipcMain.on('get-webrtc-policy', (event) => {
        const cfg = loadBrowserConfig();
        event.returnValue = cfg.webrtc_policy || 'default_public_interface_only';
    });

    ipcMain.on('get-google-signin-user-agent', (event, hostname) => {
        event.returnValue = security.getGoogleSignInUserAgent(hostname);
    });

    ipcMain.handle('clear-google-auth-cookies', async (event, partitionName) => {
        if (partitionName !== undefined && partitionName !== null) {
            if (!security.isValidPartitionName(partitionName)) {
                return false;
            }
        }
        const targetSession = partitionName ? session.fromPartition(partitionName) : session.fromPartition('MisePrivateProfile');
        await security.clearGoogleAuthCookies(targetSession);
        return true;
    });

    userContent.initializeUserContent(CONFIG_DIR, mainWindow);

    webContentsPolicy.attachWebviewSecurityGuards(mainWindow.webContents, {
        configureAndHardenSession
    });

    ipcMain.on('bubble-webview-key', (event, action) => {
        if (typeof action !== 'string' || action.length > 64) return;
        const metadata = keybinds.getActionMetadata();
        if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, action)) return;
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

webContentsPolicy.setupWebContentsPolicy(app, {
    getMainWindow: () => mainWindow,
    configureAndHardenSession,
    handleAppAction
});

if (gotSingleInstanceLock) {
    app.on('second-instance', (event, commandLine) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();

            const incomingUrls = extractUrlsFromArgs(commandLine);
            incomingUrls.forEach(url => {
                if (security.isSafeTabUrl(url)) {
                    dispatchTabUrl(url);
                }
            });
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
        const cfg = loadBrowserConfig();
        applyDoHConfiguration(app, cfg.doh_provider, cfg.doh_custom_url);
        diagnostics.initDiagnostics(cfg);
        if (isCrashRecoveryState()) {
            diagnostics.logEvent('warn', 'session', 'Detected previous unclean shutdown or crash, initialising recovery mode');
        }
        createWindow();
        systemIpc.initializeMemoryWatcher({ getMainWindow: () => mainWindow });
    });
}

