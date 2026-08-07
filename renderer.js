let sessionState = {
    current_workspace: "Workspace 1",
    workspaces: { "Workspace 1": ["https://duckduckgo.com"] }
};

const activeViewsCache = {};
const activeTitlesCache = {};
let dashboardActive = false;
let dashboardItems = [];
let dashboardSelectionIdx = 0;

let paletteActive = false;
let helpActive = false;
let paletteMatches = [];
let paletteSelectionIdx = 0;

let historyActive = false; // Tracks whether the history overlay is open
let historyResults = [];   // Stores the currently loaded search results

let globalPrivateModeActive = false;

let notesActive = false;
let notesSaveTimeout = null;
let isEditingNotes = false;

let addressSuggestions = [];
let addressSelectionIdx = -1;

// --- GLOBAL UTILITY HELPERS ---
// Returns true if the browser interface is currently in dark mode
const isDarkMode = () => document.body.classList.contains('dark-mode');

// Updates an element's background and text color based on the current theme
function applyThemeToOverlayElement(element, darkBg, lightBg, darkText, lightText) {
    if (!element) return;
    const dark = isDarkMode();
    element.style.backgroundColor = dark ? darkBg : lightBg;
    element.style.color = dark ? darkText : lightText;
}

const commandRegistry = {
	"Toggle Workspace Dashboard": () => toggleDashboardView(),
    "New DuckDuckGo Tab": () => spawnNewBlankTab(),
    "Toggle Floating Address Bar": () => displayAddressOverlay(),
    "Toggle Link Hints Overlay": () => triggerLinkHints(),
    "Find In Page": () => toggleInPageSearch(),
    "Toggle Quick Notes": () => toggleNotesOverlay(),
    "Toggle Zen Mode (Hide Sidebar)": () => toggleZenMode(),
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
        const currentWS = sessionState.current_workspace;
        const activeListItem = document.querySelector('#TabList li.selected');
        if (!activeListItem) return;
        const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
        const activeWv = activeViewsCache[currentWS]?.[currentIdx];
        
        if (activeWv) {
            const isMuted = activeWv.isAudioMuted();
            activeWv.setAudioMuted(!isMuted);
        }
    },
    "Reset Tab Zoom Level": () => {
        const currentWS = sessionState.current_workspace;
        const activeListItem = document.querySelector('#TabList li.selected');
        if (!activeListItem) return;
        const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
        const activeWv = activeViewsCache[currentWS]?.[currentIdx];
        
        if (activeWv) {
            activeWv.setZoomLevel(0); // 0 acts as the native 100% zoom standard in Electron
        }
    },
    "Toggle Light/Dark Layout": () => toggleInterfaceTheme(),
    "Show Shortcuts Reference": () => toggleHelpMenuWindow(),
    "Toggle Actionable History": () => toggleHistoryOverlay(),
    "Toggle Private Browsing": () => {
        globalPrivateModeActive = !globalPrivateModeActive;
        handlePrivateBrowsingStateShift(globalPrivateModeActive);
    },
    "Force Reload Page (Clear Cache)": () => {
        const currentWS = sessionState.current_workspace;
        const activeListItem = document.querySelector('#TabList li.selected');
        if (!activeListItem) return;
        const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
        const activeWv = activeViewsCache[currentWS]?.[currentIdx];
        
        if (activeWv) {
            activeWv.reloadIgnoringCache();
        }
    },
    "Clear Current Site Cookies": () => executeSurgicalCookieWipe(),
    "Clear Active Profile Cache": () => executeGlobalCacheWipe(),
    "Toggle Active Webview DevTools": () => toggleActiveDevTools()
};

