import { getActiveWebview } from '../utils.js';
import { applyThemeVisuals, syncVisualSettingsInputs } from '../theme.js';

export let currentWebviewTheme = 'dark';
let webviewThemeSaveTimer = null;

export function updateWebviewThemeButtonUI(theme) {
    const button = document.getElementById('theme-toggle-btn');
    if (!button) return;
    if (theme === 'light') {
        button.innerHTML = '<i class="fa-solid fa-sun"></i>';
        button.title = 'Toggle Website Dark/Light Theme (Website Light active)';
    } else {
        button.innerHTML = '<i class="fa-solid fa-moon"></i>';
        button.title = 'Toggle Website Dark/Light Theme (Website Dark active)';
    }
}

export function toggleWebviewTheme() {
    currentWebviewTheme = (currentWebviewTheme === 'light') ? 'dark' : 'light';
    updateWebviewThemeButtonUI(currentWebviewTheme);

    const container = document.getElementById('webview-container');
    if (container) {
        container.classList.remove('theme-light', 'theme-dark');
        container.classList.add(currentWebviewTheme === 'light' ? 'theme-light' : 'theme-dark');
    }

    const activeView = getActiveWebview();
    if (activeView) {
        activeView.style.opacity = '0.75';
        setTimeout(() => {
            activeView.style.opacity = '1';
        }, 140);
    }

    if (window.miseAPI && typeof window.miseAPI.setNativeTheme === 'function') {
        window.miseAPI.setNativeTheme(currentWebviewTheme);
    }

    if (webviewThemeSaveTimer) clearTimeout(webviewThemeSaveTimer);
    webviewThemeSaveTimer = setTimeout(() => {
        if (window.miseAPI && typeof window.miseAPI.updateBrowserSettings === 'function') {
            window.miseAPI.updateBrowserSettings({ webview_theme: currentWebviewTheme }).catch(() => {});
        }
    }, 400);
}

export function toggleInterfaceTheme() {
    const body = document.body;
    const isDark = body.classList.contains('dark-mode');
    const newTheme = isDark ? 'light' : 'dark';

    if (newTheme === 'light') {
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
    } else {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
    }

    applyThemeVisuals(null, newTheme);
    syncVisualSettingsInputs(null);

    const themeToggle = document.getElementById('setting-theme-toggle');
    if (themeToggle) {
        themeToggle.checked = (newTheme === 'dark');
    }

    if (window.miseAPI && typeof window.miseAPI.updateBrowserSettings === 'function') {
        window.miseAPI.updateBrowserSettings({ theme: newTheme }).catch(() => {});
    }
}

export function initThemeState(initialCfg, savedTheme = 'dark') {
    const body = document.body;

    if (savedTheme === 'light') {
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
    } else {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
    }

    applyThemeVisuals(initialCfg, savedTheme);

    currentWebviewTheme = initialCfg?.webview_theme || 'dark';
    updateWebviewThemeButtonUI(currentWebviewTheme);

    const container = document.getElementById('webview-container');
    if (container) {
        container.classList.remove('theme-light', 'theme-dark');
        container.classList.add(currentWebviewTheme === 'light' ? 'theme-light' : 'theme-dark');
    }

    if (window.miseAPI && typeof window.miseAPI.setNativeTheme === 'function') {
        window.miseAPI.setNativeTheme(currentWebviewTheme);
    }
}
