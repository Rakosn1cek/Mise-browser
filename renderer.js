import { state } from './modules/state.js';
import { 
    isDarkMode, 
    applyThemeToOverlayElement, 
    escapeHtml, 
    isTargetScript, 
    getActiveWebview, 
    focusActiveWebview 
} from './modules/utils.js';
import { 
    applyThemeVisuals, 
    syncVisualSettingsInputs 
} from './modules/theme.js';

import { 
    renderWorkspaceUI, 
    switchTabFocus, 
    spawnNewBlankTab, 
    spawnTabWithUrl, 
    handleTabRemoval, 
    navigateFrameBack, 
    navigateFrameForward, 
    applyCSSThemeToView,
    toggleGlobalMediaPlayback,
    initializeTabSleepManager,
    hibernateInactiveTabs,
    wakeTab,
    wakeAllTabsInWorkspace
} from './modules/webview.js';

import { 
    loadBookmarksAndQuickmarks, 
    promptQuickmark, 
    addCurrentPageToBookmarks, 
    toggleBookmarksOverlay, 
    renderBookmarksList, 
    updateBookmarkVisualSelection, 
    deleteBookmark, 
    deleteQuickmark, 
    setupBookmarkOverlayListeners 
} from './modules/overlays/bookmarks.js';

import { 
    commandRegistry, 
    toggleCommandPaletteView, 
    togglePreferencesView,
    filterPaletteCommands, 
    updatePaletteVisualSelection, 
    handlePaletteInputNavigation, 
    executePaletteSelection 
} from './modules/overlays/commandPalette.js';

import { 
    toggleDashboardView, 
    buildDashboardTree, 
    updateDashboardVisualSelection, 
    executeDashboardItemActivation, 
    showWorkspaceInputDialog, 
    hideWorkspaceInputDialog, 
    processWorkspaceCreation 
} from './modules/overlays/dashboard.js';

import { 
    toggleHistoryOverlay, 
    filterHistoryItems 
} from './modules/overlays/history.js';

import { 
    parseMarkdownToHtml, 
    renderNotesView, 
    toggleNotesOverlay, 
    setupNotesListeners 
} from './modules/overlays/notes.js';

import { 
    displayAddressOverlay, 
    handleNavigation, 
    setupAddressBarAutocomplete, 
    renderSuggestions, 
    updateSuggestionHighlight, 
    selectSuggestion, 
    hideSuggestions 
} from './modules/navigation.js';

import { openTransientShareModal } from './modules/overlays/shareModal.js';
import { initSearchEnginePreference } from './modules/overlays/searchEngine.js';
import { initDownloadShelf, toggleDownloadShelf } from './modules/downloads.js';
import { 
    toggleSplitView, 
    cycleSplitOrientation, 
    switchSplitFocus, 
    swapSplitPanes, 
    closeSplitView, 
    isSplitActive, 
    applySplitLayout 
} from './modules/splitView.js';

// Attach functions needed across module boundaries to window
window.toggleDashboardView = toggleDashboardView;
window.displayAddressOverlay = displayAddressOverlay;
window.triggerLinkHints = triggerLinkHints;
window.toggleInPageSearch = toggleInPageSearch;
window.toggleNotesOverlay = toggleNotesOverlay;
window.toggleDownloadShelf = toggleDownloadShelf;
window.toggleZenMode = toggleZenMode;
window.toggleSidebarExpansion = toggleSidebarExpansion;
window.toggleSidebarPin = toggleSidebarPin;
window.applySidebarMode = applySidebarMode;
window.toggleInterfaceTheme = toggleInterfaceTheme;
window.toggleWebviewTheme = toggleWebviewTheme;
window.applyThemeVisuals = applyThemeVisuals;
window.togglePreferencesView = togglePreferencesView;
window.toggleHistoryOverlay = toggleHistoryOverlay;
window.handlePrivateBrowsingStateShift = handlePrivateBrowsingStateShift;
window.executeSurgicalCookieWipe = executeSurgicalCookieWipe;
window.executeGlobalCacheWipe = executeGlobalCacheWipe;
window.toggleActiveDevTools = toggleActiveDevTools;
window.toggleCommandPaletteView = toggleCommandPaletteView;
window.buildDashboardTree = buildDashboardTree;
window.toggleGlobalMediaPlayback = toggleGlobalMediaPlayback;
window.toggleSplitView = toggleSplitView;
window.cycleSplitOrientation = cycleSplitOrientation;
window.switchSplitFocus = switchSplitFocus;
window.swapSplitPanes = swapSplitPanes;
window.closeSplitView = closeSplitView;
window.isSplitActive = isSplitActive;
window.applySplitLayout = applySplitLayout;

