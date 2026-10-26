const path = require('path');
const fs = require('fs');
const { app, dialog } = require('electron');

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
    webrtc_policy: 'default_public_interface_only',
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
            webrtc_policy: parsed.webrtc_policy || 'default_public_interface_only',
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

function isValidHttpUrlTemplate(val) {
    if (typeof val !== 'string' || val.length > 2048) return false;
    try {
        const dummy = val.replace(/%s/g, 'query');
        const parsed = new URL(dummy);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

function validateThemeColors(tc) {
    if (!tc || typeof tc !== 'object' || Array.isArray(tc)) return false;
    const modes = Object.keys(tc);
    if (modes.length === 0) return false;
    const allowedModes = new Set(['dark', 'light']);
    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    const colorKeys = new Set(['accent', 'bg_main', 'bg_sidebar', 'text']);
    const opacityKeys = new Set(['sidebar_opacity', 'overlay_opacity']);

    for (const mode of modes) {
        if (!allowedModes.has(mode)) return false;
        const modeObj = tc[mode];
        if (!modeObj || typeof modeObj !== 'object' || Array.isArray(modeObj)) return false;
        const props = Object.keys(modeObj);
        for (const prop of props) {
            const val = modeObj[prop];
            if (colorKeys.has(prop)) {
                if (typeof val !== 'string' || !hexRegex.test(val)) return false;
            } else if (opacityKeys.has(prop)) {
                if (!Number.isInteger(val) || val < 0 || val > 100) return false;
            } else {
                return false;
            }
        }
    }
    return true;
}

function validateCustomSearchAliases(aliases) {
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) return false;
    const entries = Object.entries(aliases);
    if (entries.length > 100) return false;
    const aliasKeyRegex = /^[A-Za-z0-9_-]{1,16}$/;
    for (const [key, val] of entries) {
        if (!aliasKeyRegex.test(key)) return false;
        if (!isValidHttpUrlTemplate(val)) return false;
    }
    return true;
}

function validateConfigPatch(patch) {
    const clean = {};
    const rejected = [];

    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return { clean, rejected };
    }

    const defaultKeys = new Set(Object.keys(DEFAULT_CONFIG));

    for (const key of Object.keys(patch)) {
        if (!defaultKeys.has(key)) {
            rejected.push(key);
            continue;
        }

        const val = patch[key];

        if (key === 'external_notes_command') {
            rejected.push(key);
            continue;
        }

        switch (key) {
            case 'disable_gpu':
            case 'background_throttling':
            case 'sidebar_auto_collapse':
            case 'show_status_bar':
            case 'show_clock':
            case 'enable_diagnostics':
            case 'show_window_controls': {
                if (typeof val === 'boolean') {
                    clean[key] = val;
                } else {
                    rejected.push(key);
                }
                break;
            }

            case 'process_limit': {
                if (Number.isInteger(val) && val >= 1 && val <= 16) {
                    clean[key] = val;
                } else {
                    rejected.push(key);
                }
                break;
            }

            case 'tab_sleep_timeout_minutes': {
                if (Number.isInteger(val) && val >= 0 && val <= 1440) {
                    clean[key] = val;
                } else {
                    rejected.push(key);
                }
                break;
            }

            case 'theme':
            case 'webview_theme': {
                if (val === 'dark' || val === 'light') {
                    clean[key] = val;
                } else {
                    rejected.push(key);
                }
                break;
            }

            case 'webrtc_policy': {
                const validPolicies = new Set([
                    'default_public_interface_only',
                    'disable_non_proxied_udp',
                    'disabled',
                    'default'
                ]);
                if (typeof val === 'string' && validPolicies.has(val)) {
                    clean[key] = val;
                } else {
                    rejected.push(key);
                }
                break;
            }

            case 'clock_format': {
                if (val === 'datetime' || val === 'time' || val === 'seconds') {
                    clean[key] = val;
                } else {
                    rejected.push(key);
                }
                break;
            }

            case 'email_handler': {
                if (val === 'system' || isValidHttpUrlTemplate(val)) {
                    clean[key] = val;
                } else {
                    rejected.push(key);
                }
                break;
            }

            case 'spellchecker_language': {
                if (typeof val === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(val)) {
                    clean[key] = val;
                } else {
                    rejected.push(key);
                }
                break;
            }

            case 'last_seen_version': {
                if (val === null || (typeof val === 'string' && val.length <= 32)) {
                    clean[key] = val;
                } else {
                    rejected.push(key);
                }
                break;
            }

            case 'search_engine': {
                if (typeof val === 'string' && val.includes('%s') && isValidHttpUrlTemplate(val)) {
                    clean[key] = val;
                } else {
                    rejected.push(key);
                }
                break;
            }

            case 'trusted_domains': {
                if (Array.isArray(val) && val.length <= 200 && val.every(d => typeof d === 'string' && d.length <= 253)) {
                    clean[key] = [...val];
                } else {
                    rejected.push(key);
                }
                break;
            }

            case 'theme_colors': {
                if (validateThemeColors(val)) {
                    clean[key] = val;
                } else {
                    rejected.push(key);
                }
                break;
            }

            case 'custom_search_aliases': {
                if (validateCustomSearchAliases(val)) {
                    clean[key] = val;
                } else {
                    rejected.push(key);
                }
                break;
            }

            default:
                rejected.push(key);
                break;
        }
    }

    return { clean, rejected };
}