async function initializeBrowser() {
    sessionState = await window.miseAPI.getSession();
    
    // Broadcast native theme state directly to Electron on startup
    if (window.miseAPI && typeof window.miseAPI.setNativeTheme === 'function') {
        window.miseAPI.setNativeTheme(isDarkMode() ? 'dark' : 'light');
    }

    setupEventListeners();
    renderWorkspaceUI();
    setupNotesListeners();
    setupAddressBarAutocomplete();
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

	// Select all text automatically when focusing via trackpad click
    addressBar.addEventListener('focus', () => {
        requestAnimationFrame(() => {
            addressBar.select();
        });
    });
	
    // Prevent mouseup from clearing the selection when clicking into the address bar
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
            case 'toggle-notes': toggleNotesOverlay(); break;
            case 'toggle-find': toggleInPageSearch(); break;
            case 'remove-tab': handleTabRemoval(); break;
            case 'toggle-zen-mode': toggleZenMode(); break;
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
                globalPrivateModeActive = args[0];
                handlePrivateBrowsingStateShift(globalPrivateModeActive);
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

	// --- HORIZONTAL NAVIGATION FOR TOP BUTTONS ---
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
                // Drop straight down into the active workspace tab list
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

    // --- KEYBOARD FLOW FOR BOTTOM UTILITY BUTTONS ---
    const bottomButtons = ['theme-toggle-btn', 'noti-toggle-btn'];
    bottomButtons.forEach((id, idx) => {
        const btn = document.getElementById(id);
        if (!btn) return;

        btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey && id === 'theme-toggle-btn')) {
                // Move right to notifications
                e.preventDefault();
                const nextBtn = document.getElementById('noti-toggle-btn');
                if (nextBtn) nextBtn.focus();
            } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey && id === 'noti-toggle-btn')) {
                // Move left to theme
                e.preventDefault();
                const prevBtn = document.getElementById('theme-toggle-btn');
                if (prevBtn) prevBtn.focus();
            } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey && id === 'theme-toggle-btn')) {
                // Shift+Tab or Up arrow jumps back to the last active tab in the list
                e.preventDefault();
                const tabItems = Array.from(document.querySelectorAll('#TabList li'));
                if (tabItems.length > 0) {
                    tabItems[tabItems.length - 1].focus();
                }
            } else if (e.key === 'Tab' && !e.shiftKey && id === 'noti-toggle-btn') {
                // Wrap focus all the way back up to the top Back Button
                e.preventDefault();
                const backBtn = document.getElementById('back-btn');
                if (backBtn) backBtn.focus();
            }
        });
    });

    const tabListContainer = document.getElementById('TabList');
    tabListContainer.addEventListener('keydown', (e) => {
        if (dashboardActive) return;
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
        if (!dashboardActive || dashboardItems.length === 0) return;
        if (document.activeElement === document.getElementById('NewWorkspaceTitleInput')) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            dashboardSelectionIdx = (dashboardSelectionIdx + 1) % dashboardItems.length;
            updateDashboardVisualSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            dashboardSelectionIdx = (dashboardSelectionIdx - 1 + dashboardItems.length) % dashboardItems.length;
            updateDashboardVisualSelection();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const targetItem = dashboardItems[dashboardSelectionIdx];
            if (targetItem) executeDashboardItemActivation(targetItem.payload);
        }
    });

    document.getElementById('Sidebar').addEventListener('focusout', (e) => {
        if (e.relatedTarget && !document.getElementById('Sidebar').contains(e.relatedTarget)) {
            if (dashboardActive || paletteActive || helpActive) return;
            
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

    // --- History Overlay Event Listeners ---
    const historySearchInput = document.getElementById('HistorySearchInput');
    
    // Trigger live search as you type
    historySearchInput.addEventListener('input', (e) => {
        filterHistoryItems(e.target.value.trim());
    });

    // Close button click
    document.getElementById('CloseHistoryBtn').addEventListener('click', toggleHistoryOverlay);

    // Purge button click (with confirmation)
    document.getElementById('PurgeHistoryBtn').addEventListener('click', async () => {
        const confirmPurge = confirm("Are you sure you want to permanently delete all history?");
        if (confirmPurge) {
            const success = await window.miseAPI.purgeHistory();
            if (success) {
                filterHistoryItems(''); // Refresh with empty state
            }
        }
    });

    // Close overlay if the background is clicked
    document.getElementById('HistoryOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'HistoryOverlay') {
            toggleHistoryOverlay();
        }
    });
}

function handlePrivateBrowsingStateShift(isPrivate) {
    const sidebar = document.getElementById('Sidebar');
    if (isPrivate) {
        sidebar.style.borderRight = '2px solid #ff5555';
    } else {
        sidebar.style.borderRight = '1px solid var(--border)';
    }
    
    const currentWS = sessionState.current_workspace;
    if (activeViewsCache[currentWS]) {
        activeViewsCache[currentWS].forEach(wv => { if (wv) wv.remove(); });
        activeViewsCache[currentWS] = [];
    }
    
    const activeListItem = document.querySelector('#TabList li.selected');
    const currentIdx = activeListItem ? Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem) : 0;
    renderWorkspaceUI(currentIdx);
}

async function executeSurgicalCookieWipe() {
    const currentWS = sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;

    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
    const urlStr = sessionState.workspaces[currentWS][currentIdx] || "";
    
    const isTargetPrivate = globalPrivateModeActive || urlStr.toLowerCase().includes("ycombinator.com");
    const result = await window.miseAPI.clearDomainCookies({ urlStr, isPrivate: isTargetPrivate });
    alert(result);
}

async function executeGlobalCacheWipe() {
    const result = await window.miseAPI.clearActiveCache(globalPrivateModeActive);
    alert(result);
}

