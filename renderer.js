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
    applyCSSThemeToView 
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
    populateBookmarksInPalette, 
    toggleCommandPaletteView, 
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

import { toggleHelpMenuWindow } from './modules/overlays/help.js';

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

// Attach functions needed across module boundaries to window
window.toggleDashboardView = toggleDashboardView;
window.displayAddressOverlay = displayAddressOverlay;
window.triggerLinkHints = triggerLinkHints;
window.toggleInPageSearch = toggleInPageSearch;
window.toggleNotesOverlay = toggleNotesOverlay;
window.toggleZenMode = toggleZenMode;
window.toggleInterfaceTheme = toggleInterfaceTheme;
window.toggleHelpMenuWindow = toggleHelpMenuWindow;
window.toggleHistoryOverlay = toggleHistoryOverlay;
window.handlePrivateBrowsingStateShift = handlePrivateBrowsingStateShift;
window.executeSurgicalCookieWipe = executeSurgicalCookieWipe;
window.executeGlobalCacheWipe = executeGlobalCacheWipe;
window.toggleActiveDevTools = toggleActiveDevTools;
window.toggleCommandPaletteView = toggleCommandPaletteView;
window.buildDashboardTree = buildDashboardTree;

let findActive = false;

async function initializeBrowser() {
    // Fix: mutate state.sessionState directly
    state.sessionState = await window.miseAPI.getSession();
    
    if (window.miseAPI && typeof window.miseAPI.setNativeTheme === 'function') {
        window.miseAPI.setNativeTheme(isDarkMode() ? 'dark' : 'light');
    }

    setupEventListeners();
    renderWorkspaceUI();
    setupNotesListeners();
    setupAddressBarAutocomplete();
    setupBookmarkOverlayListeners();
}

function setupEventListeners() {
    document.getElementById('theme-toggle-btn').addEventListener('click', toggleInterfaceTheme);
    document.getElementById('toggle-nav-btn').addEventListener('click', displayAddressOverlay);
    document.getElementById('back-btn').addEventListener('click', navigateFrameBack);
    document.getElementById('forward-btn').addEventListener('click', navigateFrameForward);
    document.getElementById('menu-btn').addEventListener('click', toggleDashboardView);
    
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
        else if (e.key === 'Escape') addressBar.style.display = 'none';
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
            case 'toggle-address': displayAddressOverlay(); break;
            case 'toggle-dashboard': toggleDashboardView(); break;
            case 'toggle-devtools': toggleActiveDevTools(); break;
            case 'toggle-bookmarks': toggleBookmarksOverlay(); break;
            case 'toggle-notes': toggleNotesOverlay(); break;
            case 'toggle-find': toggleInPageSearch(); break;
            case 'remove-tab': handleTabRemoval(); break;
            case 'toggle-zen-mode': toggleZenMode(); break;
            case 'set-quickmark': promptQuickmark('set'); break;
            case 'jump-quickmark': promptQuickmark('jump'); break;
            case 'add-bookmark': addCurrentPageToBookmarks(); break;
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
            case 'toggle-help': toggleHelpMenuWindow(); break;
            case 'toggle-history': toggleHistoryOverlay(); break;
            case 'go-back-signal': navigateFrameBack(); break;
            case 'go-forward-signal': navigateFrameForward(); break;
            case 'toggle-private-mode': {
                state.globalPrivateModeActive = args[0];
                handlePrivateBrowsingStateShift(state.globalPrivateModeActive);
                break;
            }
        }
    });

    const paletteInput = document.getElementById('PaletteInput');
    paletteInput.addEventListener('input', (e) => {
        filterPaletteCommands(e.target.value);
    });

    paletteInput.addEventListener('keydown', handlePaletteInputNavigation);
    document.getElementById('HelpMenuOverlay').addEventListener('keydown', (e) => {
        if (e.key === 'Escape') toggleHelpMenuWindow();
    });

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
        if (!state.dashboardActive || state.dashboardItems.length === 0) return;
        if (document.activeElement === document.getElementById('NewWorkspaceTitleInput')) return;

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
        }
    });

    document.getElementById('Sidebar').addEventListener('focusout', (e) => {
        if (e.relatedTarget && !document.getElementById('Sidebar').contains(e.relatedTarget)) {
            if (state.dashboardActive || state.paletteActive || state.helpActive) return;
            
            if (e.relatedTarget.id === 'PaletteInput' || e.relatedTarget.id === 'PaletteList') return;
            if (e.relatedTarget.id === 'HelpMenuOverlay' || e.relatedTarget.id === 'HelpMenuContent') return;

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

    loadBookmarksAndQuickmarks().then(() => {
        populateBookmarksInPalette();
    });
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
    const result = await window.miseAPI.clearDomainCookies({ urlStr, isPrivate: isTargetPrivate });
    alert(result);
}

async function executeGlobalCacheWipe() {
    const result = await window.miseAPI.clearActiveCache(state.globalPrivateModeActive);
    alert(result);
}

function triggerLinkHints() {
    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (activeListItem) {
        const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
        if (state.activeViewsCache[currentWS] && state.activeViewsCache[currentWS][currentIdx]) {
            try {
                state.activeViewsCache[currentWS][currentIdx].executeJavaScript("if (typeof window.toggleHints === 'function') { window.toggleHints(); }");
            } catch (err) {}
        }
    }
}
  
function toggleInterfaceTheme() {
    const body = document.body;
    const button = document.getElementById('theme-toggle-btn');
    const isDark = body.classList.contains('dark-mode');
    
    if (isDark) {
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
        button.innerHTML = '<i class="fa-solid fa-sun"></i>';
        if (window.miseAPI && typeof window.miseAPI.setNativeTheme === 'function') {
            window.miseAPI.setNativeTheme('light');
        }
    } else {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
        button.innerHTML = '<i class="fa-solid fa-moon"></i>';
        if (window.miseAPI && typeof window.miseAPI.setNativeTheme === 'function') {
            window.miseAPI.setNativeTheme('dark');
        }
    }
    
    const allWebviews = document.getElementById('webview-container').querySelectorAll('webview');
    allWebviews.forEach((webview) => {
        applyCSSThemeToView(webview);
    });
    
    if (state.helpActive) {
        const content = document.getElementById('HelpMenuContent');
        applyThemeToOverlayElement(content, "#124647", "#f5f6f9", "#c0caf5", "#3c3e4f");
    }
}

function enforceActiveGlobalThemeMode() {
    const allWebviews = document.getElementById('webview-container').querySelectorAll('webview');
    allWebviews.forEach((webview) => {
        try { applyCSSThemeToView(webview); } catch (err) {}
    });
}

document.getElementById('noti-toggle-btn').addEventListener('click', () => {
    const btn = document.getElementById('noti-toggle-btn');
    const isMuted = btn.querySelector('.fa-bell-slash');
    
    if (isMuted) {
        btn.innerHTML = '<i class="fa-solid fa-bell"></i>';
    } else {
        btn.innerHTML = '<i class="fa-solid fa-bell-slash"></i>';
    }
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
