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

// Attach functions needed across module boundaries to window
window.toggleDashboardView = toggleDashboardView;
window.displayAddressOverlay = displayAddressOverlay;
window.triggerLinkHints = triggerLinkHints;
window.toggleInPageSearch = toggleInPageSearch;
window.toggleNotesOverlay = toggleNotesOverlay;
window.toggleZenMode = toggleZenMode;
window.toggleInterfaceTheme = toggleInterfaceTheme;
window.togglePreferencesView = togglePreferencesView;
window.toggleHistoryOverlay = toggleHistoryOverlay;
window.handlePrivateBrowsingStateShift = handlePrivateBrowsingStateShift;
window.executeSurgicalCookieWipe = executeSurgicalCookieWipe;
window.executeGlobalCacheWipe = executeGlobalCacheWipe;
window.toggleActiveDevTools = toggleActiveDevTools;
window.toggleCommandPaletteView = toggleCommandPaletteView;
window.buildDashboardTree = buildDashboardTree;
window.toggleGlobalMediaPlayback = toggleGlobalMediaPlayback;

let findActive = false;

async function initializeBrowser() {
    state.sessionState = await window.miseAPI.getSession();
    
    // Restore cached titles and sleeping tab states if present
    if (state.sessionState.tab_titles) {
        state.activeTitlesCache = { ...state.sessionState.tab_titles };
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

    // Load persisted theme preference from configuration
    let savedTheme = 'dark';
    if (window.miseAPI && typeof window.miseAPI.getBrowserSettings === 'function') {
        try {
            const cfg = await window.miseAPI.getBrowserSettings();
            if (cfg && cfg.theme) {
                savedTheme = cfg.theme;
            }
        } catch (e) {}
    }

    const body = document.body;
    const button = document.getElementById('theme-toggle-btn');

    if (savedTheme === 'light') {
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
        if (button) button.innerHTML = '<i class="fa-solid fa-sun"></i>';
        if (window.miseAPI && typeof window.miseAPI.setNativeTheme === 'function') {
            window.miseAPI.setNativeTheme('light');
        }
    } else {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
        if (button) button.innerHTML = '<i class="fa-solid fa-moon"></i>';
        if (window.miseAPI && typeof window.miseAPI.setNativeTheme === 'function') {
            window.miseAPI.setNativeTheme('dark');
        }
    }

    setupEventListeners();
    renderWorkspaceUI();
    initializeTabSleepManager();
    setupNotesListeners();
    setupAddressBarAutocomplete();
    setupBookmarkOverlayListeners();
    initSearchEnginePreference();

    if (window.miseAPI && typeof window.miseAPI.signalRendererReady === 'function') {
        window.miseAPI.signalRendererReady();
    }
}

function setupEventListeners() {
    document.getElementById('theme-toggle-btn').addEventListener('click', toggleInterfaceTheme);
    document.getElementById('toggle-nav-btn').addEventListener('click', displayAddressOverlay);
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
            case 'toggle-find': toggleInPageSearch(); break;
            case 'remove-tab': handleTabRemoval(); break;
            case 'toggle-zen-mode': toggleZenMode(); break;
            case 'set-quickmark': promptQuickmark('set'); break;
            case 'jump-quickmark': promptQuickmark('jump'); break;
            case 'add-bookmark': addCurrentPageToBookmarks(); break;
            case 'toggle-global-media': toggleGlobalMediaPlayback(); break;
            case 'delete-bookmark-entry': {
                if (state.bookmarksActive && state.filteredBookmarksCache[state.bookmarkSelectionIdx]) {
                    deleteBookmark(state.filteredBookmarksCache[state.bookmarkSelectionIdx].url);
                }
                break;
            }
            case 'focus-sidebar': {
                const selectedTab = document.querySelector('#TabList li.selected');
                if (selectedTab) selectedTab.focus();
                else { const firstTab = document.querySelector('#TabList li'); if (firstTab) firstTab.focus(); }
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
                const selectedTab = document.querySelector('#TabList li.selected');
                if (selectedTab) selectedTab.focus();
                else {
                    const firstTab = document.querySelector('#TabList li');
                    if (firstTab) firstTab.focus();
                }
            }
        });
    });

    const bottomButtons = ['theme-toggle-btn', 'noti-toggle-btn'];
    bottomButtons.forEach((id, idx) => {
        const btn = document.getElementById(id);
        if (!btn) return;

        btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey && id === 'theme-toggle-btn')) {
                e.preventDefault();
                const nextBtn = document.getElementById('noti-toggle-btn');
                if (nextBtn) nextBtn.focus();
            } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey && id === 'noti-toggle-btn')) {
                e.preventDefault();
                const prevBtn = document.getElementById('theme-toggle-btn');
                if (prevBtn) prevBtn.focus();
            } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey && id === 'theme-toggle-btn')) {
                e.preventDefault();
                const tabItems = Array.from(document.querySelectorAll('#TabList li'));
                if (tabItems.length > 0) {
                    tabItems[tabItems.length - 1].focus();
                }
            } else if (e.key === 'Tab' && !e.shiftKey && id === 'noti-toggle-btn') {
                e.preventDefault();
                const backBtn = document.getElementById('back-btn');
                if (backBtn) backBtn.focus();
            }
        });
    });

    const tabListContainer = document.getElementById('TabList');
    tabListContainer.addEventListener('keydown', (e) => {
        if (state.dashboardActive) return;
        const tabItems = Array.from(document.querySelectorAll('#TabList li'));
        const activeListItem = document.querySelector('#TabList li.selected');
        let currentIdx = tabItems.indexOf(activeListItem);

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (currentIdx < tabItems.length - 1) {
                currentIdx++;
                switchTabFocus(currentIdx);
                document.querySelectorAll('#TabList li')[currentIdx].focus();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (currentIdx > 0) {
                currentIdx--;
                switchTabFocus(currentIdx);
                document.querySelectorAll('#TabList li')[currentIdx].focus();
            }
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
  
async function toggleInterfaceTheme() {
    const body = document.body;
    const button = document.getElementById('theme-toggle-btn');
    const isDark = body.classList.contains('dark-mode');
    let newTheme = 'dark';
    
    if (isDark) {
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
        button.innerHTML = '<i class="fa-solid fa-sun"></i>';
        newTheme = 'light';
        if (window.miseAPI && typeof window.miseAPI.setNativeTheme === 'function') {
            window.miseAPI.setNativeTheme('light');
        }
    } else {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
        button.innerHTML = '<i class="fa-solid fa-moon"></i>';
        newTheme = 'dark';
        if (window.miseAPI && typeof window.miseAPI.setNativeTheme === 'function') {
            window.miseAPI.setNativeTheme('dark');
        }
    }
    
    if (window.miseAPI && typeof window.miseAPI.updateBrowserSettings === 'function') {
        try {
            const cfg = await window.miseAPI.getBrowserSettings();
            cfg.theme = newTheme;
            await window.miseAPI.updateBrowserSettings(cfg);
        } catch (err) {}
    }
    
    const allWebviews = document.getElementById('webview-container').querySelectorAll('webview');
    allWebviews.forEach((webview) => {
        applyCSSThemeToView(webview);
    });
}

function enforceActiveGlobalThemeMode() {
    const allWebviews = document.getElementById('webview-container').querySelectorAll('webview');
    allWebviews.forEach((webview) => {
        try { applyCSSThemeToView(webview); } catch (err) {}
    });
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
