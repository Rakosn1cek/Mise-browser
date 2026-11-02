const { app, BrowserWindow, ipcMain, session, Menu, MenuItem, nativeTheme, Notification, clipboard, shell, webContents, dialog, net } = require('electron');
const { installIpcGuard, GUEST_CHANNELS } = require('./main/ipcGuard');
const windowManager = require('./main/windowManager');
const {
    createMainWindow,
    getMainWindow,
    dispatchTabUrl,
    extractUrlsFromArgs,
    handleAppAction,
    registerWindowIpc
} = windowManager;

installIpcGuard(ipcMain, {
    getMainWindow,
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

contextMenus.setMainWindowGetter(getMainWindow);

// Queue initial command line URLs received on cold start
extractUrlsFromArgs(process.argv).forEach(url => dispatchTabUrl(url));


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
        getMainWindow,
        areNotificationsEnabled: () => globalNotificationsEnabled
    });
    downloads.configureDownloads(targetSession, {
        getMainWindow,
        sendNotification: sendSystemNotification,
        areNotificationsEnabled: () => globalNotificationsEnabled
    });
}

// Register permissions vault and interactive prompt broker IPC channels
permissions.registerPermissionsIpc(ipcMain, {
    getMainWindow,
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
    const win = getMainWindow();
    if (!win) return;
    win.webContents.send('master-shortcut', 'toggle-devtools');
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

// Register window lifecycle and management IPC channels
registerWindowIpc(ipcMain);

// Register system services, PDF, and code ingestion IPC channels
systemIpc.registerSystemIpc(ipcMain, {
    getMainWindow,
    sendNotification: sendSystemNotification,
    areNotificationsEnabled: () => globalNotificationsEnabled
});

// Register session persistence and crash recovery IPC channels
sessionStore.registerSessionIpc(ipcMain);

// Register storage and local data IPC channels
storage.registerStorageIpc(ipcMain);

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





// Register session security and Google auth IPC channels
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

ipcMain.on('bubble-webview-key', (event, action) => {
    if (typeof action !== 'string' || action.length > 64) return;
    const metadata = keybinds.getActionMetadata();
    if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, action)) return;
    const win = getMainWindow();
    if (win && win.webContents) {
        win.webContents.send('master-shortcut', action);
    }
});

webContentsPolicy.setupWebContentsPolicy(app, {
    getMainWindow,
    configureAndHardenSession,
    handleAppAction
});

if (gotSingleInstanceLock) {
    app.on('second-instance', (event, commandLine) => {
        const win = getMainWindow();
        if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();

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
        const win = getMainWindow();
        if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
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
        createMainWindow({
            CONFIG_DIR,
            onClose: () => {
                markSentinelState(true);
                flushSessionToDisk();
                flushHistoryToDisk();
            },
            configureAndHardenSession,
            getWorkspacePartition,
            readCurrentSession,
            attachWebviewSecurityGuards: (wc) => {
                webContentsPolicy.attachWebviewSecurityGuards(wc, {
                    configureAndHardenSession
                });
            }
        });
        systemIpc.initializeMemoryWatcher({ getMainWindow });
    });
}