function toggleCommandPaletteView() {
    const overlay = document.getElementById('CommandPaletteOverlay');
    const input = document.getElementById('PaletteInput');
    
    paletteActive = !paletteActive;
    if (paletteActive) {
        if (helpActive) {
            helpActive = false;
            document.getElementById('HelpMenuOverlay').style.display = 'none';
        }
        if (dashboardActive) {
            dashboardActive = false;
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

function filterPaletteCommands(filterText) {
    const search = filterText.toLowerCase();
    paletteMatches = Object.keys(commandRegistry).filter(cmd => cmd.toLowerCase().includes(search));
    
    const listContainer = document.getElementById('PaletteList');
    listContainer.innerHTML = '';
    
    paletteMatches.forEach((cmd, idx) => {
        const li = document.createElement('li');
        li.className = 'palette-item';
        li.textContent = cmd;
        li.addEventListener('click', () => {
            paletteSelectionIdx = idx; 
            executePaletteSelection(document.getElementById('PaletteInput').value.trim());
        });
        listContainer.appendChild(li);
    });
    
    paletteSelectionIdx = 0;
    updatePaletteVisualSelection();
}

function updatePaletteVisualSelection() {
    const items = document.querySelectorAll('#PaletteList li');
    items.forEach((item, idx) => {
        if (idx === paletteSelectionIdx) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

// --- Oversight Security Scanner Section ---
const SCRIPT_EXTENSIONS = [
    ".sh", ".bash", ".zsh", ".ksh", ".csh", ".fish", ".local",
    ".py", ".pyw", ".pl", ".rb", ".lua", ".tcl", ".pyi",
    ".c", ".cpp", ".cc", ".h", ".hpp", ".rs", ".go", ".js", ".ts"
];

function isTargetScript(inputText) {
    if (!inputText) return false;
    const lowerInput = inputText.toLowerCase();
    return SCRIPT_EXTENSIONS.some(ext => lowerInput.endsWith(ext));
}

function handlePaletteInputNavigation(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        toggleCommandPaletteView();
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (paletteMatches.length > 0) {
            paletteSelectionIdx = (paletteSelectionIdx + 1) % paletteMatches.length;
            updatePaletteVisualSelection();
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (paletteMatches.length > 0) {
            paletteSelectionIdx = (paletteSelectionIdx - 1 + paletteMatches.length) % paletteMatches.length;
            updatePaletteVisualSelection();
        }
    } else if (e.key === 'Enter') {
        e.preventDefault();
        executePaletteSelection(document.getElementById('PaletteInput').value.trim());
    }
}

function executePaletteSelection(rawInputText) {
    const targetCommand = paletteMatches[paletteSelectionIdx];
    
    paletteActive = false;
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

function toggleHelpMenuWindow() {
    const overlay = document.getElementById('HelpMenuOverlay');
    const content = document.getElementById('HelpMenuContent');
    
    helpActive = !helpActive;
    if (helpActive) {
        if (paletteActive) {
            paletteActive = false;
            document.getElementById('CommandPaletteOverlay').style.display = 'none';
        }
        if (dashboardActive) {
            dashboardActive = false;
            document.getElementById('DashboardOverlay').style.display = 'none';
        }
        
        // Use our clean utility helper instead of manual color definitions
        applyThemeToOverlayElement(content, "#124647", "#f5f6f9", "#c0caf5", "#3c3e4f");
        
        content.innerHTML = `Mise Browser — v0.1.5\n==================================================\n
NAVIGATION & WORKSPACES
--------------------------------------------------
Ctrl + T           New DuckDuckGo Tab
Ctrl + L           Toggle Floating Address Bar
Ctrl + W           Close Current Tab (or Node)
Ctrl + Shift + W   Toggle Workspace Dashboard
Ctrl + S           Quick Save Active Workspace
Ctrl + R           Reload Active Tab
Ctrl + D           Quick Remove Current
Ctrl + M           Focus Sidebar Tab List
Ctrl + B           Focus Active Webview
Enter              Switch to Selected Sidebar Tab
Ctrl + P           Toggle Command Palette
Ctrl + Shift + P   Toggle Private Browsing Mode On/Off
Ctrl + N           Open Notes Taking Overlay
Ctrl + Shift + Tab Focus sidebar nav buttons
Ctrl + Shift + Z   Hide/Unhide Sidebar

WEB INTERACTION
--------------------------------------------------
Ctrl + F           Toggle Link Hints Overlay
Right Click        Contextual Actions + (Arch Wiki)
Ctrl + Shift + i   Toggle DevTools

SIDEBAR CONTROLS
--------------------------------------------------
Arrow Keys L/R     Move around the nav buttons
Sun/Moon Icon      Toggle Light/Dark Layout
Bell Icon          Toggle Web Notifications

SEARCH BAR ALIASSES
--------------------------------------------------
g                  https://www.google.com/search?q=
yt                 https://www.youtube.com/results?search_query=
a                  https://wiki.archlinux.org/index.php?search=
gh                 https://github.com/search?q=
ddg                https://duckduckgo.com/?q=
pkg                https://archlinux.org/packages/?q=
so                 https://stackoverflow.com/search?q=
r                  https://www.reddit.com/search/?q=`;
        
        overlay.style.display = 'flex';
        overlay.focus();
    } else {
        overlay.style.display = 'none';
        focusActiveWebview();
    }
}

function focusActiveWebview() {
    const currentWS = sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (activeListItem) {
        const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
        if (activeViewsCache[currentWS] && activeViewsCache[currentWS][currentIdx]) {
            window.miseAllowWebviewFocus = true;
            activeViewsCache[currentWS][currentIdx].focus();
        }
    }
}

function triggerLinkHints() {
    const currentWS = sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (activeListItem) {
        const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
        if (activeViewsCache[currentWS] && activeViewsCache[currentWS][currentIdx]) {
            try {
                activeViewsCache[currentWS][currentIdx].executeJavaScript("if (typeof window.toggleHints === 'function') { window.toggleHints(); }");
            } catch (err) {}
        }
    }
}

function renderWorkspaceUI(targetTabToFocus = null) {
    document.getElementById('WorkspaceLabel').textContent = sessionState.current_workspace;
    const tabList = document.getElementById('TabList');
    tabList.innerHTML = '';

    const currentWS = sessionState.current_workspace;
    const urls = sessionState.workspaces[currentWS] || ["https://duckduckgo.com"];

    if (!activeViewsCache[currentWS]) activeViewsCache[currentWS] = [];
    if (!activeTitlesCache[currentWS]) activeTitlesCache[currentWS] = [];

    const container = document.getElementById('webview-container');

    urls.forEach((url, idx) => {
        const cachedTitle = activeTitlesCache[currentWS][idx] || "Loading...";
        const li = document.createElement('li');
        li.textContent = cachedTitle.length > 24 ? cachedTitle.slice(0, 24) + "..." : cachedTitle;
        li.setAttribute('tabindex', '0');
        
        li.addEventListener('click', () => {
            if (dashboardActive) toggleDashboardView();
            switchTabFocus(idx);
        });

        li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (dashboardActive) toggleDashboardView();
                switchTabFocus(idx);
            }
        });

        tabList.appendChild(li);

        if (!activeViewsCache[currentWS][idx]) {
            const webview = document.createElement('webview');
            webview.style.backgroundColor = '#1a1b26';
            webview.setAttribute('preload', window.miseAPI.getWebviewPreloadPath());
            webview.setAttribute('allowpopups', '');
            
            if (globalPrivateModeActive || url.toLowerCase().includes("ycombinator.com")) {
                webview.setAttribute('partition', 'MisePrivateProfile');
            }
            
            webview.setAttribute('src', url);
            
            webview.addEventListener('page-title-updated', (e) => {
                activeTitlesCache[currentWS][idx] = e.title;
                const targetLi = document.querySelectorAll('#TabList li')[idx];
                if (targetLi && sessionState.current_workspace === currentWS) {
                    targetLi.textContent = e.title.length > 24 ? e.title.slice(0, 24) + "..." : e.title;
                }
            });

            webview.addEventListener('did-navigate', (e) => {
                if (sessionState.workspaces[currentWS] && sessionState.workspaces[currentWS][idx]) {
                    sessionState.workspaces[currentWS][idx] = e.url;
                    window.miseAPI.saveSession(sessionState);
                }
            });

            webview.addEventListener('did-navigate-in-page', (e) => {
                if (sessionState.workspaces[currentWS] && sessionState.workspaces[currentWS][idx]) {
                    sessionState.workspaces[currentWS][idx] = e.url;
                    window.miseAPI.saveSession(sessionState);
                }
            });

            webview.addEventListener('new-window', (e) => {
                e.preventDefault();
                const targetUrl = e.url;
                
                if (!sessionState.workspaces[currentWS]) {
                    sessionState.workspaces[currentWS] = [];
                }
                
                sessionState.workspaces[currentWS].push(targetUrl);
                window.miseAPI.saveSession(sessionState);
                
                const newTargetIdx = sessionState.workspaces[currentWS].length - 1;
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

            webview.addEventListener('did-start-loading', () => {
	            webview.style.opacity = '1';
	        });

	        webview.addEventListener('dom-ready', async () => {
	            applyCSSThemeToView(webview);
	            webview.style.opacity = '1';

	            try {
	                const hinterCode = await window.miseAPI.readHinterCode();
	                if (hinterCode) webview.executeJavaScript(hinterCode);
	            } catch (err) {}
	        });

            container.appendChild(webview);
            activeViewsCache[currentWS][idx] = webview;
        }
    });

    if (!dashboardActive) {
        const focusIdx = targetTabToFocus !== null ? targetTabToFocus : 0;
        switchTabFocus(focusIdx);
    }
}

function switchTabFocus(targetIdx) {
    const tabItems = document.querySelectorAll('#TabList li');
    const currentWS = sessionState.current_workspace;
    const currentWSViews = activeViewsCache[currentWS] || [];

    if (targetIdx >= tabItems.length) {
        targetIdx = Math.max(0, tabItems.length - 1);
    }

    tabItems.forEach((item, idx) => {
        if (idx === targetIdx) item.classList.add('selected');
        else item.classList.remove('selected');
    });

    const allWebviews = document.getElementById('webview-container').querySelectorAll('webview');
    allWebviews.forEach((wv) => wv.style.display = 'none');
    
    if (!dashboardActive && currentWSViews[targetIdx]) {
        currentWSViews[targetIdx].style.display = 'flex';
        
        // Safety timeout to ensure the DOM has painted the view before snatching focus
        setTimeout(() => {
            const currentFocused = document.activeElement;
            const sidebarHasFocus = document.getElementById('Sidebar').contains(currentFocused);
            const addressBar = document.getElementById('WideAddressBar');
            const addressBarIsActive = addressBar && (addressBar.style.display === 'block' || currentFocused === addressBar);

            if (!sidebarHasFocus && !paletteActive && !helpActive && !addressBarIsActive) {
                window.miseAllowWebviewFocus = true;
                currentWSViews[targetIdx].focus();
            }
        }, 50);
        
        try { applyCSSThemeToView(currentWSViews[targetIdx]); } catch (err) {}
    }
}

function spawnNewBlankTab() {
    const currentWS = sessionState.current_workspace;
    if (!sessionState.workspaces[currentWS]) sessionState.workspaces[currentWS] = [];
    sessionState.workspaces[currentWS].push("https://duckduckgo.com");
    window.miseAPI.saveSession(sessionState);
    
    const newTargetIdx = sessionState.workspaces[currentWS].length - 1;
    renderWorkspaceUI(newTargetIdx);
    displayAddressOverlay();
}

function spawnTabWithUrl(url) {
    const currentWS = sessionState.current_workspace;
    if (!sessionState.workspaces[currentWS]) sessionState.workspaces[currentWS] = [];
    sessionState.workspaces[currentWS].push(url || "https://duckduckgo.com");
    window.miseAPI.saveSession(sessionState);
    
    const newTargetIdx = sessionState.workspaces[currentWS].length - 1;
    renderWorkspaceUI(newTargetIdx);
}

function handleTabRemoval() {
    if (dashboardActive) {
        const currentItem = dashboardItems[dashboardSelectionIdx];
        if (!currentItem) return;
        const [type, wsName, idx] = currentItem.payload;
        
        if (type === 'tab') {
            if (sessionState.workspaces[wsName].length > 1) {
                sessionState.workspaces[wsName].splice(idx, 1);
                if (activeViewsCache[wsName] && activeViewsCache[wsName][idx]) {
                    activeViewsCache[wsName][idx].remove();
                    activeViewsCache[wsName].splice(idx, 1);
                }
                if (activeTitlesCache[wsName]) activeTitlesCache[wsName].splice(idx, 1);
                window.miseAPI.saveSession(sessionState);
                renderWorkspaceUI();
                buildDashboardTree();
            }
        } else if (type === 'workspace') {
            const totalWorkspaces = Object.keys(sessionState.workspaces);
            if (totalWorkspaces.length > 1) {
                if (wsName === sessionState.current_workspace) {
                    const fallbackWS = totalWorkspaces.find(k => k !== wsName);
                    sessionState.current_workspace = fallbackWS;
                }
                if (activeViewsCache[wsName]) {
                    activeViewsCache[wsName].forEach(wv => wv.remove());
                    delete activeViewsCache[wsName];
                }
                delete activeTitlesCache[wsName];
                delete sessionState.workspaces[wsName];
                
                window.miseAPI.saveSession(sessionState);
                renderWorkspaceUI();
                buildDashboardTree();
            }
        }
        return;
    }

    const currentWS = sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;

    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
    const tabs = sessionState.workspaces[currentWS] || [];
    if (tabs.length <= 1) return;

    tabs.splice(currentIdx, 1);
    if (activeViewsCache[currentWS] && activeViewsCache[currentWS][currentIdx]) {
        activeViewsCache[currentWS][currentIdx].remove();
        activeViewsCache[currentWS].splice(currentIdx, 1);
    }
    if (activeTitlesCache[currentWS]) activeTitlesCache[currentWS].splice(currentIdx, 1);

    window.miseAPI.saveSession(sessionState);
    
    window.miseAllowWebviewFocus = true;

    renderWorkspaceUI(Math.max(0, currentIdx - 1));
}

function toggleDashboardView() {
    if (paletteActive) {
        paletteActive = false;
        document.getElementById('CommandPaletteOverlay').style.display = 'none';
    }
    if (helpActive) toggleHelpMenuWindow();
    
    const overlay = document.getElementById('DashboardOverlay');
    dashboardActive = !dashboardActive;

    if (dashboardActive) {
        buildDashboardTree();
        overlay.style.display = 'flex';
        overlay.focus();
        const allWebviews = document.getElementById('webview-container').querySelectorAll('webview');
        allWebviews.forEach((wv) => wv.style.display = 'none');
    } else {
        overlay.style.display = 'none';
        const activeListItem = document.querySelector('#TabList li.selected');
        const currentIdx = activeListItem ? Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem) : 0;
        switchTabFocus(currentIdx);
    }
}


function buildDashboardTree() {
    const container = document.getElementById('DashboardTreeContainer');
    container.innerHTML = '';
    dashboardItems = [];

    Object.keys(sessionState.workspaces).forEach((wsName) => {
        const node = document.createElement('div');
        node.className = 'workspace-tree-node';

        const header = document.createElement('div');
        header.className = 'workspace-tree-header';
        header.textContent = wsName + (wsName === sessionState.current_workspace ? ' (Active)' : '');
        
        const wsPayload = ['workspace', wsName, null];
        const wsItemRef = { element: header, payload: wsPayload };
        dashboardItems.push(wsItemRef);

        header.addEventListener('click', () => {
            executeDashboardItemActivation(wsPayload);
        });

        // --- ALLOW DROPPING ON WORKSPACE HEADER ---
        header.addEventListener('dragover', (e) => e.preventDefault());
        header.addEventListener('drop', (e) => {
            e.preventDefault();
            try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                const sourceWS = data.workspace;
                const sourceIdx = data.index;
                const targetWS = wsName; // Dropped onto this workspace header

                if (sourceWS === targetWS) return; // No movement needed if dropped onto same workspace

                // 1. Move URL between workspace arrays in session state
                const [movedUrl] = sessionState.workspaces[sourceWS].splice(sourceIdx, 1);
                if (!sessionState.workspaces[targetWS]) {
                    sessionState.workspaces[targetWS] = [];
                }
                sessionState.workspaces[targetWS].push(movedUrl);

                // 2. Move active view cache safely
                if (activeViewsCache[sourceWS] && activeViewsCache[sourceWS][sourceIdx]) {
                    const [movedView] = activeViewsCache[sourceWS].splice(sourceIdx, 1);
                    if (!activeViewsCache[targetWS]) activeViewsCache[targetWS] = [];
                    activeViewsCache[targetWS].push(movedView);
                }

                // 3. Move title cache safely
                if (activeTitlesCache[sourceWS] && activeTitlesCache[sourceWS][sourceIdx]) {
                    const [movedTitle] = activeTitlesCache[sourceWS].splice(sourceIdx, 1);
                    if (!activeTitlesCache[targetWS]) activeTitlesCache[targetWS] = [];
                    activeTitlesCache[targetWS].push(movedTitle);
                }

                window.miseAPI.saveSession(sessionState);
                renderWorkspaceUI();
                buildDashboardTree(); // Re-render dashboard to reflect changes instantly
            } catch (err) {
                console.error("Workspace drop failed:", err);
            }
        });
        // ------------------------------------------

        node.appendChild(header);

        const urls = sessionState.workspaces[wsName] || [];
        urls.forEach((url, idx) => {
            const tabItem = document.createElement('div');
            tabItem.className = 'dashboard-tab-item';
            const cachedTitle = (activeTitlesCache[wsName] && activeTitlesCache[wsName][idx]) || url;
            tabItem.textContent = `- ${cachedTitle}`;
            
            // --- MAKE DASHBOARD TABS DRAGGABLE ---
            tabItem.setAttribute('draggable', 'true');

            tabItem.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ workspace: wsName, index: idx }));
                e.stopPropagation();
            });

            tabItem.addEventListener('dragover', (e) => e.preventDefault());

            tabItem.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    const sourceWS = data.workspace;
                    const sourceIdx = data.index;
                    const targetWS = wsName;

                    if (sourceWS === targetWS && sourceIdx === idx) return;

                    // Reordering or moving within/across workspaces
                    const [movedUrl] = sessionState.workspaces[sourceWS].splice(sourceIdx, 1);
                    
                    // Adjust target index if shifting inside the same workspace array
                    let targetIdx = idx;
                    if (sourceWS === targetWS && sourceIdx < idx) {
                        targetIdx--;
                    }
                    
                    if (!sessionState.workspaces[targetWS]) {
                        sessionState.workspaces[targetWS] = [];
                    }
                    sessionState.workspaces[targetWS].splice(targetIdx, 0, movedUrl);

                    // Sync view cache
                    if (activeViewsCache[sourceWS] && activeViewsCache[sourceWS][sourceIdx]) {
                        const [movedView] = activeViewsCache[sourceWS].splice(sourceIdx, 1);
                        if (!activeViewsCache[targetWS]) activeViewsCache[targetWS] = [];
                        activeViewsCache[targetWS].splice(targetIdx, 0, movedView);
                    }

                    // Sync title cache
                    if (activeTitlesCache[sourceWS] && activeTitlesCache[sourceWS][sourceIdx]) {
                        const [movedTitle] = activeTitlesCache[sourceWS].splice(sourceIdx, 1);
                        if (!activeTitlesCache[targetWS]) activeTitlesCache[targetWS] = [];
                        activeTitlesCache[targetWS].splice(targetIdx, 0, movedTitle);
                    }

                    window.miseAPI.saveSession(sessionState);
                    renderWorkspaceUI();
                    buildDashboardTree();
                } catch (err) {
                    console.error("Tab reorder/move drop failed:", err);
                }
            });
            // -------------------------------------

            const tabPayload = ['tab', wsName, idx];
            const tabItemRef = { element: tabItem, payload: tabPayload };
            dashboardItems.push(tabItemRef);

            tabItem.addEventListener('click', () => {
                executeDashboardItemActivation(tabPayload);
            });

            node.appendChild(tabItem);
        });

        container.appendChild(node);
    });

    dashboardSelectionIdx = Math.min(dashboardSelectionIdx, dashboardItems.length - 1);
    if (dashboardSelectionIdx < 0) dashboardSelectionIdx = 0;
    updateDashboardVisualSelection();
}