let findActive = false;

async function initializeBrowser() {
    state.sessionState = await window.miseAPI.getSession();
    
    // Restore cached titles, sleeping tab states, and favicons if present
    if (state.sessionState.tab_titles) {
        state.activeTitlesCache = { ...state.sessionState.tab_titles };
    }
    if (state.sessionState.tab_favicons) {
        state.tabFavicons = { ...state.sessionState.tab_favicons };
    }
    if (state.sessionState.tab_sleep_states) {
        state.tabSleepStates = { ...state.sessionState.tab_sleep_states };
    } else {
        // Initialise background tabs as sleeping on boot to conserve memory
        Object.keys(state.sessionState.workspaces || {}).forEach(ws => {
            const urls = state.sessionState.workspaces[ws] || [];
            if (!state.tabSleepStates[ws]) state.tabSleepStates[ws] = [];
            urls.forEach((u, i) => {
                if (ws !== state.sessionState.current_workspace || i !== 0) {
                    state.tabSleepStates[ws][i] = {
                        url: u,
                        title: state.activeTitlesCache[ws]?.[i] || u,
                        scrollX: 0,
                        scrollY: 0,
                        hibernatedAt: Date.now()
                    };
                } else {
                    state.tabSleepStates[ws][i] = null;
                }
            });
        });
    }

    // Load persisted theme and sidebar preferences from configuration
    let savedTheme = 'dark';
    let sidebarAutoCollapse = true;
    let initialCfg = null;
    if (window.miseAPI && typeof window.miseAPI.getBrowserSettings === 'function') {
        try {
            const cfg = await window.miseAPI.getBrowserSettings();
            if (cfg) {
                initialCfg = cfg;
                if (cfg.theme) savedTheme = cfg.theme;
                if (typeof cfg.sidebar_auto_collapse === 'boolean') {
                    sidebarAutoCollapse = cfg.sidebar_auto_collapse;
                }
            }
        } catch (e) {}
    }

    applySidebarMode(sidebarAutoCollapse);

    const body = document.body;

    if (savedTheme === 'light') {
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
    } else {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
    }

    applyThemeVisuals(initialCfg, savedTheme);

    currentWebviewTheme = initialCfg?.webview_theme || 'dark';
    updateWebviewThemeButtonUI(currentWebviewTheme);

    const container = document.getElementById('webview-container');
    if (container) {
        container.classList.remove('theme-light', 'theme-dark');
        container.classList.add(currentWebviewTheme === 'light' ? 'theme-light' : 'theme-dark');
    }

    if (window.miseAPI && typeof window.miseAPI.setNativeTheme === 'function') {
        window.miseAPI.setNativeTheme(currentWebviewTheme);
    }

    setupEventListeners();
    renderWorkspaceUI();
    initializeTabSleepManager();
    setupNotesListeners();
    setupAddressBarAutocomplete();
    setupBookmarkOverlayListeners();
    initSearchEnginePreference();
    initDownloadShelf();

    if (window.miseAPI && typeof window.miseAPI.getAppVersion === 'function') {
        window.miseAPI.getAppVersion().then((version) => {
            const badge = document.getElementById('MiseVersionBadge');
            if (badge && version) badge.textContent = `Mise Browser v${version}`;
        }).catch(() => {});
    }

    if (window.miseAPI && typeof window.miseAPI.signalRendererReady === 'function') {
        window.miseAPI.signalRendererReady();
    }
}

