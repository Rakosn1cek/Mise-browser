import { state } from '../state.js';

export function openTransientShareModal(targetUrl) {
    const overlay = document.getElementById('ShareModalOverlay');
    const container = document.getElementById('ShareModalWebviewContainer');
    if (!overlay || !container || !targetUrl) return;

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
    }

    if (window.miseAPI && typeof window.miseAPI.getWebviewPreloadPath === 'function') {
        const preloadPath = window.miseAPI.getWebviewPreloadPath();
        if (preloadPath) {
            webview.setAttribute('preload', preloadPath);
        }
    }

    container.appendChild(webview);
    overlay.style.display = 'flex';

    const closeModal = () => {
        overlay.style.display = 'none';
        container.innerHTML = '';
        window.removeEventListener('keydown', handleEsc);
    };

    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
        }
    };

    const closeBtn = document.getElementById('CloseShareModalBtn');
    if (closeBtn) {
        closeBtn.onclick = closeModal;
    }

    window.addEventListener('keydown', handleEsc);
}