function updateDashboardVisualSelection() {
    dashboardItems.forEach((item, idx) => {
        if (idx === dashboardSelectionIdx) {
            item.element.classList.add('dashboard-selected');
            item.element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.element.classList.remove('dashboard-selected');
        }
    });
}

function executeDashboardItemActivation(payload) {
    const [type, wsName, idx] = payload;
    sessionState.current_workspace = wsName;
    window.miseAPI.saveSession(sessionState);
    
    const container = document.getElementById('webview-container');
    const allWebviews = container.querySelectorAll('webview');
    allWebviews.forEach(wv => wv.style.display = 'none');

    dashboardActive = false;
    document.getElementById('DashboardOverlay').style.display = 'none';

    if (type === 'tab') {
        renderWorkspaceUI(idx);
    } else {
        renderWorkspaceUI(0);
    }
}

function showWorkspaceInputDialog() {
    const container = document.getElementById('WorkspaceInputBox');
    const input = document.getElementById('NewWorkspaceTitleInput');
    if (container && input) {
        container.style.display = 'flex';
        input.value = '';
        input.focus();
    }
}

function hideWorkspaceInputDialog() {
    document.getElementById('WorkspaceInputBox').style.display = 'none';
    document.getElementById('DashboardOverlay').focus();
}

function processWorkspaceCreation() {
    const input = document.getElementById('NewWorkspaceTitleInput');
    const name = input.value.trim();
    if (!name) return;

    if (!sessionState.workspaces[name]) {
        sessionState.workspaces[name] = ["https://duckduckgo.com"];
        sessionState.current_workspace = name;
        window.miseAPI.saveSession(sessionState);
        hideWorkspaceInputDialog();
        
        const overlay = document.getElementById('DashboardOverlay');
        dashboardActive = false;
        overlay.style.display = 'none';
        renderWorkspaceUI(0);
    } else {
        hideWorkspaceInputDialog();
    }
}

