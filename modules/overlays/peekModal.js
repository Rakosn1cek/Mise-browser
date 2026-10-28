// modules/overlays/peekModal.js
// Ephemeral Tab Peek ("Glance") modal overlay manager

import { state } from '../state.js';
import { getWorkspacePartition, focusActiveWebview, isSafeTabUrl } from '../utils.js';
import { destroyGuestWebview } from '../webview.js';

let activeEscListener = null;
let currentPeekUrl = null;

export function isPeekModalActive() {
    const overlay = document.getElementById('PeekModalOverlay');
    return !!(overlay && overlay.style.display !== 'none');
}

export function openPeekModal(targetUrl) {
    const overlay = document.getElementById('PeekModalOverlay');
    const container = document.getElementById('PeekModalWebviewContainer');
    if (!overlay || !container || !targetUrl) return;

    if (!isSafeTabUrl(targetUrl)) return;
    currentPeekUrl = targetUrl;

    const existingWebview = container.querySelector('webview');
    if (existingWebview) {
        destroyGuestWebview(existingWebview);
    }
    container.innerHTML = '';

    const webview = document.createElement('webview');
    webview.setAttribute('src', targetUrl);
    webview.setAttribute('allowpopups', 'true');
    webview.style.width = '100%';
    webview.style.height = '100%';
    webview.style.display = 'flex';
    webview.style.flex = '1';

    if (state && state.globalPrivateModeActive) {
        webview.setAttribute('partition', 'MisePrivateProfile');
    } else {
        const currentWS = state?.sessionState?.current_workspace;
        webview.setAttribute('partition', getWorkspacePartition(currentWS));
    }

    if (window.miseAPI && typeof window.miseAPI.getWebviewPreloadPath === 'function') {
        const preloadPath = window.miseAPI.getWebviewPreloadPath();
        if (preloadPath) {
            webview.setAttribute('preload', preloadPath);
        }
    }

    const titleEl = document.getElementById('PeekModalTitle');
    const urlEl = document.getElementById('PeekModalUrl');
    if (titleEl) titleEl.textContent = 'Loading preview...';
    if (urlEl) {
        try {
            const parsed = new URL(targetUrl);
            urlEl.textContent = parsed.hostname;
            urlEl.title = targetUrl;
        } catch (_) {
            urlEl.textContent = targetUrl;
        }
    }

    webview.addEventListener('page-title-updated', (e) => {
        if (titleEl && e.title) {
            titleEl.textContent = e.title;
        }
    });

    webview.addEventListener('did-navigate', (e) => {
        if (e.url && isSafeTabUrl(e.url)) {
            currentPeekUrl = e.url;
            if (urlEl) {
                try {
                    const parsed = new URL(e.url);
                    urlEl.textContent = parsed.hostname;
                    urlEl.title = e.url;
                } catch (_) {
                    urlEl.textContent = e.url;
                }
            }
        }
    });

    webview.addEventListener('ipc-message', (e) => {
        if (e.channel === 'normal-mode-action' && e.args && e.args[0] === 'escape') {
            closePeekModal();
        }
    });

    container.appendChild(webview);
    overlay.style.display = 'flex';

    if (activeEscListener) {
        window.removeEventListener('keydown', activeEscListener);
        activeEscListener = null;
    }

    activeEscListener = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closePeekModal();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            promotePeekToTab();
        }
    };
    window.addEventListener('keydown', activeEscListener);

    const closeBtn = document.getElementById('ClosePeekModalBtn');
    if (closeBtn) {
        closeBtn.onclick = () => closePeekModal();
    }

    const promoteBtn = document.getElementById('PromotePeekTabBtn');
    if (promoteBtn) {
        promoteBtn.onclick = () => promotePeekToTab();
    }
}

export function closePeekModal() {
    const overlay = document.getElementById('PeekModalOverlay');
    const container = document.getElementById('PeekModalWebviewContainer');
    if (!overlay) return;

    overlay.style.display = 'none';

    if (container) {
        const modalWebview = container.querySelector('webview');
        if (modalWebview) {
            destroyGuestWebview(modalWebview);
        }
        container.innerHTML = '';
    }

    if (activeEscListener) {
        window.removeEventListener('keydown', activeEscListener);
        activeEscListener = null;
    }

    currentPeekUrl = null;
    focusActiveWebview();
}

export function promotePeekToTab() {
    const urlToPromote = currentPeekUrl;
    if (!urlToPromote || !isSafeTabUrl(urlToPromote)) {
        closePeekModal();
        return;
    }

    const currentWS = state?.sessionState?.current_workspace || 'Workspace 1';
    if (!state.sessionState.workspaces) {
        state.sessionState.workspaces = {};
    }
    if (!state.sessionState.workspaces[currentWS]) {
        state.sessionState.workspaces[currentWS] = [];
    }

    state.sessionState.workspaces[currentWS].push(urlToPromote);
    if (window.miseAPI && typeof window.miseAPI.saveSession === 'function') {
        window.miseAPI.saveSession(state.sessionState);
    }

    const newIdx = state.sessionState.workspaces[currentWS].length - 1;
    if (!state.tabPinned) state.tabPinned = {};
    if (!state.tabPinned[currentWS]) state.tabPinned[currentWS] = [];
    state.tabPinned[currentWS][newIdx] = false;

    closePeekModal();

    if (typeof window.renderWorkspaceUI === 'function') {
        window.renderWorkspaceUI(newIdx);
    }
}