function setupEventListeners() {
    document.getElementById('theme-toggle-btn').addEventListener('click', toggleWebviewTheme);
    document.getElementById('toggle-nav-btn').addEventListener('click', displayAddressOverlay);
    document.getElementById('split-toggle-btn')?.addEventListener('click', () => toggleSplitView());
    document.getElementById('split-toggle-btn')?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        cycleSplitOrientation();
    });
    document.getElementById('back-btn').addEventListener('click', navigateFrameBack);
    document.getElementById('forward-btn').addEventListener('click', navigateFrameForward);
    document.getElementById('menu-btn').addEventListener('click', toggleDashboardView);

    document.getElementById('WelcomeNewTabBtn')?.addEventListener('click', spawnNewBlankTab);
    document.getElementById('WelcomeBookmarksBtn')?.addEventListener('click', toggleBookmarksOverlay);
    document.getElementById('WelcomePaletteBtn')?.addEventListener('click', toggleCommandPaletteView);
    document.getElementById('WelcomeNotesBtn')?.addEventListener('click', toggleNotesOverlay);
    
    document.getElementById('add-ws-btn').addEventListener('click', showWorkspaceInputDialog);
    document.getElementById('submit-ws-btn').addEventListener('click', processWorkspaceCreation);
    document.getElementById('cancel-ws-btn').addEventListener('click', hideWorkspaceInputDialog);
    
    document.getElementById('NewWorkspaceTitleInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') processWorkspaceCreation();
        else if (e.key === 'Escape') hideWorkspaceInputDialog();
    });
    
    const addressBar = document.getElementById('WideAddressBar');
    addressBar.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleNavigation(addressBar.value.trim());
        else if (e.key === 'Escape') {
            addressBar.style.display = 'none';
            hideSuggestions();
        }
    });

    addressBar.addEventListener('focus', () => {
        requestAnimationFrame(() => {
            addressBar.select();
        });
    });
	
    addressBar.addEventListener('mouseup', (e) => {
        if (document.activeElement === addressBar && addressBar.selectionStart !== addressBar.selectionEnd) {
            e.preventDefault();
        }
    });

    window.miseAPI.onMasterShortcut((action, ...args) => {
        switch (action) {
            case 'spawn-tab': spawnNewBlankTab(); break;
            case 'spawn-tab-with-url': spawnTabWithUrl(args[0]); break;
            case 'open-transient-share': openTransientShareModal(args[0]); break;
            case 'toggle-address': displayAddressOverlay(); break;
            case 'toggle-dashboard': toggleDashboardView(); break;
            case 'reload-active-tab': {
                const activeWv = getActiveWebview();
                if (activeWv) activeWv.reload();
                break;
            }
            case 'toggle-devtools': toggleActiveDevTools(); break;
            case 'toggle-bookmarks': toggleBookmarksOverlay(); break;
            case 'toggle-notes': toggleNotesOverlay(); break;
            case 'toggle-downloads': toggleDownloadShelf(); break;
            case 'toggle-find': toggleInPageSearch(); break;
            case 'remove-tab': handleTabRemoval(); break;
            case 'toggle-zen-mode': toggleSidebarExpansion(); break;
            case 'toggle-sidebar-collapse-mode': applySidebarMode(args[0]); break;
            case 'set-quickmark': promptQuickmark('set'); break;
            case 'jump-quickmark': promptQuickmark('jump'); break;
            case 'add-bookmark': addCurrentPageToBookmarks(); break;
            case 'toggle-global-media': toggleGlobalMediaPlayback(); break;
            case 'toggle-split': toggleSplitView(); break;
            case 'switch-split-focus': switchSplitFocus(); break;
            case 'swap-split-panes': swapSplitPanes(); break;
            case 'close-split': closeSplitView(); break;
            case 'delete-bookmark-entry': {
                if (state.bookmarksActive && state.filteredBookmarksCache[state.bookmarkSelectionIdx]) {
                    deleteBookmark(state.filteredBookmarksCache[state.bookmarkSelectionIdx].url);
                }
                break;
            }
            case 'focus-sidebar': {
                const activeEl = document.activeElement;
                const isInsideTabList = activeEl && (activeEl.closest('#TabList') || activeEl.id === 'TabList');
                const isInsideNavAction = activeEl && activeEl.closest('.nav-action-layout');
                const isInsideBottomLayout = activeEl && activeEl.closest('.bottom-theme-layout');

                if (isInsideTabList) {
                    const backBtn = document.getElementById('back-btn') || document.getElementById('toggle-nav-btn');
                    if (backBtn) backBtn.focus();
                } else if (isInsideNavAction || isInsideBottomLayout) {
                    const selectedTab = document.querySelector('#TabList li.selected') || document.querySelector('#TabList li');
                    if (selectedTab) selectedTab.focus();
                } else {
                    const selectedTab = document.querySelector('#TabList li.selected') || document.querySelector('#TabList li');
                    if (selectedTab) {
                        selectedTab.focus();
                    } else {
                        const navBtn = document.getElementById('back-btn') || document.getElementById('toggle-nav-btn');
                        if (navBtn) navBtn.focus();
                    }
                }
                break;
            }
            case 'focus-nav-buttons': {
                const backBtn = document.getElementById('back-btn') || document.getElementById('toggle-nav-btn');
                if (backBtn) backBtn.focus();
                break;
            }
            case 'focus-webview': focusActiveWebview(); break;
            case 'trigger-hints': triggerLinkHints(); break;
            case 'toggle-palette': toggleCommandPaletteView(); break;
            case 'toggle-help': togglePreferencesView(); break;
            case 'toggle-history': toggleHistoryOverlay(); break;
            case 'go-back':
            case 'go-back-signal': navigateFrameBack(); break;
            case 'go-forward':
            case 'go-forward-signal': navigateFrameForward(); break;
            case 'toggle-private-mode': {
                state.globalPrivateModeActive = args[0];
                handlePrivateBrowsingStateShift(state.globalPrivateModeActive);
                break;
            }
            case 'hibernate-inactive-tabs': hibernateInactiveTabs(); break;
        }
    });

    const paletteInput = document.getElementById('PaletteInput');
    paletteInput.addEventListener('input', (e) => {
        filterPaletteCommands(e.target.value);
    });

    paletteInput.addEventListener('keydown', handlePaletteInputNavigation);

    const pinSidebarBtn = document.getElementById('pin-sidebar-btn');
    if (pinSidebarBtn) {
        pinSidebarBtn.onclick = () => toggleSidebarPin();
    }

    const topNavIds = ['back-btn', 'forward-btn', 'toggle-nav-btn', 'menu-btn'];
    topNavIds.forEach((id, idx) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                const nextIdx = (idx + 1) % topNavIds.length;
                document.getElementById(topNavIds[nextIdx]).focus();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const prevIdx = (idx - 1 + topNavIds.length) % topNavIds.length;
                document.getElementById(topNavIds[prevIdx]).focus();
            } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
                e.preventDefault();
                const selectedTab = document.querySelector('#TabList li.selected') || document.querySelector('#TabList li');
                if (selectedTab) selectedTab.focus();
            } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
                e.preventDefault();
                const notiBtn = document.getElementById('noti-toggle-btn') || document.getElementById('pin-sidebar-btn');
                if (notiBtn) notiBtn.focus();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                const sidebar = document.getElementById('Sidebar');
                if (sidebar) sidebar.classList.remove('expanded');
                focusActiveWebview();
            }
        });
    });

    const bottomButtons = ['pin-sidebar-btn', 'theme-toggle-btn', 'noti-toggle-btn'];
    bottomButtons.forEach((id, idx) => {
        const btn = document.getElementById(id);
        if (!btn) return;

        btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey && idx < bottomButtons.length - 1)) {
                e.preventDefault();
                const nextBtn = document.getElementById(bottomButtons[idx + 1]);
                if (nextBtn) nextBtn.focus();
            } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey && idx > 0)) {
                e.preventDefault();
                const prevBtn = document.getElementById(bottomButtons[idx - 1]);
                if (prevBtn) prevBtn.focus();
            } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey && idx === 0)) {
                e.preventDefault();
                const selectedTab = document.querySelector('#TabList li.selected') || document.querySelector('#TabList li');
                if (selectedTab) {
                    selectedTab.focus();
                } else {
                    const backBtn = document.getElementById('back-btn');
                    if (backBtn) backBtn.focus();
                }
            } else if (e.key === 'Tab' && !e.shiftKey && idx === bottomButtons.length - 1) {
                e.preventDefault();
                const backBtn = document.getElementById('back-btn');
                if (backBtn) backBtn.focus();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                const sidebar = document.getElementById('Sidebar');
                if (sidebar) sidebar.classList.remove('expanded');
                focusActiveWebview();
            }
        });
    });

    const tabListContainer = document.getElementById('TabList');
    tabListContainer.addEventListener('keydown', (e) => {
        if (state.dashboardActive) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            const sidebar = document.getElementById('Sidebar');
            if (sidebar) sidebar.classList.remove('expanded');
            focusActiveWebview();
            return;
        }

        if (e.key === 'Tab') {
            e.preventDefault();
            if (e.shiftKey) {
                const backBtn = document.getElementById('back-btn') || document.getElementById('toggle-nav-btn');
                if (backBtn) backBtn.focus();
            } else {
                const pinBtn = document.getElementById('pin-sidebar-btn');
                if (pinBtn) pinBtn.focus();
            }
            return;
        }

        const tabItems = Array.from(document.querySelectorAll('#TabList li'));
        const activeListItem = document.querySelector('#TabList li.selected');
        let currentIdx = tabItems.indexOf(activeListItem);

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (currentIdx < tabItems.length - 1) {
                currentIdx++;
                switchTabFocus(currentIdx);
                document.querySelectorAll('#TabList li')[currentIdx].focus();
            } else {
                const pinBtn = document.getElementById('pin-sidebar-btn');
                if (pinBtn) pinBtn.focus();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (currentIdx > 0) {
                currentIdx--;
                switchTabFocus(currentIdx);
                document.querySelectorAll('#TabList li')[currentIdx].focus();
            } else {
                const backBtn = document.getElementById('back-btn') || document.getElementById('toggle-nav-btn');
                if (backBtn) backBtn.focus();
            }
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            const backBtn = document.getElementById('back-btn') || document.getElementById('toggle-nav-btn');
            if (backBtn) backBtn.focus();
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            focusActiveWebview();
        }
    });

    const findInput = document.getElementById('FindInput');
    if (findInput) {
        findInput.addEventListener('input', (e) => {
            const text = e.target.value;
            const activeWv = getActiveWebview();
            if (!activeWv) return;

            if (text.length > 0) {
                activeWv.findInPage(text);
            } else {
                activeWv.stopFindInPage('clearSelection');
                document.getElementById('FindMatchCount').textContent = '';
            }
        });

        findInput.addEventListener('keydown', (e) => {
            const activeWv = getActiveWebview();
            const isCtrl = e.control || e.metaKey;
            const key = e.key.toLowerCase();

            if (e.key === 'Escape' || (isCtrl && key === 's')) {
                e.preventDefault();
                toggleInPageSearch();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (!activeWv) return;
                activeWv.findInPage(findInput.value, { forward: !e.shiftKey, findNext: true });
            }
        });
    }

    const overlay = document.getElementById('DashboardOverlay');
    overlay.addEventListener('keydown', (e) => {
        if (!state.dashboardActive) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            toggleDashboardView();
            return;
        }

        if (state.dashboardItems.length === 0) return;
        if (document.activeElement === document.getElementById('NewWorkspaceTitleInput') || document.activeElement.classList.contains('dashboard-rename-input')) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            state.dashboardSelectionIdx = (state.dashboardSelectionIdx + 1) % state.dashboardItems.length;
            updateDashboardVisualSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            state.dashboardSelectionIdx = (state.dashboardSelectionIdx - 1 + state.dashboardItems.length) % state.dashboardItems.length;
            updateDashboardVisualSelection();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const targetItem = state.dashboardItems[state.dashboardSelectionIdx];
            if (targetItem) executeDashboardItemActivation(targetItem.payload);
        } else if (e.key === 'Delete') {
            e.preventDefault();
            handleTabRemoval();
        }
    });

    document.getElementById('Sidebar').addEventListener('focusout', (e) => {
        if (e.relatedTarget && !document.getElementById('Sidebar').contains(e.relatedTarget)) {
            if (state.dashboardActive || state.paletteActive || state.preferencesActive) return;
            
            if (e.relatedTarget.id === 'PaletteInput' || e.relatedTarget.id === 'PaletteList') return;
            if (e.relatedTarget.id === 'PreferencesOverlay' || document.getElementById('PreferencesOverlay')?.contains(e.relatedTarget)) return;

            if (window.miseAllowWebviewFocus) {
                window.miseAllowWebviewFocus = false;
                return;
            }
            e.preventDefault();
            const selectedTab = document.querySelector('#TabList li.selected');
            if (selectedTab) selectedTab.focus();
        }
    });

    const historySearchInput = document.getElementById('HistorySearchInput');
    historySearchInput.addEventListener('input', (e) => {
        filterHistoryItems(e.target.value.trim());
    });

    document.getElementById('CloseHistoryBtn').addEventListener('click', toggleHistoryOverlay);

    document.getElementById('PurgeHistoryBtn').addEventListener('click', async () => {
        const confirmPurge = confirm("Are you sure you want to permanently delete all history?");
        if (confirmPurge) {
            const success = await window.miseAPI.purgeHistory();
            if (success) {
                filterHistoryItems('');
            }
        }
    });

    document.getElementById('HistoryOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'HistoryOverlay') {
            toggleHistoryOverlay();
        }
    });

    loadBookmarksAndQuickmarks();
}

