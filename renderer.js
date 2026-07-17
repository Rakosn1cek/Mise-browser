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
    "New DuckDuckGo Tab": () => spawnNewBlankTab(),
    "Toggle Floating Address Bar": () => displayAddressOverlay(),
    "Toggle Workspace Dashboard": () => toggleDashboardView(),
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
    "Toggle Link Hints Overlay": () => triggerLinkHints(),
    "Toggle Light/Dark Layout": () => toggleInterfaceTheme(),
    "Show Shortcuts Reference": () => toggleHelpMenuWindow(),
    "Toggle Actionable History": () => toggleHistoryOverlay(),
    "Toggle Private Browsing": () => {
        globalPrivateModeActive = !globalPrivateModeActive;
        handlePrivateBrowsingStateShift(globalPrivateModeActive);
    },
    "Clear Current Site Cookies": () => executeSurgicalCookieWipe(),
    "Clear Active Profile Cache": () => executeGlobalCacheWipe()
};

async function initializeBrowser() {
    sessionState = await window.miseAPI.getSession();
    setupEventListeners();
    renderWorkspaceUI();
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

    window.miseAPI.onMasterShortcut((action, ...args) => {
        switch (action) {
            case 'spawn-tab': spawnNewBlankTab(); break;
            case 'spawn-tab-with-url': spawnTabWithUrl(args[0]); break;
            case 'toggle-address': displayAddressOverlay(); break;
            case 'toggle-dashboard': toggleDashboardView(); break;
            case 'remove-tab': handleTabRemoval(); break;
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
            // Pass the current trimmed value down explicitly to prevent missing string argument errors
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
        
        content.innerHTML = `Mise Browser — v0.1.0\n==================================================\n
Navigation & Workspaces
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
Ctrl + Shift + Tab Focus sidebar nav buttons

Web Interaction
--------------------------------------------------
Ctrl + F           Toggle Link Hints Overlay
Right Click        Contextual Actions + (Arch Wiki)

Sidebar Controls
--------------------------------------------------
Arrow Keys L/R     Move around the nav buttons
Sun/Moon Icon      Toggle Light/Dark Layout
Bell Icon          Toggle Web Notifications

Search Bar Aliasses
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

            webview.addEventListener('dom-ready', async () => {
                applyCSSThemeToView(webview);

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
            if (!sidebarHasFocus && !paletteActive && !helpActive) {
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

        node.appendChild(header);

        const urls = sessionState.workspaces[wsName] || [];
        urls.forEach((url, idx) => {
            const tabItem = document.createElement('div');
            tabItem.className = 'dashboard-tab-item';
            const cachedTitle = (activeTitlesCache[wsName] && activeTitlesCache[wsName][idx]) || url;
            tabItem.textContent = `- ${cachedTitle}`;
            
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
        if (idx === dashboardSelectionIdx) item.element.classList.add('dashboard-selected');
        else item.element.classList.remove('dashboard-selected');
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
        addressBar.focus();
        addressBar.select();
    }
}

function handleNavigation(input) {
    if (!input) return;
    
    // 1. Split input into parts to identify the alias (e.g., "g wallpapers")
    const parts = input.trim().split(' ');
    const alias = parts[0].toLowerCase();
    const query = parts.slice(1).join(' ');

    // 2. Define your URL aliases
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

    // 3. Check if the first word matches a known alias
    if (aliases[alias] && query) {
        targetUrl = aliases[alias] + encodeURIComponent(query);
    } 
    // 4. Default behavior (original logic)
    else {
        targetUrl = input;
        if (!input.startsWith('http://') && !input.startsWith('https://')) {
            if (input.includes('.') && !input.includes(' ')) targetUrl = `https://${input}`;
            else targetUrl = `https://duckduckgo.com/?q=${encodeURIComponent(input)}`;
        }
    }

    // --- Proceed with existing logic to save and load the URL ---
    const currentWS = sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;

    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);

    sessionState.workspaces[currentWS][currentIdx] = targetUrl;
    window.miseAPI.saveSession(sessionState);

    if (activeViewsCache[currentWS] && activeViewsCache[currentWS][currentIdx]) {
        activeViewsCache[currentWS][currentIdx].setAttribute('src', targetUrl);
    }
    document.getElementById('WideAddressBar').style.display = 'none';
}

// Keep track of active style injection keys for each webview to safely remove them
const injectedThemeKeys = new Map();

async function applyCSSThemeToView(webview) {
    const isDark = isDarkMode();
    const url = webview.getURL() || "";
    
    // 1. If dark mode is disabled, remove the previously injected CSS key
    if (!isDark) {
        const key = injectedThemeKeys.get(webview);
        if (key) {
            try {
                await webview.removeInsertedCSS(key);
                injectedThemeKeys.delete(webview);
            } catch (err) {}
        }
    } else {
        // 2. Hardware-accelerated CSS filter
        const darkCSS = `
            html { 
                filter: invert(1) hue-rotate(180deg) !important; 
            }
            img, video, iframe, canvas, [style*="background-image"] { 
                filter: invert(1) hue-rotate(180deg) !important; 
            }
        `.replace(/\s+/g, ' ');

        try {
            const oldKey = injectedThemeKeys.get(webview);
            if (oldKey) {
                await webview.removeInsertedCSS(oldKey);
            }
            const newKey = await webview.insertCSS(darkCSS);
            injectedThemeKeys.set(webview, newKey);
        } catch (err) {
            console.error("Failed to apply GPU theme filter:", err);
        }
    }

    // 3. Gemini-Specific Layout Jitter Freeze (Runs for both light and dark modes)
    if (url.includes('gemini.google.com')) {
        const freezeScript = `
            (function() {
                // Find Google's main app shell containers that handle heights
                const targets = [
                    document.querySelector('div[class*="app-container"]'),
                    document.querySelector('div[class*="chat-container"]'),
                    document.body
                ].filter(el => el !== null);

                targets.forEach(el => {
                    // Force the layout engine to ignore dynamic script calculations
                    el.style.setProperty('height', '100vh', 'important');
                    el.style.setProperty('max-height', '100vh', 'important');
                    el.style.setProperty('overflow', 'hidden', 'important');
                });
            })();
        `;
        try {
            await webview.executeJavaScript(freezeScript);
        } catch (err) {}
    }
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
