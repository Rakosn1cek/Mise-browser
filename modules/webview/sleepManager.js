// modules/webview/sleepManager.js
// Tab hibernation, dormant view unmounting, session snapshots, and state restoration

import { state } from '../state.js';
import { originOf, sanitizeSnapshot, attachSnapshot, snapshotForRestore } from '../sleepSnapshot.js';
import { isSplitActive, getSplitState } from '../splitView.js';
import { createWebView, destroyGuestWebview, attachShieldToggleListener } from '../webview.js';

export function updateTabSleepUI(tabIdx, isSleeping) {
    const tabList = document.querySelectorAll('#TabList li');
    const targetLi = tabList[tabIdx];
    if (!targetLi) return;

    if (isSleeping) {
        targetLi.classList.add('tab-sleeping');
        let sleepBadge = targetLi.querySelector('.tab-sleep-badge');
        if (!sleepBadge) {
            sleepBadge = document.createElement('span');
            sleepBadge.className = 'tab-sleep-badge';
            sleepBadge.title = 'Sleeping tab to save memory (click to wake)';
            sleepBadge.innerHTML = '<i class="fa-solid fa-moon"></i>';
            const shieldBtn = targetLi.querySelector('.tab-shield-btn');
            if (shieldBtn) {
                targetLi.insertBefore(sleepBadge, shieldBtn);
            } else {
                targetLi.appendChild(sleepBadge);
            }
        }
    } else {
        targetLi.classList.remove('tab-sleeping');
        const sleepBadge = targetLi.querySelector('.tab-sleep-badge');
        if (sleepBadge) {
            sleepBadge.remove();
        }
    }
}

export function wakeTab(currentWS, idx) {
    if (!currentWS) currentWS = state.sessionState.current_workspace;
    const urls = state.sessionState.workspaces[currentWS];
    if (!urls || idx < 0 || idx >= urls.length) return null;

    if (state.activeViewsCache[currentWS]?.[idx]) {
        if (state.tabSleepStates[currentWS]) {
            state.tabSleepStates[currentWS][idx] = null;
        }
        if (currentWS === state.sessionState.current_workspace) {
            updateTabSleepUI(idx, false);
        }
        return state.activeViewsCache[currentWS][idx];
    }

    const sleepRecord = state.tabSleepStates[currentWS]?.[idx];
    const targetUrl = sleepRecord?.url || urls[idx];
    const scrollX = Number(sleepRecord?.scrollX) || 0;
    const scrollY = Number(sleepRecord?.scrollY) || 0;

    const container = document.getElementById('webview-container');
    const webview = createWebView(targetUrl, currentWS, idx);
    if (sleepRecord?.darkReader || state.tabDarkReaderStates?.[currentWS]?.[idx]) {
        webview.__miseDarkReaderEnabled = true;
    }

    if (sleepRecord?.sessionSnapshot || scrollX > 0 || scrollY > 0) {
        const restoreState = () => {
            const restoredSession = snapshotForRestore(sleepRecord, webview.getURL());
            if (typeof restoredSession === 'string') {
                webview.executeJavaScript(`(function() {
                    try {
                        const data = JSON.parse(${JSON.stringify(restoredSession)});
                        for (const k in data) {
                            if (!window.sessionStorage.getItem(k)) {
                                window.sessionStorage.setItem(k, data[k]);
                            }
                        }
                    } catch (e) {}
                })()`, false).catch(() => {});
            }
            if (scrollX > 0 || scrollY > 0) {
                webview.executeJavaScript(`window.scrollTo(${scrollX}, ${scrollY});`, false).catch(() => {});
                setTimeout(() => {
                    webview.executeJavaScript(`window.scrollTo(${scrollX}, ${scrollY});`, false).catch(() => {});
                }, 300);
            }
        };
        const restoreSignal = webview.__miseAbortController?.signal;
        webview.addEventListener('dom-ready', restoreState, restoreSignal ? { once: true, signal: restoreSignal } : { once: true });
    }

    if (!state.activeViewsCache[currentWS]) state.activeViewsCache[currentWS] = [];
    state.activeViewsCache[currentWS][idx] = webview;
    container.appendChild(webview);

    if (state.tabSleepStates[currentWS]) {
        state.tabSleepStates[currentWS][idx] = null;
    }

    if (!state.tabActivityTimestamps[currentWS]) state.tabActivityTimestamps[currentWS] = [];
    state.tabActivityTimestamps[currentWS][idx] = Date.now();

    if (currentWS === state.sessionState.current_workspace) {
        const tabList = document.querySelectorAll('#TabList li');
        const targetLi = tabList[idx];
        if (targetLi) {
            attachShieldToggleListener(targetLi, webview);
            updateTabSleepUI(idx, false);
        }
    }

    state.sessionState.tab_sleep_states = state.tabSleepStates;
    window.miseAPI.saveSession(state.sessionState);

    return webview;
}

