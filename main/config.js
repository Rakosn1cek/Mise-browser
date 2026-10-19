const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const DEFAULT_THEME_COLORS = {
    dark: {
        accent: '#7aa2f7',
        bg_main: '#1a1b26',
        bg_sidebar: '#16161e',
        text: '#c0caf5',
        sidebar_opacity: 100,
        overlay_opacity: 100
    },
    light: {
        accent: '#6d3b09',
        bg_main: '#e5e5e5',
        bg_sidebar: '#d4d4d4',
        text: '#1a1a1a',
        sidebar_opacity: 100,
        overlay_opacity: 100
    }
};

const DEFAULT_CONFIG = {
    disable_gpu: false,
    background_throttling: true,
    process_limit: 4,
    email_handler: 'system',
    search_engine: 'https://duckduckgo.com/?q=%s',
    spellchecker_language: 'en-GB',
    theme: 'dark',
    webview_theme: 'dark',
    trusted_domains: ['accounts.google.com'],
    tab_sleep_timeout_minutes: 15,
    sidebar_auto_collapse: true,
    show_status_bar: true,
    show_clock: true,
    clock_format: 'datetime',
    theme_colors: { ...DEFAULT_THEME_COLORS },
    enable_diagnostics: false,
    show_window_controls: false,
    external_notes_command: '',
    custom_search_aliases: {},
    last_seen_version: null
};

function resolveConfigDir() {
    try {
        if (app && typeof app.getPath === 'function') {
            return path.join(app.getPath('home'), '.config', 'mise-browser');
        }
    } catch (e) {}
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, '.config', 'mise-browser');
}

const CONFIG_DIR = resolveConfigDir();
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

// Writes to a temporary file and renames it over config.json. A plain write truncates
// the file first, so a concurrent loadBrowserConfig could read it empty, fall back to
// DEFAULT_CONFIG and have the next save persist those defaults over the user's settings.
// Synchronous on purpose: saves never interleave, so no update can be lost either.
function writeConfigFile(cfg, targetPath = CONFIG_PATH) {
    const tmpPath = `${targetPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(cfg, null, 4), 'utf-8');
    fs.renameSync(tmpPath, targetPath);
}

function loadBrowserConfig(targetDir = CONFIG_DIR, targetPath = CONFIG_PATH) {
    try {
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        if (!fs.existsSync(targetPath)) {
            writeConfigFile(DEFAULT_CONFIG, targetPath);
            return { ...DEFAULT_CONFIG };
        }
        const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
        return {
            ...DEFAULT_CONFIG,
            ...parsed,
            spellchecker_language: parsed.spellchecker_language || 'en-GB',
            webview_theme: parsed.webview_theme || 'dark',
            theme_colors: {
                dark: { ...DEFAULT_THEME_COLORS.dark, ...(parsed.theme_colors?.dark || {}) },
                light: { ...DEFAULT_THEME_COLORS.light, ...(parsed.theme_colors?.light || {}) }
            }
        };
    } catch (e) {
        try {
            if (fs.existsSync(targetPath)) {
                const { backupCorruptFile } = require('./atomicFile');
                backupCorruptFile(targetPath);
            }
        } catch (_) {}
        return { ...DEFAULT_CONFIG };
    }
}

function restartApp(appRef = app) {
    if (appRef && typeof appRef.relaunch === 'function' && typeof appRef.quit === 'function') {
        appRef.relaunch();
        appRef.quit();
        return true;
    }
    return false;
}

function saveBrowserConfig(cfg, targetDir = CONFIG_DIR, targetPath = CONFIG_PATH) {
    try {
        const merged = { ...loadBrowserConfig(targetDir, targetPath), ...cfg };
        writeConfigFile(merged, targetPath);
        restartApp();
        return true;
    } catch (e) {
        return false;
    }
}

function updateBrowserConfig(newCfg, targetDir = CONFIG_DIR, targetPath = CONFIG_PATH) {
    try {
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        const existing = loadBrowserConfig(targetDir, targetPath);
        const merged = { ...existing, ...newCfg };
        writeConfigFile(merged, targetPath);
        return { success: true, config: merged };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function registerConfigIpc(ipcMain, hooks = {}) {
    ipcMain.handle('get-browser-settings', async () => {
        return loadBrowserConfig();
    });

    ipcMain.handle('save-browser-settings', async (event, newCfg) => {
        saveBrowserConfig(newCfg);
        return true;
    });

    ipcMain.handle('update-browser-settings', async (event, newCfg) => {
        try {
            const res = updateBrowserConfig(newCfg);
            if (!res.success) return false;
            const merged = res.config;
            if (Array.isArray(merged.trusted_domains) && typeof hooks.onTrustedDomainsChange === 'function') {
                hooks.onTrustedDomainsChange(merged.trusted_domains);
            }
            if (merged.spellchecker_language !== undefined && typeof hooks.onSpellcheckerChange === 'function') {
                hooks.onSpellcheckerChange(merged.spellchecker_language);
            }
            if (merged.enable_diagnostics !== undefined && typeof hooks.onDiagnosticsChange === 'function') {
                hooks.onDiagnosticsChange(merged.enable_diagnostics);
            }
            return true;
        } catch (e) {
            return false;
        }
    });
}

module.exports = {
    DEFAULT_THEME_COLORS,
    DEFAULT_CONFIG,
    CONFIG_DIR,
    CONFIG_PATH,
    resolveConfigDir,
    writeConfigFile,
    loadBrowserConfig,
    saveBrowserConfig,
    updateBrowserConfig,
    registerConfigIpc,
    restartApp
};
