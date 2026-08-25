import { state } from '../state.js';
import { focusActiveWebview, isTargetScript, isDarkMode } from '../utils.js';
import { renderWorkspaceUI, switchTabFocus, spawnTabWithUrl, spawnNewBlankTab, handleTabRemoval } from '../webview.js';
import { toggleBookmarksOverlay } from './bookmarks.js';

function returnFocusToWebview() {
    window.miseAllowWebviewFocus = true;
    focusActiveWebview();
}

export const commandRegistry = {
    "New DuckDuckGo Tab": () => spawnNewBlankTab(),
    "Toggle Workspace Dashboard": () => window.toggleDashboardView && window.toggleDashboardView(),
    "Toggle Floating Address Bar": () => window.displayAddressOverlay && window.displayAddressOverlay(),
    "Toggle Link Hints Overlay": () => window.triggerLinkHints && window.triggerLinkHints(),
    "Find In Page": () => window.toggleInPageSearch && window.toggleInPageSearch(),
    "Toggle Bookmarks Manager": () => toggleBookmarksOverlay(),
    "Toggle Quick Notes": () => window.toggleNotesOverlay && window.toggleNotesOverlay(),
    "Toggle Zen Mode (Hide Sidebar)": () => window.toggleZenMode && window.toggleZenMode(),
    "Open Preferences": () => togglePreferencesView(),
    "Toggle Actionable History": () => window.toggleHistoryOverlay && window.toggleHistoryOverlay(),
    "Mute/Unmute Active Tab": () => {
        const currentWS = state.sessionState.current_workspace;
        const activeListItem = document.querySelector('#TabList li.selected');
        if (!activeListItem) return;
        const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
        const activeWv = state.activeViewsCache[currentWS]?.[currentIdx];
        if (activeWv) activeWv.setAudioMuted(!activeWv.isAudioMuted());
    },
    "Reset Tab Zoom Level": () => {
        const currentWS = state.sessionState.current_workspace;
        const activeListItem = document.querySelector('#TabList li.selected');
        if (!activeListItem) return;
        const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
        const activeWv = state.activeViewsCache[currentWS]?.[currentIdx];
        if (activeWv) activeWv.setZoomLevel(0);
    },
    "Toggle Active Webview DevTools": () => window.toggleActiveDevTools && window.toggleActiveDevTools()
};

let preferencesActive = false;

export async function syncPreferencesUI() {
    if (!window.miseAPI || typeof window.miseAPI.getBrowserSettings !== 'function') return;

    try {
        const cfg = await window.miseAPI.getBrowserSettings();
        if (cfg) {
            const gpuToggle = document.getElementById('setting-gpu-toggle');
            const throttleToggle = document.getElementById('setting-throttling-toggle');
            const processSelect = document.getElementById('setting-process-limit');
            const emailSelect = document.getElementById('setting-email-handler');

            if (gpuToggle) gpuToggle.checked = !cfg.disable_gpu;
            if (throttleToggle) throttleToggle.checked = !!cfg.background_throttling;
            if (processSelect) processSelect.value = String(cfg.process_limit || 3);
            if (emailSelect) emailSelect.value = cfg.email_handler || 'system';
        }
    } catch (err) {}

    const themeToggle = document.getElementById('setting-theme-toggle');
    if (themeToggle) themeToggle.checked = document.body.classList.contains('dark-mode');

    const privateToggle = document.getElementById('setting-private-toggle');
    if (privateToggle) privateToggle.checked = !!state.globalPrivateModeActive;
}

export function setupPreferencesListeners() {
    const closeBtn = document.getElementById('CloseSettingsBtn');
    if (closeBtn) {
        closeBtn.onclick = (e) => {
            e.preventDefault();
            togglePreferencesView();
        };
    }

    const overlay = document.getElementById('PreferencesOverlay');
    if (overlay) {
        overlay.onkeydown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                togglePreferencesView();
            }
        };
    }

    const themeToggle = document.getElementById('setting-theme-toggle');
    if (themeToggle) {
        themeToggle.onchange = () => {
            if (window.toggleInterfaceTheme) window.toggleInterfaceTheme();
        };
    }

    const saveBtn = document.getElementById('setting-save-config-btn');
    if (saveBtn) {
        saveBtn.onclick = async () => {
            const gpuToggle = document.getElementById('setting-gpu-toggle');
            const throttleToggle = document.getElementById('setting-throttling-toggle');
            const processSelect = document.getElementById('setting-process-limit');
            const emailSelect = document.getElementById('setting-email-handler');

            const newCfg = {
                disable_gpu: gpuToggle ? !gpuToggle.checked : false,
                background_throttling: throttleToggle ? throttleToggle.checked : true,
                process_limit: processSelect ? parseInt(processSelect.value, 10) : 3,
                email_handler: emailSelect ? emailSelect.value : 'system'
            };

            if (window.miseAPI && typeof window.miseAPI.saveBrowserSettings === 'function') {
                await window.miseAPI.saveBrowserSettings(newCfg);
            }
        };
    }

    const privateToggle = document.getElementById('setting-private-toggle');
    if (privateToggle) {
        privateToggle.onchange = (e) => {
            state.globalPrivateModeActive = e.target.checked;
            if (window.handlePrivateBrowsingStateShift) {
                window.handlePrivateBrowsingStateShift(state.globalPrivateModeActive);
            }
        };
    }

    const clearCookiesBtn = document.getElementById('setting-clear-cookies-btn');
    if (clearCookiesBtn) {
        clearCookiesBtn.onclick = () => {
            if (window.executeSurgicalCookieWipe) window.executeSurgicalCookieWipe();
        };
    }

    const clearCacheBtn = document.getElementById('setting-clear-cache-btn');
    if (clearCacheBtn) {
        clearCacheBtn.onclick = () => {
            if (window.executeGlobalCacheWipe) window.executeGlobalCacheWipe();
        };
    }
}

export async function togglePreferencesView() {
    const overlay = document.getElementById('PreferencesOverlay');
    if (!overlay) return;

    preferencesActive = !preferencesActive;
    if (preferencesActive) {
        if (state.paletteActive) toggleCommandPaletteView();
        if (state.dashboardActive) document.getElementById('DashboardOverlay').style.display = 'none';

        overlay.style.display = 'block';
        await syncPreferencesUI();
        overlay.focus();
    } else {
        overlay.style.display = 'none';
        returnFocusToWebview();
    }
}

export function toggleCommandPaletteView() {
    const overlay = document.getElementById('CommandPaletteOverlay');
    const input = document.getElementById('PaletteInput');
    
    state.paletteActive = !state.paletteActive;
    if (state.paletteActive) {
        if (preferencesActive) togglePreferencesView();
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
        returnFocusToWebview();
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
        returnFocusToWebview();
        return;
    }

    if (!rawInputText) {
        returnFocusToWebview();
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
    returnFocusToWebview();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupPreferencesListeners);
} else {
    setupPreferencesListeners();
}
