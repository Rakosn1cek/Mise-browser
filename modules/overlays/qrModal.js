// modules/overlays/qrModal.js
// Zero-Cloud Send to Mobile QR code modal controller

import { state } from '../state.js';
import { focusActiveWebview, showNotificationToast, extractOriginalUrl } from '../utils.js';
import { setTargetUrl, updateQrBadgeActiveState } from '../statusBar.js';
import { mountOverlaySync, ensureOverlayMounted } from '../templateLoader.js';
import { generateQrSvg, sanitiseQrUrl } from '../qrCode.js';

let activeKeyListener = null;
let copyFeedbackTimer = null;
let currentShareUrl = '';

/**
 * Checks whether the Send to Mobile QR modal is currently visible.
 * @returns {boolean} True when #QrModalOverlay is displayed
 */
export function isQrModalActive() {
    if (typeof document === 'undefined') return false;
    const overlay = document.getElementById('QrModalOverlay');
    return !!(overlay && overlay.style.display !== 'none');
}

/**
 * Resolves the active tab's URL and title from live webview or session cache.
 * @returns {{ url: string, title: string }}
 */
export function resolveActiveTabShareInfo() {
    const currentWS = state?.sessionState?.current_workspace || 'Workspace 1';
    let currentIdx = 0;

    if (typeof document !== 'undefined') {
        const activeListItem = document.querySelector('#TabList li.selected');
        if (activeListItem) {
            currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
            if (currentIdx < 0) currentIdx = 0;
        }
    }

    const activeWv = state?.activeViewsCache?.[currentWS]?.[currentIdx];
    let rawUrl = '';
    if (activeWv && typeof activeWv.getURL === 'function') {
        try {
            rawUrl = activeWv.getURL() || '';
        } catch (_) {}
    }
    if (!rawUrl) {
        rawUrl = state?.sessionState?.workspaces?.[currentWS]?.[currentIdx] || '';
    }

    const resolvedUrl = typeof extractOriginalUrl === 'function' ? extractOriginalUrl(rawUrl) : rawUrl;

    let resolvedTitle = '';
    if (activeWv && typeof activeWv.getTitle === 'function') {
        try {
            const liveTitle = activeWv.getTitle();
            if (liveTitle && liveTitle !== 'about:blank') {
                resolvedTitle = liveTitle;
            }
        } catch (_) {}
    }
    if (!resolvedTitle) {
        resolvedTitle = state?.activeTitlesCache?.[currentWS]?.[currentIdx] || '';
    }

    return {
        url: resolvedUrl || '',
        title: resolvedTitle || ''
    };
}

function copyActiveQrUrl() {
    if (!currentShareUrl) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        Promise.resolve(navigator.clipboard.writeText(currentShareUrl)).catch(() => {});
    }

    const copyBtnText = document.getElementById('QrModalCopyBtnText');
    if (copyBtnText) {
        copyBtnText.textContent = 'Copied!';
        if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
        copyFeedbackTimer = setTimeout(() => {
            const textEl = document.getElementById('QrModalCopyBtnText');
            if (textEl) textEl.textContent = 'Copy URL';
            copyFeedbackTimer = null;
        }, 1800);
    }

    if (typeof showNotificationToast === 'function') {
        showNotificationToast('URL copied to clipboard', 'fa-qrcode');
    }
    if (typeof setTargetUrl === 'function') {
        setTargetUrl(`Copied QR URL: ${currentShareUrl}`, 2500);
    }
}

/**
 * Closes the Send to Mobile QR modal and restores focus to the active webview.
 */
