// modules/webview/tabLifecycle.js
// Guest webview lifecycle extensions: content injection, reader view distillation, and shield controls

import { state } from '../state.js';
import { getActiveWebview } from '../utils.js';
import { setTargetUrl, updateReaderViewButtonUI } from '../statusBar.js';
import { exportArticleToNotes, exportArticleToExternalApp, openNotesInExternalApp } from '../overlays/notes.js';
import { buildUserScriptWrapper } from '../userScriptShim.js';
import { destroyGuestWebview, handleWebviewCrash, createWebView } from '../webview.js';

export { destroyGuestWebview, handleWebviewCrash, createWebView };

export const READER_EXTRACT_SCRIPT = `(function() {
    var overlay = document.getElementById('mise-reader-overlay');
    if (overlay && overlay.shadowRoot) {
        var title = overlay.shadowRoot.querySelector('.article-title')?.textContent || document.title;
        var byline = overlay.shadowRoot.querySelector('.article-byline')?.textContent || '';
        var body = overlay.shadowRoot.querySelector('.article-body')?.innerText || '';
        var pill = overlay.shadowRoot.querySelector('.article-domain-pill')?.textContent || window.location.hostname;
        return {
            isReader: true,
            title: title,
            byline: byline,
            url: window.location.href,
            siteName: pill,
            textContent: body
        };
    }
    var selected = window.getSelection() ? window.getSelection().toString() : '';
    return {
        isReader: false,
        title: document.title,
        url: window.location.href,
        siteName: window.location.hostname,
        textContent: selected || ''
    };
})()`;

export async function toggleReaderViewOnActiveTab() {
    const activeWv = getActiveWebview();
    if (!activeWv || typeof activeWv.executeJavaScript !== 'function') return;
    try {
        const readerCode = await window.miseAPI.readReaderCode();
        if (!readerCode) return;
        const res = await activeWv.executeJavaScript(readerCode, false);
        if (res) {
            activeWv.__miseReaderActive = !!res.active;
            updateReaderViewButtonUI(!!res.active);
            if (res.error) {
                setTargetUrl(`Reader View: ${res.error}`, 3000);
            } else if (res.active) {
                const titleStr = res.title ? `: ${res.title.slice(0, 45)}...` : '';
                setTargetUrl(`Reader View Active (F9 or Esc to exit)${titleStr}`, 3500);
            } else {
                setTargetUrl('Reader View Closed', 2000);
            }
        }
    } catch (err) {
        console.error('Failed to execute reader view:', err);
    }
}

export async function handleReaderExportRequest(webview, exportType) {
    if (!webview || !webview.__miseReaderActive) return;
    if (exportType !== 'notes' && exportType !== 'external') return;

    const now = Date.now();
    if (webview.__lastReaderExportTime && (now - webview.__lastReaderExportTime < 2000)) {
        return;
    }
    webview.__lastReaderExportTime = now;

    if (typeof webview.executeJavaScript !== 'function') return;
    try {
        const articleData = await webview.executeJavaScript(READER_EXTRACT_SCRIPT, false);
        if (!articleData) return;
        if (typeof articleData.title !== 'string' || typeof articleData.textContent !== 'string') {
            return;
        }
        articleData.title = articleData.title.slice(0, 300);
        articleData.textContent = articleData.textContent.slice(0, 200000);

        if (exportType === 'notes') {
            await exportArticleToNotes(articleData);
        } else if (exportType === 'external') {
            await exportArticleToExternalApp(articleData);
        }
    } catch (err) {
        console.error('Failed to export reader article:', err);
    }
}

export async function exportActiveTabToNotes() {
    const activeWv = getActiveWebview();
    if (!activeWv || typeof activeWv.executeJavaScript !== 'function') return;
    try {
        const articleData = await activeWv.executeJavaScript(READER_EXTRACT_SCRIPT, false);
        if (articleData) {
            await exportArticleToNotes(articleData);
        }
    } catch (err) {
        console.error('Failed to export tab to notes:', err);
    }
}

export async function exportActiveTabToExternal() {
    const activeWv = getActiveWebview();
    if (!activeWv || typeof activeWv.executeJavaScript !== 'function') return;
    try {
        const articleData = await activeWv.executeJavaScript(READER_EXTRACT_SCRIPT, false);
        if (articleData) {
            await exportArticleToExternalApp(articleData);
        }
    } catch (err) {
        console.error('Failed to export tab to external app:', err);
    }
}

export function extractHostname(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return '';
    }
}

export function updateTabShieldStatus(tabLi, url, trustedDomains = []) {
    const shieldBtn = tabLi.querySelector('.tab-shield-btn');
    if (!shieldBtn) return;

    const host = extractHostname(url);
    if (!host || url.startsWith('about:') || url.startsWith('file:')) {
        shieldBtn.style.display = 'none';
        return;
    }

    shieldBtn.style.display = 'inline-flex';
    const isTrusted = trustedDomains.some(d => host === d || host.endsWith('.' + d));
    const icon = shieldBtn.querySelector('i');

    if (isTrusted) {
        icon.className = 'fa-solid fa-shield shield-off';
        shieldBtn.title = 'Shields Down (Site is in Trusted Sites)';
    } else {
        icon.className = 'fa-solid fa-shield-halved shield-on';
        shieldBtn.title = 'Shields Active (Full Protection)';
    }
}