function handlePrivateBrowsingStateShift(isPrivate) {
    const sidebar = document.getElementById('Sidebar');
    if (isPrivate) {
        sidebar.style.borderRight = '2px solid #ff5555';
    } else {
        sidebar.style.borderRight = '1px solid var(--border)';
    }
    
    const currentWS = state.sessionState.current_workspace;
    if (state.activeViewsCache[currentWS]) {
        state.activeViewsCache[currentWS].forEach(wv => { if (wv) wv.remove(); });
        state.activeViewsCache[currentWS] = [];
    }
    
    const activeListItem = document.querySelector('#TabList li.selected');
    const currentIdx = activeListItem ? Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem) : 0;
    renderWorkspaceUI(currentIdx);
}

async function executeSurgicalCookieWipe() {
    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;

    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
    const urlStr = state.sessionState.workspaces[currentWS][currentIdx] || "";
    
    const isTargetPrivate = state.globalPrivateModeActive || urlStr.toLowerCase().includes("ycombinator.com");
    await window.miseAPI.clearDomainCookies({ urlStr, isPrivate: isTargetPrivate, workspace: currentWS });
    
    window.miseAllowWebviewFocus = true;
    focusActiveWebview();
}

async function executeGlobalCacheWipe() {
    const currentWS = state.sessionState.current_workspace;
    await window.miseAPI.clearActiveCache({ isPrivate: state.globalPrivateModeActive, workspace: currentWS });
    
    window.miseAllowWebviewFocus = true;
    focusActiveWebview();
}