function navigateFrameBack() {
    const currentWS = sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;

    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
    if (activeViewsCache[currentWS] && activeViewsCache[currentWS][currentIdx]) {
        activeViewsCache[currentWS][currentIdx].goBack();
    }
}

function navigateFrameForward() {
    const currentWS = sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;

    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
    if (activeViewsCache[currentWS] && activeViewsCache[currentWS][currentIdx]) {
        activeViewsCache[currentWS][currentIdx].goForward();
    }
}

function displayAddressOverlay() {
    const addressBar = document.getElementById('WideAddressBar');
    if (addressBar.style.display === 'block') {
        addressBar.style.display = 'none';
        
        // Hide auto-complete suggestion dropdown when closing address bar
        if (typeof hideSuggestions === 'function') {
            hideSuggestions();
        }
    } else {
        const currentWS = sessionState.current_workspace;
        const activeListItem = document.querySelector('#TabList li.selected');
        if (activeListItem) {
            const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
            if (sessionState.workspaces[currentWS] && sessionState.workspaces[currentWS][currentIdx]) {
                addressBar.value = sessionState.workspaces[currentWS][currentIdx];
            }
        }
        
        addressBar.style.display = 'block';
        
        // Defer focus and select past the DOM rendering frame to prevent focus stealing
        requestAnimationFrame(() => {
            addressBar.focus();
            addressBar.select();
        });
    }
}

