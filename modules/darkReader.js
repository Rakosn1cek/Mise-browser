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
let darkReaderDisabledDomains = [];

export function isDarkReaderGloballyEnabled() {
    return darkReaderGlobalEnabled;
}

export function setDarkReaderGloballyEnabled(val) {
    darkReaderGlobalEnabled = !!val;
    if (state) state.darkReaderEnabled = darkReaderGlobalEnabled;
}

export function getDarkReaderDisabledDomains() {
    return [...darkReaderDisabledDomains];
}

export function setDarkReaderDisabledDomains(list) {
    if (Array.isArray(list)) {
        darkReaderDisabledDomains = list.map(d => String(d).trim().toLowerCase()).filter(Boolean);
    }
}

export function getDomainFromUrl(urlOrHostname) {
    if (!urlOrHostname) return '';
    try {
        if (urlOrHostname.includes('://')) {
            return new URL(urlOrHostname).hostname.toLowerCase();
        }
        return urlOrHostname.toLowerCase().trim();
    } catch (e) {
        return urlOrHostname.toLowerCase().trim();
    }
}

export function isDomainDisabledForDarkReader(urlOrHostname) {
    const host = getDomainFromUrl(urlOrHostname);
    if (!host) return false;
    return darkReaderDisabledDomains.some(d => {
        const clean = d.toLowerCase().trim();
        return clean && (host === clean || host.endsWith('.' + clean));
    });
}

export function updateDarkReaderButtonUI(enabled, currentUrl = null) {
    const btn = document.getElementById('dark-reader-btn');
    if (!btn) return;

    if (!currentUrl) {
        const activeView = getActiveWebview();
        if (activeView && typeof activeView.getURL === 'function') {
            currentUrl = activeView.getURL();
        }
    }

    const isSiteDisabled = currentUrl ? isDomainDisabledForDarkReader(currentUrl) : false;

    if (isSiteDisabled) {
        btn.classList.remove('active');
        btn.classList.add('domain-disabled');
        const host = getDomainFromUrl(currentUrl);
        btn.title = `Dark Reader disabled on ${host} (Right-click or Alt+Shift+E to re-enable)`;
    } else if (enabled) {
        btn.classList.remove('domain-disabled');
        btn.classList.add('active');
        btn.title = 'Toggle Dark Reader (Active: Alt+Shift+D | Right-click or Alt+Shift+E to exclude domain)';
    } else {
        btn.classList.remove('active', 'domain-disabled');
        btn.title = 'Toggle Dark Reader (Inactive: Alt+Shift+D)';
    }
}

export function syncDarkReaderSettingsUI() {
    const toggle = document.getElementById('setting-dark-reader-toggle');
    if (toggle) {
        toggle.checked = darkReaderGlobalEnabled;
    }

    const textarea = document.getElementById('setting-dark-reader-disabled-domains');
    if (textarea) {
        textarea.value = darkReaderDisabledDomains.join('\n');
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

    if (!force && isDomainDisabledForDarkReader(url)) {
        await removeDarkReaderFromWebview(webview);
        return;
    }

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

export async function toggleDarkReaderForCurrentDomain() {
    const activeView = getActiveWebview();
    if (!activeView || typeof activeView.getURL !== 'function') return null;
    const url = activeView.getURL();
    if (!url || url.startsWith('about:') || url.startsWith('devtools:')) return null;

    const host = getDomainFromUrl(url);
    if (!host) return null;

    const idx = darkReaderDisabledDomains.findIndex(d => {
        const clean = d.toLowerCase().trim();
        return host === clean || host.endsWith('.' + clean);
    });

    let isNowDisabled = false;
    if (idx >= 0) {
        darkReaderDisabledDomains.splice(idx, 1);
        isNowDisabled = false;
    } else {
        darkReaderDisabledDomains.push(host);
        isNowDisabled = true;
    }

    if (window.miseAPI && typeof window.miseAPI.updateBrowserSettings === 'function') {
        try {
            const cfg = (await window.miseAPI.getBrowserSettings()) || {};
            cfg.dark_reader_disabled_domains = [...darkReaderDisabledDomains];
            await window.miseAPI.updateBrowserSettings(cfg);
        } catch (e) {}
    }

    updateDarkReaderButtonUI(darkReaderGlobalEnabled, url);
    syncDarkReaderSettingsUI();

    if (isNowDisabled) {
        await removeDarkReaderFromWebview(activeView);
    } else {
        await applyDarkReaderToWebview(activeView);
    }

    return { host, isNowDisabled };
}

export async function saveDarkReaderDisabledDomains(domainsList) {
    setDarkReaderDisabledDomains(domainsList);

    if (window.miseAPI && typeof window.miseAPI.updateBrowserSettings === 'function') {
        try {
            const cfg = (await window.miseAPI.getBrowserSettings()) || {};
            cfg.dark_reader_disabled_domains = [...darkReaderDisabledDomains];
            await window.miseAPI.updateBrowserSettings(cfg);
        } catch (e) {}
    }

    syncDarkReaderSettingsUI();
    updateDarkReaderButtonUI(darkReaderGlobalEnabled);

    const activeView = getActiveWebview();
    if (activeView) {
        await applyDarkReaderToWebview(activeView);
    }
}

export async function initDarkReader() {
    if (window.miseAPI && typeof window.miseAPI.getBrowserSettings === 'function') {
        try {
            const cfg = await window.miseAPI.getBrowserSettings();
            if (cfg && cfg.dark_reader !== undefined) {
                setDarkReaderGloballyEnabled(cfg.dark_reader);
            }
            if (cfg && Array.isArray(cfg.dark_reader_disabled_domains)) {
                setDarkReaderDisabledDomains(cfg.dark_reader_disabled_domains);
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
        btn.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            await toggleDarkReaderForCurrentDomain();
        });
    }

    const toggle = document.getElementById('setting-dark-reader-toggle');
    if (toggle) {
        toggle.addEventListener('change', (e) => {
            toggleDarkReader(e.target.checked);
        });
    }

    const saveExcludedBtn = document.getElementById('setting-save-dark-reader-domains-btn');
    if (saveExcludedBtn) {
        saveExcludedBtn.addEventListener('click', async () => {
            const textarea = document.getElementById('setting-dark-reader-disabled-domains');
            const note = document.getElementById('setting-dark-reader-domains-note');
            if (!textarea) return;

            const domains = textarea.value
                .split(/[\n,]/)
                .map(d => d.trim().toLowerCase())
                .filter(Boolean);

            await saveDarkReaderDisabledDomains(domains);

            if (note) {
                note.textContent = 'Saved: excluded sites updated immediately.';
                note.classList.add('visible');
                setTimeout(() => note.classList.remove('visible'), 2500);
            }
        });
    }
}