function triggerLinkHints() {
    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (activeListItem) {
        const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
        const activeWv = state.activeViewsCache[currentWS]?.[currentIdx];
        if (activeWv && typeof activeWv.executeJavaScript === 'function') {
            activeWv.executeJavaScript("if (typeof window.toggleHints === 'function') { window.toggleHints(); }").catch(() => {});
        }
    }
}
  
let currentWebviewTheme = 'dark';

function updateWebviewThemeButtonUI(theme) {
    const button = document.getElementById('theme-toggle-btn');
    if (!button) return;
    if (theme === 'light') {
        button.innerHTML = '<i class="fa-solid fa-sun"></i>';
        button.title = 'Toggle Website Dark/Light Theme (Website Light active)';
    } else {
        button.innerHTML = '<i class="fa-solid fa-moon"></i>';
        button.title = 'Toggle Website Dark/Light Theme (Website Dark active)';
    }
}

let webviewThemeSaveTimer = null;

function toggleWebviewTheme() {
    currentWebviewTheme = (currentWebviewTheme === 'light') ? 'dark' : 'light';
    updateWebviewThemeButtonUI(currentWebviewTheme);

    const container = document.getElementById('webview-container');
    if (container) {
        container.classList.remove('theme-light', 'theme-dark');
        container.classList.add(currentWebviewTheme === 'light' ? 'theme-light' : 'theme-dark');
    }

    const activeView = getActiveWebview();
    if (activeView) {
        activeView.style.opacity = '0.75';
        setTimeout(() => {
            activeView.style.opacity = '1';
        }, 140);
    }

    if (window.miseAPI && typeof window.miseAPI.setNativeTheme === 'function') {
        window.miseAPI.setNativeTheme(currentWebviewTheme);
    }

    if (webviewThemeSaveTimer) clearTimeout(webviewThemeSaveTimer);
    webviewThemeSaveTimer = setTimeout(() => {
        if (window.miseAPI && typeof window.miseAPI.getBrowserSettings === 'function') {
            window.miseAPI.getBrowserSettings().then((cfg) => {
                const currentCfg = cfg || {};
                currentCfg.webview_theme = currentWebviewTheme;
                return window.miseAPI.updateBrowserSettings(currentCfg);
            }).catch(() => {});
        }
    }, 400);
}

