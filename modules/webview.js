import { state } from './state.js';
import { getActiveWebview, focusActiveWebview } from './utils.js';

export function applyCSSThemeToView(webview) {
    // Left as stub matching existing codebase implementation
}

export function renderWorkspaceUI(targetTabToFocus = null) {
    document.getElementById('WorkspaceLabel').textContent = state.sessionState.current_workspace;
    const tabList = document.getElementById('TabList');
    tabList.innerHTML = '';

    const currentWS = state.sessionState.current_workspace;
    const urls = state.sessionState.workspaces[currentWS] || ["https://duckduckgo.com"];

    if (!state.activeViewsCache[currentWS]) state.activeViewsCache[currentWS] = [];
    if (!state.activeTitlesCache[currentWS]) state.activeTitlesCache[currentWS] = [];

    const container = document.getElementById('webview-container');

    urls.forEach((url, idx) => {
        const cachedTitle = state.activeTitlesCache[currentWS][idx] || "Loading...";
        const li = document.createElement('li');
        li.textContent = cachedTitle.length > 24 ? cachedTitle.slice(0, 24) + "..." : cachedTitle;
        li.setAttribute('tabindex', '0');
        
        li.addEventListener('click', () => {
            if (state.dashboardActive && typeof window.toggleDashboardView === 'function') {
                window.toggleDashboardView();
            }
            switchTabFocus(idx);
        });

        li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (state.dashboardActive && typeof window.toggleDashboardView === 'function') {
                    window.toggleDashboardView();
                }
                switchTabFocus(idx);
            }
        });

        tabList.appendChild(li);

        if (!state.activeViewsCache[currentWS][idx]) {
            const webview = document.createElement('webview');
            webview.style.backgroundColor = '#1a1b26';
            webview.setAttribute('preload', window.miseAPI.getWebviewPreloadPath());
            webview.setAttribute('allowpopups', '');
            
            if (state.globalPrivateModeActive || url.toLowerCase().includes("ycombinator.com")) {
                webview.setAttribute('partition', 'MisePrivateProfile');
            }
            
            webview.setAttribute('src', url);
            
            webview.addEventListener('page-title-updated', (e) => {
                state.activeTitlesCache[currentWS][idx] = e.title;
                const targetLi = document.querySelectorAll('#TabList li')[idx];
                if (targetLi && state.sessionState.current_workspace === currentWS) {
                    targetLi.textContent = e.title.length > 24 ? e.title.slice(0, 24) + "..." : e.title;
                }
            });

            webview.addEventListener('did-navigate', (e) => {
                if (state.sessionState.workspaces[currentWS] && state.sessionState.workspaces[currentWS][idx]) {
                    state.sessionState.workspaces[currentWS][idx] = e.url;
                    window.miseAPI.saveSession(state.sessionState);
                }
            });

            webview.addEventListener('did-navigate-in-page', (e) => {
                if (state.sessionState.workspaces[currentWS] && state.sessionState.workspaces[currentWS][idx]) {
                    state.sessionState.workspaces[currentWS][idx] = e.url;
                    window.miseAPI.saveSession(state.sessionState);
                }
                webview.executeJavaScript(`
                    (function() {
                        try {
                            document.querySelectorAll('video').forEach(v => {
                                const prevDisplay = v.style.display;
                                v.style.display = 'none';
                                void v.offsetHeight; // force synchronous reflow
                                v.style.display = prevDisplay;
                            });
                        } catch (e) {}
                    })();
                `, false).catch(() => {});
            });

            webview.addEventListener('new-window', (e) => {
                e.preventDefault();
                const targetUrl = e.url;
                
                if (!state.sessionState.workspaces[currentWS]) {
                    state.sessionState.workspaces[currentWS] = [];
                }
                
                state.sessionState.workspaces[currentWS].push(targetUrl);
                window.miseAPI.saveSession(state.sessionState);
                
                const newTargetIdx = state.sessionState.workspaces[currentWS].length - 1;
                renderWorkspaceUI(newTargetIdx);
            });

            webview.addEventListener('render-process-gone', (e) => {
                if (e.reason !== 'clean-exit') {
                    setTimeout(() => {
                        webview.reload();
                    }, 500);
                }
            });

            webview.addEventListener('found-in-page', (e) => {
                if (e.result) {
                    const countEl = document.getElementById('FindMatchCount');
                    if (countEl) {
                        const activeMatch = e.result.activeMatchOrdinal || 0;
                        const totalMatches = e.result.matches || 0;
                        countEl.textContent = totalMatches > 0 ? `${activeMatch}/${totalMatches}` : '0/0';
                    }
                }
            });

            webview.addEventListener('media-started-playing', () => {
                updateTabMediaIndicator(currentWS, idx, true);
            });
            
            webview.addEventListener('media-paused', () => {
                updateTabMediaIndicator(currentWS, idx, false);
            });

            webview.addEventListener('did-start-loading', () => {
                webview.style.opacity = '1';
                updateTabMediaIndicator(currentWS, idx, false);
            });

            webview.addEventListener('dom-ready', async () => {
                applyCSSThemeToView(webview);
                webview.style.opacity = '1';

                try {
                    const hinterCode = await window.miseAPI.readHinterCode();
                    if (hinterCode && typeof webview.executeJavaScript === 'function') {
                        // Wrap script evaluation in a self-executing try-catch inside the guest context
                        // to prevent Electron IPC execution bridge rejections during SPA frame updates
                        const safeExecutionWrapper = `try { ${hinterCode} } catch(e) {}`;
                        webview.executeJavaScript(safeExecutionWrapper, false).catch(() => {});
                    }
                } catch (err) {}
            });

            container.appendChild(webview);
            state.activeViewsCache[currentWS][idx] = webview;
        }
    });

    if (!state.dashboardActive) {
        const focusIdx = targetTabToFocus !== null ? targetTabToFocus : 0;
        switchTabFocus(focusIdx);
    }
}

