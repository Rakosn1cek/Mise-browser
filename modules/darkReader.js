// modules/darkReader.js
// Native GPU-accelerated Dark Reader engine for Mise Browser
// Automatically applies high-contrast dark themes to light websites whilst preserving media

import { state } from './state.js';
import { getActiveWebview } from './utils.js';

export const DARK_READER_CSS = `
html {
    min-height: 100vh !important;
    background-color: #ffffff !important;
    filter: invert(90%) hue-rotate(180deg) contrast(88%) !important;
}

body {
    min-height: 100vh !important;
}

/* Re-invert media elements so photos, videos, canvases and charts preserve natural colours */
img, video, canvas, svg:not(:root), picture, embed, object, iframe {
    filter: invert(100%) hue-rotate(180deg) !important;
}

/* Re-invert background image icons and leaf elements without inverting textual content */
[style*="background-image"]:empty {
    filter: invert(100%) hue-rotate(180deg) !important;
}

/* Avoid bright halo around transparent PNG images */
img {
    background-color: transparent !important;
}

/* Ensure fullscreen video players (YouTube, Vimeo, etc.) are never inverted */
:fullscreen, :fullscreen * {
    filter: none !important;
}

/* Dark mode scrollbars */
::-webkit-scrollbar {
    background-color: #16161e !important;
    width: 10px !important;
    height: 10px !important;
}
::-webkit-scrollbar-thumb {
    background-color: #3b4261 !important;
    border-radius: 4px !important;
}
::-webkit-scrollbar-thumb:hover {
    background-color: #7aa2f7 !important;
}
`;

export const CHECK_PAGE_LUMINANCE_SCRIPT = `
(function() {
    try {
        const getBg = (el) => {
            if (!el) return null;
            const bg = window.getComputedStyle(el).backgroundColor;
            if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return null;
            return bg;
        };

        let bg = getBg(document.documentElement);
        if (!bg) bg = getBg(document.body);
        if (!bg && document.body && document.body.firstElementChild) {
            bg = getBg(document.body.firstElementChild);
        }

        if (!bg) {
            return { isAlreadyDark: false, bg: null };
        }

        const m = bg.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
        if (m) {
            const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1;
            if (alpha < 0.1) return { isAlreadyDark: false, bg };
            const r = parseInt(m[1], 10);
            const g = parseInt(m[2], 10);
            const b = parseInt(m[3], 10);
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            return { isAlreadyDark: brightness < 115, brightness, bg };
        }
        return { isAlreadyDark: false, bg };
    } catch (e) {
        return { isAlreadyDark: false, error: e.message };
    }
})();
`;

let darkReaderGlobalEnabled = false;

export function isDarkReaderGloballyEnabled() {
    return darkReaderGlobalEnabled;
}

export function setDarkReaderGloballyEnabled(val) {
    darkReaderGlobalEnabled = !!val;
    if (state) state.darkReaderEnabled = darkReaderGlobalEnabled;
}

export function updateDarkReaderButtonUI(enabled) {
    const btn = document.getElementById('dark-reader-btn');
    if (!btn) return;
    if (enabled) {
        btn.classList.add('active');
        btn.title = 'Toggle Dark Reader (Active - Alt+Shift+D)';
    } else {
        btn.classList.remove('active');
        btn.title = 'Toggle Dark Reader (Inactive - Alt+Shift+D)';
    }
}

export function syncDarkReaderSettingsUI() {
    const toggle = document.getElementById('setting-dark-reader-toggle');
    if (toggle) {
        toggle.checked = darkReaderGlobalEnabled;
    }
}

export async function removeDarkReaderFromWebview(webview) {
    if (!webview) return;
    if (webview.__miseDarkReaderKey && typeof webview.removeInsertedCSS === 'function') {
        try {
            await webview.removeInsertedCSS(webview.__miseDarkReaderKey);
        } catch (e) {}
    }
    webview.__miseDarkReaderKey = null;
    webview.__miseDarkReaderActive = false;
}

export async function applyDarkReaderToWebview(webview, force = false) {
    if (!webview || typeof webview.getURL !== 'function' || typeof webview.insertCSS !== 'function') return;
    const url = webview.getURL();
    if (!url || url.startsWith('about:') || url.startsWith('devtools:')) return;

    const enabled = force || darkReaderGlobalEnabled;
    if (!enabled) {
        await removeDarkReaderFromWebview(webview);
        return;
    }

    if (!force) {
        try {
            const check = await webview.executeJavaScript(CHECK_PAGE_LUMINANCE_SCRIPT, false);
            if (check && check.isAlreadyDark) {
                await removeDarkReaderFromWebview(webview);
                return;
            }
        } catch (e) {}
    }

    if (webview.__miseDarkReaderKey) return;

    try {
        const key = await webview.insertCSS(DARK_READER_CSS);
        if (key) {
            webview.__miseDarkReaderKey = key;
            webview.__miseDarkReaderActive = true;
        }
    } catch (e) {
        console.error('[DarkReader] Failed to insert CSS:', e);
    }
}

export async function toggleDarkReader(forceValue = null) {
    const newEnabled = forceValue !== null ? !!forceValue : !darkReaderGlobalEnabled;
    setDarkReaderGloballyEnabled(newEnabled);
    updateDarkReaderButtonUI(newEnabled);
    syncDarkReaderSettingsUI();

    if (window.miseAPI && typeof window.miseAPI.updateBrowserSettings === 'function') {
        try {
            const cfg = (await window.miseAPI.getBrowserSettings()) || {};
            cfg.dark_reader = newEnabled;
            await window.miseAPI.updateBrowserSettings(cfg);
        } catch (e) {}
    }

    const currentWS = state.sessionState.current_workspace;
    const views = state.activeViewsCache[currentWS] || [];
    for (const wv of views) {
        if (wv) {
            if (newEnabled) {
                await applyDarkReaderToWebview(wv);
            } else {
                await removeDarkReaderFromWebview(wv);
            }
        }
    }

    const splitContainer = document.getElementById('SplitWebviewContainer');
    const splitWv = splitContainer ? splitContainer.querySelector('webview') : null;
    if (splitWv) {
        if (newEnabled) {
            await applyDarkReaderToWebview(splitWv);
        } else {
            await removeDarkReaderFromWebview(splitWv);
        }
    }
}

export async function initDarkReader() {
    if (window.miseAPI && typeof window.miseAPI.getBrowserSettings === 'function') {
        try {
            const cfg = await window.miseAPI.getBrowserSettings();
            if (cfg && cfg.dark_reader !== undefined) {
                setDarkReaderGloballyEnabled(cfg.dark_reader);
            }
        } catch (e) {}
    }

    updateDarkReaderButtonUI(darkReaderGlobalEnabled);
    syncDarkReaderSettingsUI();

    const btn = document.getElementById('dark-reader-btn');
    if (btn) {
        btn.addEventListener('click', () => {
            toggleDarkReader();
        });
    }

    const toggle = document.getElementById('setting-dark-reader-toggle');
    if (toggle) {
        toggle.addEventListener('change', (e) => {
            toggleDarkReader(e.target.checked);
        });
    }
}
