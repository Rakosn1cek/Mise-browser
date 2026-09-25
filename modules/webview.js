import { state } from './state.js';
import { getActiveWebview, focusActiveWebview, getWorkspacePartition } from './utils.js';

export function applyCSSThemeToView(webview) {
    if (webview && typeof webview.executeJavaScript === 'function') {
        const theme = state.isDarkMode ? 'dark' : 'light';
        webview.executeJavaScript(`document.documentElement.setAttribute('data-theme', '${theme}');`, false).catch(() => {});
    }
}

export function createWebView(url, currentWS, idx) {
    const webview = document.createElement('webview');
    webview.style.backgroundColor = '#ffffff';
    webview.setAttribute('preload', window.miseAPI.getWebviewPreloadPath());
    webview.setAttribute('allowpopups', '');
    
    if (state.globalPrivateModeActive || url.toLowerCase().includes("ycombinator.com")) {
        webview.setAttribute('partition', 'MisePrivateProfile');
    } else {
        webview.setAttribute('partition', getWorkspacePartition(currentWS));
    }
    
    webview.setAttribute('src', url);
    
    webview.addEventListener('page-title-updated', (e) => {
        state.activeTitlesCache[currentWS][idx] = e.title;
        const targetLi = document.querySelectorAll('#TabList li')[idx];
        if (targetLi && state.sessionState.current_workspace === currentWS) {
            const titleEl = targetLi.querySelector('.tab-title');
            if (titleEl) {
                titleEl.textContent = e.title.length > 24 ? e.title.slice(0, 24) + "..." : e.title;
            }
        }
    });

    webview.addEventListener('did-navigate', async (e) => {
        if (state.sessionState.workspaces[currentWS] && state.sessionState.workspaces[currentWS][idx]) {
            state.sessionState.workspaces[currentWS][idx] = e.url;
            window.miseAPI.saveSession(state.sessionState);
        }
        const targetLi = document.querySelectorAll('#TabList li')[idx];
        if (targetLi) {
            const cfg = (await window.miseAPI.getBrowserSettings()) || {};
            updateTabShieldStatus(targetLi, e.url, cfg.trusted_domains || []);
        }
    });

    webview.addEventListener('did-navigate-in-page', async (e) => {
        if (state.sessionState.workspaces[currentWS] && state.sessionState.workspaces[currentWS][idx]) {
            state.sessionState.workspaces[currentWS][idx] = e.url;
            window.miseAPI.saveSession(state.sessionState);
        }
        const targetLi = document.querySelectorAll('#TabList li')[idx];
        if (targetLi) {
            const cfg = (await window.miseAPI.getBrowserSettings()) || {};
            updateTabShieldStatus(targetLi, e.url, cfg.trusted_domains || []);
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

        const targetLi = document.querySelectorAll('#TabList li')[idx];
        if (targetLi) {
            const cfg = (await window.miseAPI.getBrowserSettings()) || {};
            updateTabShieldStatus(targetLi, webview.getURL(), cfg.trusted_domains || []);
        }

        try {
            const hinterCode = await window.miseAPI.readHinterCode();
            if (hinterCode && typeof webview.executeJavaScript === 'function') {
                const safeExecutionWrapper = `try { ${hinterCode} } catch(e) {}`;
                webview.executeJavaScript(safeExecutionWrapper, false).catch(() => {});
            }
        } catch (err) {}
    });
    
    return webview;
}

function extractHostname(url) {
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

        cfg.trusted_domains = domains;
        await window.miseAPI.updateBrowserSettings(cfg);

        updateTabShieldStatus(tabLi, currentUrl, domains);
        webview.reload();
    });
}

