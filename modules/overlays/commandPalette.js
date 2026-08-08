import { state } from '../state.js';
import { focusActiveWebview, isTargetScript } from '../utils.js';
import { renderWorkspaceUI, switchTabFocus, spawnTabWithUrl, spawnNewBlankTab, handleTabRemoval } from '../webview.js';
import { toggleBookmarksOverlay } from './bookmarks.js';

export const commandRegistry = {
    "Toggle Workspace Dashboard": () => window.toggleDashboardView && window.toggleDashboardView(),
    "New DuckDuckGo Tab": () => spawnNewBlankTab(),
    "Toggle Floating Address Bar": () => window.displayAddressOverlay && window.displayAddressOverlay(),
    "Toggle Link Hints Overlay": () => window.triggerLinkHints && window.triggerLinkHints(),
    "Find In Page": () => window.toggleInPageSearch && window.toggleInPageSearch(),
    "Toggle Bookmarks Manager": () => toggleBookmarksOverlay(),
    "Toggle Quick Notes": () => window.toggleNotesOverlay && window.toggleNotesOverlay(),
    "Toggle Zen Mode (Hide Sidebar)": () => window.toggleZenMode && window.toggleZenMode(),
    "Focus Sidebar Tab List": () => {
        const backBtn = document.getElementById('back-btn');
        if (backBtn) {
            backBtn.focus();
        } else {
            const selectedTab = document.querySelector('#TabList li.selected');
            if (selectedTab) selectedTab.focus();
        }
    },
    "Focus Active Webview": () => focusActiveWebview(),
    "Mute/Unmute Active Tab": () => {
        const currentWS = state.sessionState.current_workspace;
        const activeListItem = document.querySelector('#TabList li.selected');
        if (!activeListItem) return;
        const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
        const activeWv = state.activeViewsCache[currentWS]?.[currentIdx];
        
        if (activeWv) {
            const isMuted = activeWv.isAudioMuted();
            activeWv.setAudioMuted(!isMuted);
        }
    },
    "Reset Tab Zoom Level": () => {
        const currentWS = state.sessionState.current_workspace;
        const activeListItem = document.querySelector('#TabList li.selected');
        if (!activeListItem) return;
        const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
        const activeWv = state.activeViewsCache[currentWS]?.[currentIdx];
        
        if (activeWv) {
            activeWv.setZoomLevel(0);
        }
    },
    "Toggle Light/Dark Layout": () => window.toggleInterfaceTheme && window.toggleInterfaceTheme(),
    "Show Shortcuts Reference": () => window.toggleHelpMenuWindow && window.toggleHelpMenuWindow(),
    "Toggle Actionable History": () => window.toggleHistoryOverlay && window.toggleHistoryOverlay(),
    "Toggle Private Browsing": () => {
        state.globalPrivateModeActive = !state.globalPrivateModeActive;
        if (window.handlePrivateBrowsingStateShift) {
            window.handlePrivateBrowsingStateShift(state.globalPrivateModeActive);
        }
    },
    "Force Reload Page (Clear Cache)": () => {
        const currentWS = state.sessionState.current_workspace;
        const activeListItem = document.querySelector('#TabList li.selected');
        if (!activeListItem) return;
        const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
        const activeWv = state.activeViewsCache[currentWS]?.[currentIdx];
        
        if (activeWv) {
            activeWv.reloadIgnoringCache();
        }
    },
    "Clear Current Site Cookies": () => window.executeSurgicalCookieWipe && window.executeSurgicalCookieWipe(),
    "Clear Active Profile Cache": () => window.executeGlobalCacheWipe && window.executeGlobalCacheWipe(),
    "Toggle Active Webview DevTools": () => window.toggleActiveDevTools && window.toggleActiveDevTools()
};

export function populateBookmarksInPalette() {
    if (!state.bookmarks) return;
    state.bookmarks.forEach(bm => {
        const cmdKey = `Bookmark: ${bm.title}`;
        commandRegistry[cmdKey] = () => spawnTabWithUrl(bm.url);
    });
}

export function toggleCommandPaletteView() {
    const overlay = document.getElementById('CommandPaletteOverlay');
    const input = document.getElementById('PaletteInput');
    
    state.paletteActive = !state.paletteActive;
    if (state.paletteActive) {
        if (state.helpActive) {
            state.helpActive = false;
            document.getElementById('HelpMenuOverlay').style.display = 'none';
        }
        if (state.dashboardActive) {
            state.dashboardActive = false;
            document.getElementById('DashboardOverlay').style.display = 'none';
        }
        overlay.style.display = 'flex';
        input.value = '';
        filterPaletteCommands('');
        input.focus();
    } else {
        overlay.style.display = 'none';
        focusActiveWebview();
    }
}

export function filterPaletteCommands(filterText) {
    const search = filterText.toLowerCase();
    state.paletteMatches = Object.keys(commandRegistry).filter(cmd => cmd.toLowerCase().includes(search));
    
    const listContainer = document.getElementById('PaletteList');
    listContainer.innerHTML = '';
    
    state.paletteMatches.forEach((cmd, idx) => {
        const li = document.createElement('li');
        li.className = 'palette-item';
        li.textContent = cmd;
        li.addEventListener('click', () => {
            state.paletteSelectionIdx = idx; 
            executePaletteSelection(document.getElementById('PaletteInput').value.trim());
        });
        listContainer.appendChild(li);
    });
    
    state.paletteSelectionIdx = 0;
    updatePaletteVisualSelection();
}

export function updatePaletteVisualSelection() {
    const items = document.querySelectorAll('#PaletteList li');
    items.forEach((item, idx) => {
        if (idx === state.paletteSelectionIdx) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

export function handlePaletteInputNavigation(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        toggleCommandPaletteView();
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (state.paletteMatches.length > 0) {
            state.paletteSelectionIdx = (state.paletteSelectionIdx + 1) % state.paletteMatches.length;
            updatePaletteVisualSelection();
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (state.paletteMatches.length > 0) {
            state.paletteSelectionIdx = (state.paletteSelectionIdx - 1 + state.paletteMatches.length) % state.paletteMatches.length;
            updatePaletteVisualSelection();
        }
    } else if (e.key === 'Enter') {
        e.preventDefault();
        executePaletteSelection(document.getElementById('PaletteInput').value.trim());
    }
}

export function executePaletteSelection(rawInputText) {
    const targetCommand = state.paletteMatches[state.paletteSelectionIdx];
    
    state.paletteActive = false;
    document.getElementById('CommandPaletteOverlay').style.display = 'none';

    if (targetCommand && commandRegistry[targetCommand]) {
        commandRegistry[targetCommand]();
        return;
    }

    if (!rawInputText) {
        focusActiveWebview();
        return;
    }

    let finalCommandToCopy = rawInputText;
    const lowerInput = rawInputText.toLowerCase();

    const isRawWebUrl = lowerInput.startsWith('http://') || lowerInput.startsWith('https://');
    const isDangerousSysCall = lowerInput.startsWith('sudo ') || lowerInput.startsWith('curl ') || lowerInput.startsWith('wget ');

    if (isTargetScript(rawInputText) || isRawWebUrl || isDangerousSysCall) {
        finalCommandToCopy = `oversight ${rawInputText}`;
    }

    window.miseAPI.executeTerminalCommand(finalCommandToCopy);
    focusActiveWebview();
}