function toggleInterfaceTheme() {
    const body = document.body;
    const isDark = body.classList.contains('dark-mode');
    const newTheme = isDark ? 'light' : 'dark';
    
    // Instantly swap UI classes on body
    if (newTheme === 'light') {
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
    } else {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
    }
    
    // Synchronously apply visual theme variables and sync inputs with zero latency
    applyThemeVisuals(null, newTheme);
    syncVisualSettingsInputs(null);

    // Keep Preferences checkbox switch in sync if open
    const themeToggle = document.getElementById('setting-theme-toggle');
    if (themeToggle) {
        themeToggle.checked = (newTheme === 'dark');
    }
    
    // Persist setting to disk asynchronously in the background without blocking the UI
    if (window.miseAPI && typeof window.miseAPI.getBrowserSettings === 'function') {
        window.miseAPI.getBrowserSettings().then((cfg) => {
            const currentCfg = cfg || {};
            currentCfg.theme = newTheme;
            return window.miseAPI.updateBrowserSettings(currentCfg);
        }).catch(() => {});
    }
}

document.getElementById('noti-toggle-btn').addEventListener('click', async () => {
    const btn = document.getElementById('noti-toggle-btn');
    const isMuted = !!btn.querySelector('.fa-bell-slash');
    const targetState = isMuted; // If muted, enable notifications; otherwise, mute

    if (window.miseAPI && typeof window.miseAPI.toggleGlobalNotifications === 'function') {
        await window.miseAPI.toggleGlobalNotifications(targetState);
    }

    if (targetState) {
        btn.innerHTML = '<i class="fa-solid fa-bell"></i>';
    } else {
        btn.innerHTML = '<i class="fa-solid fa-bell-slash"></i>';
    }

    window.miseAllowWebviewFocus = true;
    focusActiveWebview();
});