function handleNavigation(input) {
    if (!input) return;
    
    const trimmedInput = input.trim();

    // 1. Intercept workspace switch commands (e.g., "ws:Socials" or "ws Socials")
    if (trimmedInput.toLowerCase().startsWith('ws:') || trimmedInput.toLowerCase().startsWith('ws ')) {
        const targetWs = trimmedInput.replace(/^ws[:\s]+/i, '').trim();
        
        // Find exact or case-insensitive workspace match
        const availableWorkspaces = Object.keys(sessionState.workspaces);
        const matchedWs = availableWorkspaces.find(ws => ws.toLowerCase() === targetWs.toLowerCase());

        if (matchedWs) {
            sessionState.current_workspace = matchedWs;
            window.miseAPI.saveSession(sessionState);
            renderWorkspaceUI(0);
        } else {
            alert(`Workspace "${targetWs}" does not exist.`);
        }

        hideSuggestions();
        document.getElementById('WideAddressBar').style.display = 'none';
        return;
    }

    // 2. Split input into parts to identify aliases (e.g., "g wallpapers")
    const parts = trimmedInput.split(' ');
    const alias = parts[0].toLowerCase();
    const query = parts.slice(1).join(' ');

    const aliases = {
        'g': 'https://www.google.com/search?q=',
        'yt': 'https://www.youtube.com/results?search_query=',
        'a': 'https://wiki.archlinux.org/index.php?search=',
        'gh': 'https://github.com/search?q=',
        'ddg': 'https://duckduckgo.com/?q=',
        'pkg': 'https://archlinux.org/packages/?q=',
        'so': 'https://stackoverflow.com/search?q=',
        'r': 'https://www.reddit.com/search/?q='
    };

    let targetUrl;

    if (aliases[alias] && query) {
        targetUrl = aliases[alias] + encodeURIComponent(query);
    } else {
        targetUrl = trimmedInput;
        if (!trimmedInput.startsWith('http://') && !trimmedInput.startsWith('https://')) {
            if (trimmedInput.includes('.') && !trimmedInput.includes(' ')) targetUrl = `https://${trimmedInput}`;
            else targetUrl = `https://duckduckgo.com/?q=${encodeURIComponent(trimmedInput)}`;
        }
    }

    // Save and load the target URL
    const currentWS = sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;

    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);

    sessionState.workspaces[currentWS][currentIdx] = targetUrl;
    window.miseAPI.saveSession(sessionState);

    if (activeViewsCache[currentWS] && activeViewsCache[currentWS][currentIdx]) {
        activeViewsCache[currentWS][currentIdx].setAttribute('src', targetUrl);
    }

    hideSuggestions();
    document.getElementById('WideAddressBar').style.display = 'none';
}