export function renderWorkspaceUI(targetTabToFocus = null) {
    const currentWS = state.sessionState.current_workspace;
    const wsLabel = document.getElementById('WorkspaceLabel');
    if (wsLabel) {
        wsLabel.textContent = currentWS;
        wsLabel.title = `Workspace: ${currentWS} (Container: ${getWorkspacePartition(currentWS)})`;
    }
    const tabList = document.getElementById('TabList');
    tabList.innerHTML = '';

    const urls = state.sessionState.workspaces[currentWS] || [];

    const welcomeEl = document.getElementById('EmptyWorkspaceWelcome');
    const container = document.getElementById('webview-container');
    const allWebviews = container.querySelectorAll('webview');
    allWebviews.forEach((wv) => wv.style.display = 'none');

    if (urls.length === 0) {
        if (welcomeEl) {
            welcomeEl.style.display = 'flex';
            const nameEl = document.getElementById('WelcomeWorkspaceName');
            if (nameEl) nameEl.textContent = currentWS;
        }
        return;
    } else {
        if (welcomeEl) {
            welcomeEl.style.display = 'none';
        }
    }

    if (!state.activeViewsCache[currentWS]) state.activeViewsCache[currentWS] = [];
    if (!state.activeTitlesCache[currentWS]) state.activeTitlesCache[currentWS] = [];

    urls.forEach((url, idx) => {
        const cachedTitle = state.activeTitlesCache[currentWS][idx] || "Loading...";
        const li = document.createElement('li');
        li.setAttribute('tabindex', '0');

        const titleSpan = document.createElement('span');
        titleSpan.className = 'tab-title';
        titleSpan.textContent = cachedTitle.length > 24 ? cachedTitle.slice(0, 24) + "..." : cachedTitle;
        li.appendChild(titleSpan);

        const shieldBtn = document.createElement('button');
        shieldBtn.className = 'tab-shield-btn';
        shieldBtn.innerHTML = '<i class="fa-solid fa-shield-halved shield-on"></i>';
        li.appendChild(shieldBtn);
        
        li.addEventListener('click', (e) => {
            if (e.target.closest('.tab-shield-btn')) return;
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
            const webview = createWebView(url, currentWS, idx);

            attachShieldToggleListener(li, webview);
            container.appendChild(webview);
            state.activeViewsCache[currentWS][idx] = webview;
        } else {
            const existingWebview = state.activeViewsCache[currentWS][idx];
            attachShieldToggleListener(li, existingWebview);
            window.miseAPI.getBrowserSettings().then(cfg => {
                updateTabShieldStatus(li, existingWebview.getURL(), cfg?.trusted_domains || []);
            }).catch(() => {});
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

export async function spawnNewBlankTab() {
    const currentWS = state.sessionState.current_workspace;
    if (!state.sessionState.workspaces[currentWS]) state.sessionState.workspaces[currentWS] = [];

    let defaultUrl = 'https://duckduckgo.com';
    if (window.miseAPI && typeof window.miseAPI.getBrowserSettings === 'function') {
        try {
            const cfg = await window.miseAPI.getBrowserSettings();
            if (cfg && cfg.search_engine) {
                const parsedUrl = new URL(cfg.search_engine.split('?')[0]);
                defaultUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
            }
        } catch (err) {
            defaultUrl = 'https://duckduckgo.com';
        }
    }

    state.sessionState.workspaces[currentWS].push(defaultUrl);
    window.miseAPI.saveSession(state.sessionState);
    
    const newTargetIdx = state.sessionState.workspaces[currentWS].length - 1;
    renderWorkspaceUI(newTargetIdx);
    if (typeof window.displayAddressOverlay === 'function') {
        window.displayAddressOverlay();
    }
}

export function spawnTabWithUrl(url) {
    if (state.dashboardActive && typeof window.toggleDashboardView === 'function') {
        window.toggleDashboardView();
    }
    const addressBar = document.getElementById('WideAddressBar');
    if (addressBar && addressBar.style.display !== 'none') {
        addressBar.style.display = 'none';
    }
    const bookmarksOverlay = document.getElementById('BookmarksOverlay');
    if (bookmarksOverlay && bookmarksOverlay.style.display !== 'none') {
        if (typeof window.toggleBookmarksOverlay === 'function') {
            window.toggleBookmarksOverlay();
        } else {
            bookmarksOverlay.style.display = 'none';
        }
    }
    const notesOverlay = document.getElementById('NotesOverlay');
    if (notesOverlay && notesOverlay.style.display !== 'none') {
        if (typeof window.toggleNotesOverlay === 'function') {
            window.toggleNotesOverlay();
        } else {
            notesOverlay.style.display = 'none';
        }
    }

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
    if (tabs.length === 0) return;

    tabs.splice(currentIdx, 1);
    if (state.activeViewsCache[currentWS] && state.activeViewsCache[currentWS][currentIdx]) {
        state.activeViewsCache[currentWS][currentIdx].remove();
        state.activeViewsCache[currentWS].splice(currentIdx, 1);
    }
    if (state.activeTitlesCache[currentWS]) state.activeTitlesCache[currentWS].splice(currentIdx, 1);

    window.miseAPI.saveSession(state.sessionState);
    window.miseAllowWebviewFocus = true;

    renderWorkspaceUI(tabs.length > 0 ? Math.max(0, currentIdx - 1) : null);
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