async function handleExternalNotesPrompt(patch, clean, dialogRef) {
    if (patch && typeof patch === 'object' && Object.prototype.hasOwnProperty.call(patch, 'external_notes_command')) {
        const rawCmd = patch.external_notes_command;
        if (typeof rawCmd === 'string' && rawCmd.trim().length > 0) {
            if (dialogRef && typeof dialogRef.showMessageBox === 'function') {
                const result = await dialogRef.showMessageBox({
                    type: 'warning',
                    buttons: ['Cancel', 'Allow'],
                    message: `Allow external application command: ${rawCmd}`
                });
                if (result && (result.response === 1 || result === 1)) {
                    clean.external_notes_command = rawCmd;
                }
            }
        } else if (rawCmd === '') {
            clean.external_notes_command = '';
        }
    }
}

function registerConfigIpc(ipcMain, hooks = {}) {
    ipcMain.handle('get-browser-settings', async () => {
        return loadBrowserConfig();
    });

    ipcMain.handle('save-browser-settings', async (event, newCfg) => {
        const { clean, rejected } = validateConfigPatch(newCfg);
        if (rejected.length > 0) {
            console.warn('Rejected configuration keys:', rejected);
        }
        await handleExternalNotesPrompt(newCfg, clean, hooks.dialog || dialog);
        saveBrowserConfig(clean);
        return true;
    });

    ipcMain.handle('update-browser-settings', async (event, newCfg) => {
        try {
            const before = loadBrowserConfig();
            const { clean, rejected } = validateConfigPatch(newCfg);
            if (rejected.length > 0) {
                console.warn('Rejected configuration keys:', rejected);
            }
            await handleExternalNotesPrompt(newCfg, clean, hooks.dialog || dialog);
            const res = updateBrowserConfig(clean);
            if (!res.success) return false;
            const merged = res.config;
            const payload = clean || {};
            if (Object.prototype.hasOwnProperty.call(payload, 'trusted_domains') &&
                JSON.stringify(before.trusted_domains) !== JSON.stringify(merged.trusted_domains) &&
                Array.isArray(merged.trusted_domains) &&
                typeof hooks.onTrustedDomainsChange === 'function') {
                hooks.onTrustedDomainsChange(merged.trusted_domains);
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'spellchecker_language') &&
                JSON.stringify(before.spellchecker_language) !== JSON.stringify(merged.spellchecker_language) &&
                merged.spellchecker_language !== undefined &&
                typeof hooks.onSpellcheckerChange === 'function') {
                hooks.onSpellcheckerChange(merged.spellchecker_language);
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'enable_diagnostics') &&
                JSON.stringify(before.enable_diagnostics) !== JSON.stringify(merged.enable_diagnostics) &&
                merged.enable_diagnostics !== undefined &&
                typeof hooks.onDiagnosticsChange === 'function') {
                hooks.onDiagnosticsChange(merged.enable_diagnostics);
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'webrtc_policy') &&
                JSON.stringify(before.webrtc_policy) !== JSON.stringify(merged.webrtc_policy) &&
                merged.webrtc_policy !== undefined &&
                typeof hooks.onWebRTCPolicyChange === 'function') {
                hooks.onWebRTCPolicyChange(merged.webrtc_policy);
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
    restartApp,
    validateConfigPatch
};