export async function injectMatchingUserContent(webview) {
    if (!webview || typeof webview.getURL !== 'function') return;
    const currentUrl = webview.getURL();
    if (!currentUrl || currentUrl.startsWith('about:') || currentUrl.startsWith('devtools:')) return;
    if (!window.miseAPI || typeof window.miseAPI.getUserContentForUrl !== 'function') return;

    const navEpoch = webview.__miseNavigationEpoch || 0;

    try {
        const content = await window.miseAPI.getUserContentForUrl(currentUrl);
        if (!content) return;

        // Abort if page navigated or started loading a new destination while awaiting IPC lookup
        if (webview.__miseNavigationEpoch !== navEpoch) return;
        if (typeof webview.getURL === 'function' && webview.getURL() !== currentUrl) return;

        if (!webview.__miseInjectedCSSKeys) webview.__miseInjectedCSSKeys = [];
        if (typeof webview.removeInsertedCSS === 'function' && webview.__miseInjectedCSSKeys.length > 0) {
            for (const key of webview.__miseInjectedCSSKeys) {
                try { await webview.removeInsertedCSS(key); } catch (e) {}
            }
            webview.__miseInjectedCSSKeys = [];
        }

        if (Array.isArray(content.styles)) {
            for (const item of content.styles) {
                if (item.css && typeof webview.insertCSS === 'function') {
                    try {
                        const key = await webview.insertCSS(item.css);
                        if (key) webview.__miseInjectedCSSKeys.push(key);
                    } catch (e) {}
                }
            }
        }

        if (!webview.__miseInjectedScriptIds) {
            webview.__miseInjectedScriptIds = new Set();
        }

        if (Array.isArray(content.scripts)) {
            for (const item of content.scripts) {
                const scriptId = item.scriptId || item.filename || item.name;
                if (webview.__miseInjectedScriptIds.has(scriptId)) {
                    continue;
                }
                if (item.code && typeof webview.executeJavaScript === 'function') {
                    webview.__miseInjectedScriptIds.add(scriptId);
                    const scriptWrapper = buildUserScriptWrapper(item, state.appVersion);
                    webview.executeJavaScript(scriptWrapper, false).catch(() => {});
                }
            }
        }
    } catch (err) {}
}

export async function reapplyActiveUserStyles() {
    const currentWS = state.sessionState.current_workspace;
    const views = state.activeViewsCache[currentWS] || [];
    for (const wv of views) {
        if (!wv || typeof wv.getURL !== 'function' || typeof wv.insertCSS !== 'function') continue;
        const currentUrl = wv.getURL();
        if (!currentUrl || currentUrl.startsWith('about:') || currentUrl.startsWith('devtools:')) continue;
        const fetchStyles = (window.miseAPI && typeof window.miseAPI.getUserStylesForUrl === 'function')
            ? window.miseAPI.getUserStylesForUrl
            : (window.miseAPI && typeof window.miseAPI.getUserContentForUrl === 'function' ? window.miseAPI.getUserContentForUrl : null);
        if (!fetchStyles) continue;

        try {
            const content = await fetchStyles(currentUrl);
            if (!content) continue;

            if (!wv.__miseInjectedCSSKeys) wv.__miseInjectedCSSKeys = [];
            if (typeof wv.removeInsertedCSS === 'function' && wv.__miseInjectedCSSKeys.length > 0) {
                for (const key of wv.__miseInjectedCSSKeys) {
                    try { await wv.removeInsertedCSS(key); } catch (e) {}
                }
                wv.__miseInjectedCSSKeys = [];
            }

            if (Array.isArray(content.styles)) {
                for (const item of content.styles) {
                    if (item.css) {
                        try {
                            const key = await wv.insertCSS(item.css);
                            if (key) wv.__miseInjectedCSSKeys.push(key);
                        } catch (e) {}
                    }
                }
            }
        } catch (err) {}
    }
}

export function attachShieldToggleListener(tabLi, webview) {
    const shieldBtn = tabLi.querySelector('.tab-shield-btn');
    if (!shieldBtn) return;

    shieldBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const currentUrl = webview.getURL();
        const host = extractHostname(currentUrl);
        if (!host) return;

        const cfg = (await window.miseAPI.getBrowserSettings()) || {};
        let domains = Array.isArray(cfg.trusted_domains) ? [...cfg.trusted_domains] : [];

        const isTrusted = domains.some(d => host === d || host.endsWith('.' + d));

        if (isTrusted) {
            domains = domains.filter(d => d !== host && !host.endsWith('.' + d));
        } else {
            domains.push(host);
        }

        if (window.miseAPI && typeof window.miseAPI.updateBrowserSettings === 'function') {
            await window.miseAPI.updateBrowserSettings({ trusted_domains: domains });
            updateTabShieldStatus(tabLi, currentUrl, domains);
            if (typeof webview.reload === 'function') {
                webview.reload();
            }
        }
    });
}