export async function hibernateTab(currentWS, idx) {
    if (!currentWS) currentWS = state.sessionState.current_workspace;
    const urls = state.sessionState.workspaces[currentWS];
    if (!urls || idx < 0 || idx >= urls.length) return false;

    if (state.tabSleepStates[currentWS] && state.tabSleepStates[currentWS][idx]) {
        return false;
    }

    if (currentWS === state.sessionState.current_workspace) {
        const tabItems = document.querySelectorAll('#TabList li');
        const activeLi = document.querySelector('#TabList li.selected');
        const activeIdx = activeLi ? Array.from(tabItems).indexOf(activeLi) : -1;
        if (idx === activeIdx && !state.dashboardActive) {
            return false;
        }
    }

    if (state.tabMediaAudible[currentWS]?.[idx]) {
        return false;
    }

    const webview = state.activeViewsCache[currentWS]?.[idx];
    if (webview) {
        if (typeof webview.isCurrentlyAudible === 'function' && webview.isCurrentlyAudible()) {
            if (!state.tabMediaAudible[currentWS]) state.tabMediaAudible[currentWS] = [];
            state.tabMediaAudible[currentWS][idx] = true;
            return false;
        }
    }

    let scrollX = 0;
    let scrollY = 0;
    let finalUrl = urls[idx];
    let finalTitle = state.activeTitlesCache[currentWS]?.[idx] || 'Tab';
    let isDarkReader = false;
    let originBefore = null;
    let originAfter = null;
    let rawSession = null;

    if (webview) {
        isDarkReader = !!webview.__miseDarkReaderEnabled;
        if (!state.tabDarkReaderStates) state.tabDarkReaderStates = {};
        if (!state.tabDarkReaderStates[currentWS]) state.tabDarkReaderStates[currentWS] = [];
        state.tabDarkReaderStates[currentWS][idx] = isDarkReader;
        try {
            const scrollPos = await webview.executeJavaScript(`[window.scrollX || window.pageXOffset || 0, window.scrollY || window.pageYOffset || 0]`);
            if (Array.isArray(scrollPos)) {
                scrollX = scrollPos[0] || 0;
                scrollY = scrollPos[1] || 0;
            }
        } catch (err) {}

        try {
            originBefore = originOf(webview.getURL());
        } catch (err) {}

        try {
            rawSession = await webview.executeJavaScript(`(function() {
                try {
                    const data = {};
                    for (let i = 0; i < window.sessionStorage.length; i++) {
                        const key = window.sessionStorage.key(i);
                        data[key] = window.sessionStorage.getItem(key);
                    }
                    return JSON.stringify(data);
                } catch (e) {
                    return null;
                }
            })()`);
        } catch (err) {}

        try {
            originAfter = originOf(webview.getURL());
        } catch (err) {}

        try {
            const liveUrl = webview.getURL();
            if (liveUrl && !liveUrl.startsWith('about:blank')) {
                finalUrl = liveUrl;
                urls[idx] = finalUrl;
            }
            const liveTitle = webview.getTitle();
            if (liveTitle) {
                finalTitle = liveTitle;
                if (!state.activeTitlesCache[currentWS]) state.activeTitlesCache[currentWS] = [];
                state.activeTitlesCache[currentWS][idx] = finalTitle;
            }
        } catch (err) {}

        try {
            if (window.miseAPI && typeof window.miseAPI.flushSessionStore === 'function') {
                await window.miseAPI.flushSessionStore({ workspace: currentWS });
            }
        } catch (err) {}

        try {
            destroyGuestWebview(webview);
        } catch (err) {}
        state.activeViewsCache[currentWS][idx] = null;
    }

    if (!state.tabSleepStates[currentWS]) state.tabSleepStates[currentWS] = [];
    const sleepRecord = {
        url: finalUrl,
        title: finalTitle,
        scrollX,
        scrollY,
        darkReader: isDarkReader,
        hibernatedAt: Date.now()
    };
    if (originBefore && originBefore === originAfter) {
        const sanitizedData = sanitizeSnapshot(rawSession);
        if (sanitizedData !== null) {
            attachSnapshot(sleepRecord, originBefore, sanitizedData);
        }
    }
    state.tabSleepStates[currentWS][idx] = sleepRecord;

    if (currentWS === state.sessionState.current_workspace) {
        updateTabSleepUI(idx, true);
    }

    state.sessionState.tab_sleep_states = state.tabSleepStates;
    state.sessionState.tab_titles = state.activeTitlesCache;
    window.miseAPI.saveSession(state.sessionState);

    return true;
}