export function closeQrModal() {
    const overlay = document.getElementById('QrModalOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }

    if (state) {
        state.qrModalActive = false;
    }

    if (typeof updateQrBadgeActiveState === 'function') {
        updateQrBadgeActiveState(false);
    }

    if (activeKeyListener && typeof window !== 'undefined') {
        window.removeEventListener('keydown', activeKeyListener, true);
        activeKeyListener = null;
    }

    if (copyFeedbackTimer) {
        clearTimeout(copyFeedbackTimer);
        copyFeedbackTimer = null;
    }

    const copyBtnText = document.getElementById('QrModalCopyBtnText');
    if (copyBtnText) {
        copyBtnText.textContent = 'Copy URL';
    }

    currentShareUrl = '';
    if (typeof focusActiveWebview === 'function') {
        focusActiveWebview();
    }
}

/**
 * Opens the Zero-Cloud QR Code modal for the given URL or the currently active tab.
 * @param {string|null} [targetUrl=null] Optional explicit URL to encode
 * @param {string|null} [pageTitle=null] Optional display title
 * @returns {boolean} True if opened synchronously, false if rejected or deferred
 */
export function openQrModal(targetUrl = null, pageTitle = null) {
    const fallback = resolveActiveTabShareInfo();
    const rawCandidate = targetUrl || fallback.url;
    const cleanUrl = sanitiseQrUrl(rawCandidate);

    if (!cleanUrl) {
        if (typeof showNotificationToast === 'function') {
            showNotificationToast('Active page does not have a shareable HTTP/HTTPS URL');
        }
        if (typeof setTargetUrl === 'function') {
            setTargetUrl('Send to Mobile requires an HTTP or HTTPS page', 3000);
        }
        return false;
    }

    let overlay = document.getElementById('QrModalOverlay');
    if (!overlay) {
        if (typeof mountOverlaySync === 'function') {
            overlay = mountOverlaySync('QrModalOverlay', 'qr-modal', 'body');
        }
        if (!overlay && typeof ensureOverlayMounted === 'function') {
            ensureOverlayMounted('QrModalOverlay', 'qr-modal', 'body').then((mounted) => {
                if (mounted) {
                    openQrModal(cleanUrl, pageTitle || fallback.title);
                }
            }).catch((err) => {
                console.error('[QrModal] Failed to mount QrModalOverlay:', err);
            });
            return false;
        }
    }

    const svgContainer = document.getElementById('QrModalSvgContainer');
    const titleEl = document.getElementById('QrModalPageTitle');
    const urlEl = document.getElementById('QrModalUrlText');
    if (!overlay || !svgContainer) return false;

    try {
        svgContainer.innerHTML = generateQrSvg(cleanUrl, { size: 220, margin: 4 });
    } catch (err) {
        if (typeof showNotificationToast === 'function') {
            showNotificationToast('Unable to encode URL into QR code');
        }
        return false;
    }

    currentShareUrl = cleanUrl;
    const resolvedTitle = (typeof pageTitle === 'string' && pageTitle.trim())
        ? pageTitle.trim()
        : (fallback.title || cleanUrl);

    if (titleEl) {
        titleEl.textContent = resolvedTitle;
    }
    if (urlEl) {
        urlEl.textContent = cleanUrl;
        urlEl.title = cleanUrl;
    }

    const copyBtnText = document.getElementById('QrModalCopyBtnText');
    if (copyBtnText) {
        copyBtnText.textContent = 'Copy URL';
    }

    overlay.style.display = 'flex';
    if (state) {
        state.qrModalActive = true;
    }
    if (typeof updateQrBadgeActiveState === 'function') {
        updateQrBadgeActiveState(true);
    }

    const closeBtn = document.getElementById('CloseQrModalBtn');
    const copyBtn = document.getElementById('QrModalCopyUrlBtn');

    if (closeBtn) {
        closeBtn.onclick = () => closeQrModal();
    }
    if (copyBtn) {
        copyBtn.onclick = () => copyActiveQrUrl();
    }
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            closeQrModal();
        }
    };

    if (activeKeyListener && typeof window !== 'undefined') {
        window.removeEventListener('keydown', activeKeyListener, true);
    }

    activeKeyListener = (e) => {
        if (!isQrModalActive()) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeQrModal();
        } else if (e.key === 'y' || e.key === 'c') {
            if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                copyActiveQrUrl();
            }
        } else if (e.key === 'Tab') {
            const focusables = [copyBtn, closeBtn].filter(Boolean);
            if (focusables.length > 0) {
                e.preventDefault();
                const currentIdx = focusables.indexOf(document.activeElement);
                const dir = e.shiftKey ? -1 : 1;
                const nextIdx = currentIdx === -1
                    ? 0
                    : (currentIdx + dir + focusables.length) % focusables.length;
                focusables[nextIdx].focus();
            }
        }
    };

    if (typeof window !== 'undefined') {
        window.addEventListener('keydown', activeKeyListener, true);
    }

    if (copyBtn && typeof copyBtn.focus === 'function') {
        copyBtn.focus();
    } else if (typeof overlay.focus === 'function') {
        overlay.focus();
    }

    return true;
}

/**
 * Toggles the Send to Mobile QR modal, or updates it when an explicit URL is supplied.
 * @param {string|null} [targetUrl=null] Optional explicit URL to encode
 * @param {string|null} [pageTitle=null] Optional display title
 * @returns {boolean} True if opened, false if closed or rejected
 */
export function toggleQrModal(targetUrl = null, pageTitle = null) {
    if (isQrModalActive() && !targetUrl) {
        closeQrModal();
        return false;
    }
    return openQrModal(targetUrl, pageTitle);
}