document.addEventListener('DOMContentLoaded', initializeBrowser);

function toggleInPageSearch() {
    const overlay = document.getElementById('FindBarOverlay');
    const input = document.getElementById('FindInput');
    const count = document.getElementById('FindMatchCount');
    
    findActive = !findActive;
    
    if (findActive) {
        overlay.style.display = 'flex';
        input.value = '';
        count.textContent = '';
        setTimeout(() => {
            input.focus();
            input.select();
        }, 20);
    } else {
        overlay.style.display = 'none';
        const activeWv = getActiveWebview();
        if (activeWv) {
            activeWv.stopFindInPage('clearSelection');
        }
        focusActiveWebview();
    }
}

function toggleActiveDevTools() {
    const activeWv = getActiveWebview();
    if (!activeWv) return;

    if (activeWv.isDevToolsOpened()) {
        activeWv.closeDevTools();
    } else {
        activeWv.openDevTools();
    }
}

function toggleZenMode() {
    document.body.classList.toggle('zen-mode');
}

export function applySidebarMode(autoCollapse) {
    const body = document.body;
    const pinBtn = document.getElementById('pin-sidebar-btn');
    if (autoCollapse) {
        body.classList.remove('sidebar-pinned');
        body.classList.add('sidebar-auto-collapse');
        if (pinBtn) pinBtn.classList.remove('pin-active');
    } else {
        body.classList.remove('sidebar-auto-collapse');
        body.classList.add('sidebar-pinned');
        if (pinBtn) pinBtn.classList.add('pin-active');
        const sidebar = document.getElementById('Sidebar');
        if (sidebar) sidebar.classList.remove('expanded');
    }
}

export function toggleSidebarExpansion() {
    const sidebar = document.getElementById('Sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('expanded');
    if (sidebar.classList.contains('expanded')) {
        const selectedTab = document.querySelector('#TabList li.selected');
        if (selectedTab) selectedTab.focus();
    } else {
        focusActiveWebview();
    }
}

export async function toggleSidebarPin() {
    const isCurrentlyPinned = document.body.classList.contains('sidebar-pinned');
    const newAutoCollapse = isCurrentlyPinned;
    applySidebarMode(newAutoCollapse);
    if (window.miseAPI && typeof window.miseAPI.getBrowserSettings === 'function') {
        try {
            const cfg = (await window.miseAPI.getBrowserSettings()) || {};
            cfg.sidebar_auto_collapse = newAutoCollapse;
            await window.miseAPI.updateBrowserSettings(cfg);
        } catch (e) {}
    }
}