// Keep track of active style injection keys for each webview to safely remove them
const injectedThemeKeys = new Map();

async function applyCSSThemeToView(webview) {
    const isDark = isDarkMode();
    const url = webview.getURL() || "";
    }
  
function toggleInterfaceTheme() {
    const body = document.body;
    const button = document.getElementById('theme-toggle-btn');
    const isDark = body.classList.contains('dark-mode');
    
    // 1. Swap UI classes and notify the native backend quietly
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
    
    // 2. Loop through active webviews and instantly apply/remove the filter style sheet
    const allWebviews = document.getElementById('webview-container').querySelectorAll('webview');
    allWebviews.forEach((webview) => {
        applyCSSThemeToView(webview);
    });
    
    if (helpActive) {
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

// Toggle the History Overlay Window
function toggleHistoryOverlay() {
    const overlay = document.getElementById('HistoryOverlay');
    const input = document.getElementById('HistorySearchInput');
    
    historyActive = !historyActive;
    if (historyActive) {
        // Ensure other overlays are closed
        if (paletteActive) toggleCommandPaletteView();
        if (helpActive) toggleHelpMenuWindow();
        if (dashboardActive) toggleDashboardView();

        overlay.style.display = 'flex';
        input.value = '';
        input.focus();
        filterHistoryItems(''); // Fetch all history items initially
    } else {
        overlay.style.display = 'none';
        focusActiveWebview();
    }
}

// Fetch and render the history items
function filterHistoryItems(filterText) {
    const listContainer = document.getElementById('HistoryResultsList');
    listContainer.innerHTML = '';

    // Use .then instead of async/await to keep the syntax parser simple
    window.miseAPI.searchHistory(filterText).then((results) => {
        historyResults = results;

        if (historyResults.length === 0) {
            listContainer.innerHTML = '<div class="history-empty">No recent history items found.</div>';
            return;
        }

        historyResults.forEach((item) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'history-item';
            
            const safeTitle = escapeHtml(item.title);
            const safeUrl = escapeHtml(item.url);

            itemEl.innerHTML = `
                <div class="history-item-title">${safeTitle}</div>
                <div class="history-item-url">${safeUrl}</div>
            `;

            itemEl.addEventListener('click', () => {
                spawnTabWithUrl(item.url);
                toggleHistoryOverlay();
            });

            listContainer.appendChild(itemEl);
        });
    }).catch((err) => {
        console.error("Failed to load history:", err);
    });
}

// Simple HTML escaping helper for safe rendering
function escapeHtml(text) {
    if (!text) return "";
    return text
        .split("&").join("&amp;")
        .split("<").join("&lt;")
        .split(">").join("&gt;")
        .split('"').join("&quot;")
        .split("'").join("&#039;");
}

let findActive = false;

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

function getActiveWebview() {
    const currentWS = sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return null;
    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
    return activeViewsCache[currentWS]?.[currentIdx] || null;
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

function setupNotesListeners() {
    const textarea = document.getElementById('NotesTextArea');
    const closeBtn = document.getElementById('CloseNotesBtn');
    const editBtn = document.getElementById('ToggleEditNotesBtn');

    if (editBtn) {
        editBtn.addEventListener('click', () => {
            isEditingNotes = !isEditingNotes;
            renderNotesView();
        });
    }

    if (textarea) {
        textarea.addEventListener('input', (e) => {
            clearTimeout(notesSaveTimeout);
            notesSaveTimeout = setTimeout(() => {
                if (window.miseAPI && typeof window.miseAPI.saveNotes === 'function') {
                    window.miseAPI.saveNotes(e.target.value);
                }
            }, 300);
        });

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                toggleNotesOverlay();
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', toggleNotesOverlay);
    }
}

// Simple inline markdown parser helper
function parseMarkdownToHtml(text) {
    if (!text) return '';
    
    // Escape standard HTML tags first to prevent injection
    let html = escapeHtml(text);

    // Parse Markdown headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Parse bold, italics, and inline code
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');

    // Parse blockquotes and list items
    html = html.replace(/^\&gt\; (.*$)/gim, '<blockquote>$1</blockquote>');
    html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');
    html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');

    // Convert newlines to breaks
    html = html.replace(/\n/g, '<br>');

    return html;
}

function renderNotesView() {
    const textarea = document.getElementById('NotesTextArea');
    const mdView = document.getElementById('NotesMarkdownView');
    const editBtn = document.getElementById('ToggleEditNotesBtn');

    if (!textarea || !mdView) return;

    if (isEditingNotes) {
        textarea.style.display = 'block';
        mdView.style.display = 'none';
        if (editBtn) editBtn.textContent = 'Preview';
        setTimeout(() => textarea.focus(), 50);
    } else {
        mdView.innerHTML = parseMarkdownToHtml(textarea.value);
        textarea.style.display = 'none';
        mdView.style.display = 'block';
        if (editBtn) editBtn.textContent = 'Edit';
    }
}

function toggleNotesOverlay() {
    const overlay = document.getElementById('NotesOverlay');
    const textarea = document.getElementById('NotesTextArea');

    if (!overlay || !textarea) return;

    notesActive = !notesActive;

    if (notesActive) {
        if (paletteActive) toggleCommandPaletteView();
        if (helpActive) toggleHelpMenuWindow();
        if (dashboardActive) toggleDashboardView();
        if (historyActive) toggleHistoryOverlay();

        if (window.miseAPI && typeof window.miseAPI.readNotes === 'function') {
            window.miseAPI.readNotes().then((content) => {
                textarea.value = content || '';
                isEditingNotes = false;
                renderNotesView();
                overlay.style.display = 'flex';
            }).catch((err) => {
                console.error("Failed to load notes:", err);
                overlay.style.display = 'flex';
            });
        } else {
            overlay.style.display = 'flex';
        }
    } else {
        if (window.miseAPI && typeof window.miseAPI.saveNotes === 'function') {
            window.miseAPI.saveNotes(textarea.value);
        }
        overlay.style.display = 'none';
        focusActiveWebview();
    }
}

function toggleZenMode() {
    document.body.classList.toggle('zen-mode');
}

function setupAddressBarAutocomplete() {
    const addressBar = document.getElementById('WideAddressBar');
    const suggestionsList = document.getElementById('AddressSuggestions');

    if (!addressBar || !suggestionsList) return;

    addressBar.addEventListener('input', async (e) => {
        const query = e.target.value.trim();
        if (!query) {
            hideSuggestions();
            return;
        }

        // 1. Handle Workspace Aliases ("ws <query>")
        if (query.toLowerCase().startsWith('ws ')) {
            const wsQuery = query.slice(3).toLowerCase();
            const matchingWorkspaces = Object.keys(sessionState.workspaces)
                .filter(ws => ws.toLowerCase().includes(wsQuery))
                .map(ws => ({ title: `Switch to Workspace: ${ws}`, value: `ws:${ws}`, type: 'Workspace' }));

            renderSuggestions(matchingWorkspaces);
            return;
        }

        // 2. Query History and Open Workspace Tabs simultaneously
        const matches = [];

        // Workspace tab titles match
        Object.keys(sessionState.workspaces).forEach(wsName => {
            sessionState.workspaces[wsName].forEach((url, idx) => {
                const title = (activeTitlesCache[wsName] && activeTitlesCache[wsName][idx]) || url;
                if (title.toLowerCase().includes(query.toLowerCase()) || url.toLowerCase().includes(query.toLowerCase())) {
                    matches.push({ title: `${title} (${wsName})`, value: url, type: 'Tab' });
                }
            });
        });

        // History match via IPC
        if (window.miseAPI && typeof window.miseAPI.searchHistory === 'function') {
            try {
                const historyMatches = await window.miseAPI.searchHistory(query);
                historyMatches.slice(0, 5).forEach(item => {
                    matches.push({ title: item.title, value: item.url, type: 'History' });
                });
            } catch (err) {}
        }

        renderSuggestions(matches);
    });

    addressBar.addEventListener('keydown', (e) => {
        if (suggestionsList.style.display === 'none') return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (addressSuggestions.length > 0) {
                addressSelectionIdx = (addressSelectionIdx + 1) % addressSuggestions.length;
                updateSuggestionHighlight();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (addressSuggestions.length > 0) {
                addressSelectionIdx = (addressSelectionIdx - 1 + addressSuggestions.length) % addressSuggestions.length;
                updateSuggestionHighlight();
            }
        } else if (e.key === 'Tab') {
            e.preventDefault();
            if (addressSelectionIdx >= 0 && addressSuggestions[addressSelectionIdx]) {
                addressBar.value = addressSuggestions[addressSelectionIdx].value;
            }
        }
    });
}

function renderSuggestions(items) {
    const suggestionsList = document.getElementById('AddressSuggestions');
    suggestionsList.innerHTML = '';
    addressSuggestions = items;
    addressSelectionIdx = -1;

    if (items.length === 0) {
        hideSuggestions();
        return;
    }

    items.forEach((item, idx) => {
        const li = document.createElement('li');
        li.className = 'suggestion-item';
        li.innerHTML = `<span>${escapeHtml(item.title)}</span><span class="suggestion-type">${item.type}</span>`;
        
        li.addEventListener('click', () => {
            selectSuggestion(item);
        });

        suggestionsList.appendChild(li);
    });

    suggestionsList.style.display = 'block';
}

function updateSuggestionHighlight() {
    const items = document.querySelectorAll('#AddressSuggestions .suggestion-item');
    items.forEach((item, idx) => {
        if (idx === addressSelectionIdx) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
            // Auto update input text to value on selection
            if (addressSuggestions[idx]) {
                document.getElementById('WideAddressBar').value = addressSuggestions[idx].value;
            }
        } else {
            item.classList.remove('selected');
        }
    });
}

function selectSuggestion(item) {
    if (item.value.startsWith('ws:')) {
        const targetWs = item.value.split('ws:')[1];
        sessionState.current_workspace = targetWs;
        window.miseAPI.saveSession(sessionState);
        renderWorkspaceUI(0);
    } else {
        handleNavigation(item.value);
    }
    hideSuggestions();
}

function hideSuggestions() {
    const suggestionsList = document.getElementById('AddressSuggestions');
    if (suggestionsList) suggestionsList.style.display = 'none';
    addressSuggestions = [];
    addressSelectionIdx = -1;
}