export async function hibernateInactiveTabs() {
    const currentWS = state.sessionState.current_workspace;
    const tabItems = document.querySelectorAll('#TabList li');
    const activeLi = document.querySelector('#TabList li.selected');
    const activeIdx = activeLi ? Array.from(tabItems).indexOf(activeLi) : -1;
    const splitActive = isSplitActive(currentWS);
    const split = getSplitState(currentWS);

    for (const wsName of Object.keys(state.sessionState.workspaces || {})) {
        const urls = state.sessionState.workspaces[wsName] || [];
        for (let i = 0; i < urls.length; i++) {
            if (wsName === currentWS && !state.dashboardActive) {
                if (i === activeIdx) continue;
                if (splitActive && (i === split.primaryIdx || i === split.secondaryIdx)) continue;
            }
            if (state.tabPinned?.[wsName]?.[i]) {
                continue;
            }
            if (state.tabSleepStates[wsName] && state.tabSleepStates[wsName][i]) {
                continue;
            }
            if (state.tabMediaAudible[wsName]?.[i]) {
                continue;
            }
            await hibernateTab(wsName, i);
        }
    }

    if (window.miseAPI && typeof window.miseAPI.compactMemory === 'function') {
        window.miseAPI.compactMemory().catch(() => {});
    }
}

export function wakeAllTabsInWorkspace(wsName) {
    if (!wsName) wsName = state.sessionState.current_workspace;
    const urls = state.sessionState.workspaces[wsName] || [];
    urls.forEach((_, idx) => {
        if (state.tabSleepStates[wsName]?.[idx]) {
            wakeTab(wsName, idx);
        }
    });
}

let sleepTimerId = null;

export function initializeTabSleepManager() {
    if (sleepTimerId) clearInterval(sleepTimerId);

    sleepTimerId = setInterval(async () => {
        try {
            const cfg = (await window.miseAPI.getBrowserSettings()) || {};
            const timeoutMinutes = cfg.tab_sleep_timeout_minutes !== undefined ? parseInt(cfg.tab_sleep_timeout_minutes, 10) : 15;
            if (timeoutMinutes <= 0) return;

            const timeoutMs = timeoutMinutes * 60 * 1000;
            const now = Date.now();
            const currentWS = state.sessionState.current_workspace;

            const tabItems = document.querySelectorAll('#TabList li');
            const activeLi = document.querySelector('#TabList li.selected');
            const activeIdx = activeLi ? Array.from(tabItems).indexOf(activeLi) : -1;
            const splitActive = isSplitActive(currentWS);
            const split = getSplitState(currentWS);

            for (const wsName of Object.keys(state.sessionState.workspaces || {})) {
                const urls = state.sessionState.workspaces[wsName] || [];
                for (let i = 0; i < urls.length; i++) {
                    if (wsName === currentWS && !state.dashboardActive) {
                        if (i === activeIdx) continue;
                        if (splitActive && (i === split.primaryIdx || i === split.secondaryIdx)) continue;
                    }
                    if (state.tabPinned?.[wsName]?.[i]) {
                        continue;
                    }
                    if (state.tabSleepStates[wsName] && state.tabSleepStates[wsName][i]) {
                        continue;
                    }
                    if (state.tabMediaAudible[wsName]?.[i]) {
                        continue;
                    }
                    const lastActive = state.tabActivityTimestamps[wsName]?.[i] || 0;
                    if (lastActive > 0 && (now - lastActive) >= timeoutMs) {
                        hibernateTab(wsName, i);
                    }
                }
            }
        } catch (err) {}
    }, 30000);
}
