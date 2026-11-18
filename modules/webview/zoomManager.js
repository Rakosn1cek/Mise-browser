// modules/webview/zoomManager.js
// Centralised webview zoom level and factor management for Mise Browser

import { state } from '../state.js';
import { getActiveWebview } from '../utils.js';
import { setTargetUrl } from '../statusBar.js';

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0];

export function getWebviewZoomFactor(webview) {
    if (!webview) return 1.0;
    return typeof webview.__miseZoomFactor === 'number' ? webview.__miseZoomFactor : 1.0;
}

export function setWebviewZoomFactor(webview, factor) {
    if (!webview || typeof factor !== 'number' || isNaN(factor)) return;
    const clamped = Math.max(0.25, Math.min(5.0, Math.round(factor * 100) / 100));
    webview.__miseZoomFactor = clamped;

    try {
        if (typeof webview.setZoomFactor === 'function') {
            webview.setZoomFactor(clamped);
        }
    } catch (_) {}

    const wsName = state.sessionState?.current_workspace;
    if (wsName && state.activeViewsCache?.[wsName]) {
        const liveIdx = state.activeViewsCache[wsName].indexOf(webview);
        if (liveIdx !== -1) {
            if (!state.tabZoomFactors) state.tabZoomFactors = {};
            if (!state.tabZoomFactors[wsName]) state.tabZoomFactors[wsName] = [];
            state.tabZoomFactors[wsName][liveIdx] = clamped;
        }
    }

    const percentage = Math.round(clamped * 100);
    setTargetUrl(`Zoom: ${percentage}%`, 1500);
}

export function zoomInActiveTab() {
    const webview = getActiveWebview();
    if (!webview) return;
    const current = getWebviewZoomFactor(webview);
    const next = ZOOM_STEPS.find(step => step > current + 0.01) || 5.0;
    setWebviewZoomFactor(webview, next);
}

export function zoomOutActiveTab() {
    const webview = getActiveWebview();
    if (!webview) return;
    const current = getWebviewZoomFactor(webview);
    let prev = 0.25;
    for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
        if (ZOOM_STEPS[i] < current - 0.01) {
            prev = ZOOM_STEPS[i];
            break;
        }
    }
    setWebviewZoomFactor(webview, prev);
}

export function zoomResetActiveTab() {
    const webview = getActiveWebview();
    if (!webview) return;
    setWebviewZoomFactor(webview, 1.0);
}

export function applyWebviewZoom(webview, currentWS, idx) {
    if (!webview) return;
    let factor = webview.__miseZoomFactor;
    if (typeof factor !== 'number' && currentWS && typeof idx === 'number') {
        factor = state.tabZoomFactors?.[currentWS]?.[idx];
        if (typeof factor === 'number') {
            webview.__miseZoomFactor = factor;
        }
    }
    if (typeof factor === 'number' && factor > 0) {
        try {
            if (typeof webview.setZoomFactor === 'function') {
                webview.setZoomFactor(factor);
            }
        } catch (_) {}
    }
}