export function switchTabFocus(targetIdx) {
    const tabItems = document.querySelectorAll('#TabList li');
    const currentWS = state.sessionState.current_workspace;
    const currentWSViews = state.activeViewsCache[currentWS] || [];

    if (targetIdx >= tabItems.length) {
        targetIdx = Math.max(0, tabItems.length - 1);
    }

    tabItems.forEach((item, idx) => {
        if (idx === targetIdx) item.classList.add('selected');
        else item.classList.remove('selected');
    });

    const allWebviews = document.getElementById('webview-container').querySelectorAll('webview');
    allWebviews.forEach((wv) => wv.style.display = 'none');
    
    if (!state.dashboardActive && currentWSViews[targetIdx]) {
        currentWSViews[targetIdx].style.display = 'flex';
        
        setTimeout(() => {
            const currentFocused = document.activeElement;
            const sidebarHasFocus = document.getElementById('Sidebar').contains(currentFocused);
            const addressBar = document.getElementById('WideAddressBar');
            const addressBarIsActive = addressBar && (addressBar.style.display === 'block' || currentFocused === addressBar);

            if (!sidebarHasFocus && !state.paletteActive && !state.helpActive && !addressBarIsActive) {
                window.miseAllowWebviewFocus = true;
                currentWSViews[targetIdx].focus();
            }
        }, 50);
        
        try { applyCSSThemeToView(currentWSViews[targetIdx]); } catch (err) {}
    }
}

export function spawnNewBlankTab() {
    const currentWS = state.sessionState.current_workspace;
    if (!state.sessionState.workspaces[currentWS]) state.sessionState.workspaces[currentWS] = [];
    state.sessionState.workspaces[currentWS].push("https://duckduckgo.com");
    window.miseAPI.saveSession(state.sessionState);
    
    const newTargetIdx = state.sessionState.workspaces[currentWS].length - 1;
    renderWorkspaceUI(newTargetIdx);
    if (typeof window.displayAddressOverlay === 'function') {
        window.displayAddressOverlay();
    }
}

export function spawnTabWithUrl(url) {
    const currentWS = state.sessionState.current_workspace;
    if (!state.sessionState.workspaces[currentWS]) state.sessionState.workspaces[currentWS] = [];
    state.sessionState.workspaces[currentWS].push(url || "https://duckduckgo.com");
    window.miseAPI.saveSession(state.sessionState);
    
    const newTargetIdx = state.sessionState.workspaces[currentWS].length - 1;
    renderWorkspaceUI(newTargetIdx);
}

export function handleTabRemoval() {
    if (state.dashboardActive) {
        const currentItem = state.dashboardItems[state.dashboardSelectionIdx];
        if (!currentItem) return;
        const [type, wsName, idx] = currentItem.payload;
        
        if (type === 'tab') {
            if (state.sessionState.workspaces[wsName].length > 1) {
                state.sessionState.workspaces[wsName].splice(idx, 1);
                if (state.activeViewsCache[wsName] && state.activeViewsCache[wsName][idx]) {
                    state.activeViewsCache[wsName][idx].remove();
                    state.activeViewsCache[wsName].splice(idx, 1);
                }
                if (state.activeTitlesCache[wsName]) state.activeTitlesCache[wsName].splice(idx, 1);
                window.miseAPI.saveSession(state.sessionState);
                renderWorkspaceUI();
                if (typeof window.buildDashboardTree === 'function') {
                    window.buildDashboardTree();
                }
            }
        } else if (type === 'workspace') {
            const totalWorkspaces = Object.keys(state.sessionState.workspaces);
            if (totalWorkspaces.length > 1) {
                if (wsName === state.sessionState.current_workspace) {
                    const fallbackWS = totalWorkspaces.find(k => k !== wsName);
                    state.sessionState.current_workspace = fallbackWS;
                }
                if (state.activeViewsCache[wsName]) {
                    state.activeViewsCache[wsName].forEach(wv => wv.remove());
                    delete state.activeViewsCache[wsName];
                }
                delete state.activeTitlesCache[wsName];
                delete state.sessionState.workspaces[wsName];
                
                window.miseAPI.saveSession(state.sessionState);
                renderWorkspaceUI();
                if (typeof window.buildDashboardTree === 'function') {
                    window.buildDashboardTree();
                }
            }
        }
        return;
    }

    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;

    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
    const tabs = state.sessionState.workspaces[currentWS] || [];
    if (tabs.length <= 1) return;

    tabs.splice(currentIdx, 1);
    if (state.activeViewsCache[currentWS] && state.activeViewsCache[currentWS][currentIdx]) {
        state.activeViewsCache[currentWS][currentIdx].remove();
        state.activeViewsCache[currentWS].splice(currentIdx, 1);
    }
    if (state.activeTitlesCache[currentWS]) state.activeTitlesCache[currentWS].splice(currentIdx, 1);

    window.miseAPI.saveSession(state.sessionState);
    window.miseAllowWebviewFocus = true;

    renderWorkspaceUI(Math.max(0, currentIdx - 1));
}

export function navigateFrameBack() {
    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;

    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
    if (state.activeViewsCache[currentWS] && state.activeViewsCache[currentWS][currentIdx]) {
        state.activeViewsCache[currentWS][currentIdx].goBack();
    }
}

export function navigateFrameForward() {
    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;

    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
    if (state.activeViewsCache[currentWS] && state.activeViewsCache[currentWS][currentIdx]) {
        state.activeViewsCache[currentWS][currentIdx].goForward();
    }
}

export function toggleGlobalMediaPlayback() {
    Object.values(state.activeViewsCache).forEach(workspaceViews => {
        workspaceViews.forEach(wv => {
            if (wv && typeof wv.executeJavaScript === 'function') {
                wv.executeJavaScript(`
                    (function() {
                        try {
                            const mediaElements = Array.from(document.querySelectorAll('video, audio'));
                            if (mediaElements.length === 0) return false;
                            
                            const hasPlaying = mediaElements.some(m => !m.paused && !m.ended && m.readyState > 2);
                            
                            mediaElements.forEach(m => {
                                if (hasPlaying) {
                                    m.pause();
                                } else {
                                    m.play().catch(() => {});
                                }
                            });
                            return true;
                        } catch (e) { return false; }
                    })();
                `, false).catch(() => {});
            }
        });
    });
}

export function updateTabMediaIndicator(workspaceId, tabIdx, isAudible) {
    if (state.sessionState.current_workspace !== workspaceId) return;

    const tabList = document.querySelectorAll('#TabList li');
    const targetLi = tabList[tabIdx];
    if (!targetLi) return;

    let mediaBadge = targetLi.querySelector('.tab-media-badge');

    if (isAudible) {
        if (!mediaBadge) {
            mediaBadge = document.createElement('span');
            mediaBadge.className = 'tab-media-badge';
            mediaBadge.innerHTML = ' 🔊';
            targetLi.appendChild(mediaBadge);
        }
    } else {
        if (mediaBadge) {
            mediaBadge.remove();
        }
    }
}
