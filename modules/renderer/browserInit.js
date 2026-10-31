import { state } from '../state.js';
import { 
    renderWorkspaceUI, 
    spawnNewBlankTab, 
    spawnTabWithUrl, 
    navigateFrameBack, 
    navigateFrameForward, 
    toggleReaderViewOnActiveTab, 
    initializeTabSleepManager, 
    reapplyActiveUserStyles 
} from '../webview.js';
import { toggleDarkReaderOnActiveTab } from '../darkReader.js';
import { toggleSplitView, cycleSplitOrientation } from '../splitView.js';
import { displayAddressOverlay, setupAddressBarAutocomplete } from '../navigation.js';
import { toggleDashboardView } from '../overlays/dashboard.js';
import { 
    toggleBookmarksOverlay, 
    loadBookmarksAndQuickmarks, 
    setupBookmarkOverlayListeners 
} from '../overlays/bookmarks.js';
import { toggleCommandPaletteView } from '../overlays/commandPalette.js';
import { setupNotesListeners, toggleNotesOverlay } from '../overlays/notes.js';
import { setupHistoryOverlayListeners } from '../overlays/history.js';
import { setupDiagnosticsListeners } from '../overlays/diagnostics.js';
import { initSearchEnginePreference } from '../overlays/searchEngine.js';
import { initDownloadShelf } from '../downloads.js';
import { initStatusBar, toggleStatusBar, setTargetUrl } from '../statusBar.js';
import { initPermissionsOverlay } from '../overlays/permissions.js';
import { initClock } from '../clock.js';
import { initWindowControls } from '../windowControls.js';

import { initThemeState, toggleWebviewTheme } from './themeController.js';
import { applySidebarMode, setupSidebarListeners } from './sidebarController.js';
import { setupWorkspaceListeners } from './workspaceController.js';
import { setupPageSearchListeners } from './pageSearch.js';

export function setupCoreUIListeners() {
    document.getElementById('reader-view-btn')?.addEventListener('click', toggleReaderViewOnActiveTab);
    document.getElementById('dark-reader-btn')?.addEventListener('click', toggleDarkReaderOnActiveTab);
    document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleWebviewTheme);
    document.getElementById('toggle-nav-btn')?.addEventListener('click', displayAddressOverlay);
    document.getElementById('split-toggle-btn')?.addEventListener('click', () => toggleSplitView());
    document.getElementById('split-toggle-btn')?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        cycleSplitOrientation();
    });
    document.getElementById('back-btn')?.addEventListener('click', navigateFrameBack);
    document.getElementById('forward-btn')?.addEventListener('click', navigateFrameForward);
    document.getElementById('menu-btn')?.addEventListener('click', toggleDashboardView);

    document.getElementById('WelcomeNewTabBtn')?.addEventListener('click', spawnNewBlankTab);
    document.getElementById('WelcomeBookmarksBtn')?.addEventListener('click', toggleBookmarksOverlay);
    document.getElementById('WelcomePaletteBtn')?.addEventListener('click', toggleCommandPaletteView);
    document.getElementById('WelcomeNotesBtn')?.addEventListener('click', toggleNotesOverlay);

    if (window.miseAPI && typeof window.miseAPI.onUserContentUpdated === 'function') {
        window.miseAPI.onUserContentUpdated((kind) => {
            if (kind === 'styles' || kind === 'all') {
                reapplyActiveUserStyles();
            }
        });
    }

    loadBookmarksAndQuickmarks();
}

export async function initializeBrowser() {
    state.sessionState = await window.miseAPI.getSession();
    if (!state.sessionState.workspaces) state.sessionState.workspaces = {};
    if (!state.sessionState.workspaces['Private']) {
        state.sessionState.workspaces['Private'] = [];
    }

    // Never restore into Private workspace on application launch
    if (!state.sessionState.current_workspace || state.sessionState.current_workspace === 'Private') {
        const remaining = Object.keys(state.sessionState.workspaces).filter(k => k !== 'Private');
        state.sessionState.current_workspace = remaining.length > 0 ? remaining[0] : 'Workspace 1';
        if (!state.sessionState.workspaces[state.sessionState.current_workspace]) {
            state.sessionState.workspaces[state.sessionState.current_workspace] = ['https://duckduckgo.com'];
        }
    }

    // Check crash recovery sentinel
    let isCrashRecovery = false;
    try {
        if (window.miseAPI && typeof window.miseAPI.getSessionRecoveryStatus === 'function') {
            const status = await window.miseAPI.getSessionRecoveryStatus();
            isCrashRecovery = !!(status && status.wasCrash);
        }
    } catch (e) {}

    // Restore cached titles, sleeping tab states, favicons, and dark reader flags
    if (state.sessionState.tab_titles) {
        state.activeTitlesCache = { ...state.sessionState.tab_titles };
    }
    if (state.sessionState.tab_favicons) {
        state.tabFavicons = { ...state.sessionState.tab_favicons };
    }
    if (state.sessionState.tab_dark_reader) {
        state.tabDarkReaderStates = { ...state.sessionState.tab_dark_reader };
    }
    if (state.sessionState.tab_pinned) {
        state.tabPinned = { ...state.sessionState.tab_pinned };
    }

    if (state.sessionState.tab_sleep_states && !isCrashRecovery) {
        Object.keys(state.sessionState.tab_sleep_states).forEach(ws => {
            const records = state.sessionState.tab_sleep_states[ws];
            if (Array.isArray(records)) {
                records.forEach(rec => {
                    if (rec && typeof rec === 'object') {
                        delete rec.sessionStorage;
                    }
                });
            }
        });
        state.tabSleepStates = { ...state.sessionState.tab_sleep_states };

        const bootWS = state.sessionState.current_workspace;
        const bootUrls = state.sessionState.workspaces?.[bootWS] || [];
        const rawBootActive = state.sessionState.active_tabs?.[bootWS];
        const activeIdxOnBoot = (typeof rawBootActive === 'number' && rawBootActive >= 0 && rawBootActive < bootUrls.length)
            ? rawBootActive
            : 0;

        Object.keys(state.sessionState.workspaces || {}).forEach(ws => {
            const urls = state.sessionState.workspaces[ws] || [];
            if (!state.tabSleepStates[ws]) state.tabSleepStates[ws] = [];
            urls.forEach((u, i) => {
                if (ws !== bootWS || i !== activeIdxOnBoot) {
                    if (!state.tabSleepStates[ws][i]) {
                        state.tabSleepStates[ws][i] = {
                            url: u,
                            title: state.activeTitlesCache[ws]?.[i] || u,
                            scrollX: 0,
                            scrollY: 0,
                            darkReader: !!state.tabDarkReaderStates?.[ws]?.[i],
                            hibernatedAt: Date.now()
                        };
                    }
                } else {
                    state.tabSleepStates[ws][i] = null;
                }
            });
        });
    } else {
        // Crash recovery or initial cold boot: force background tabs to sleep to eliminate memory spikes
        const bootWS = state.sessionState.current_workspace;
        const bootUrls = state.sessionState.workspaces?.[bootWS] || [];
        const rawBootActive = state.sessionState.active_tabs?.[bootWS];
        const activeIdxOnBoot = (typeof rawBootActive === 'number' && rawBootActive >= 0 && rawBootActive < bootUrls.length)
            ? rawBootActive
            : 0;

        Object.keys(state.sessionState.workspaces || {}).forEach(ws => {
            const urls = state.sessionState.workspaces[ws] || [];
            const previousSleep = state.sessionState.tab_sleep_states?.[ws] || [];
            if (!state.tabSleepStates[ws]) state.tabSleepStates[ws] = [];
            urls.forEach((u, i) => {
                if (ws !== bootWS || i !== activeIdxOnBoot) {
                    const prev = previousSleep[i];
                    state.tabSleepStates[ws][i] = {
                        url: prev?.url || u,
                        title: prev?.title || state.activeTitlesCache[ws]?.[i] || u,
                        scrollX: prev?.scrollX || 0,
                        scrollY: prev?.scrollY || 0,
                        darkReader: prev?.darkReader || !!state.tabDarkReaderStates?.[ws]?.[i],
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
    initThemeState(initialCfg, savedTheme);

    setupCoreUIListeners();
    setupSidebarListeners();
    setupWorkspaceListeners();
    setupPageSearchListeners();

    renderWorkspaceUI();
    initializeTabSleepManager();
    setupNotesListeners();
    setupAddressBarAutocomplete();
    setupBookmarkOverlayListeners();
    setupHistoryOverlayListeners();
    setupDiagnosticsListeners();
    initSearchEnginePreference();
    initDownloadShelf();
    initStatusBar();
    initPermissionsOverlay();
    initClock();
    initWindowControls(initialCfg);

    const startupBehavior = initialCfg?.startup_behavior || 'restore';
    if (!isCrashRecovery) {
        if (startupBehavior === 'dashboard' && typeof window.toggleDashboardView === 'function') {
            setTimeout(() => {
                if (!state.dashboardActive) {
                    window.toggleDashboardView();
                }
            }, 100);
        } else if (startupBehavior === 'new-tab') {
            setTimeout(() => {
                spawnNewBlankTab();
            }, 100);
        }
    }

    if (isCrashRecovery) {
        setTimeout(() => {
            setTargetUrl('Session restored after unexpected shutdown', 4000);
        }, 400);
    }

    if (window.miseAPI && typeof window.miseAPI.getBrowserSettings === 'function') {
        window.miseAPI.getBrowserSettings().then((cfg) => {
            if (cfg && cfg.show_status_bar === false) {
                toggleStatusBar(false);
            }
        }).catch(() => {});
    }

    if (window.miseAPI && typeof window.miseAPI.getAppVersion === 'function') {
        window.miseAPI.getAppVersion().then((info) => {
            const badge = document.getElementById('MiseVersionBadge');
            const welcomeBadge = document.getElementById('WelcomeRuntimeVersions');

            const appVer = typeof info === 'object' ? info.version : info;
            const electronVer = typeof info === 'object' ? info.electron : '';
            const chromeVer = typeof info === 'object' ? info.chrome : '';

            if (appVer) {
                state.appVersion = appVer;
                window.__miseAppVersion = appVer;
                let text = `Mise v${appVer}`;
                if (electronVer && chromeVer) {
                    text += ` · Electron ${electronVer} · Chromium ${chromeVer}`;
                }
                if (badge) badge.textContent = text;
                if (welcomeBadge) welcomeBadge.textContent = text;

                if (window.miseAPI && typeof window.miseAPI.getBrowserSettings === 'function') {
                    window.miseAPI.getBrowserSettings().then((cfg) => {
                        const lastSeen = cfg?.last_seen_version;
                        if (!lastSeen) {
                            window.miseAPI.updateBrowserSettings({ last_seen_version: appVer }).catch(() => {});
                            if (typeof window.miseAPI.getWelcomePath === 'function') {
                                const welcomePath = window.miseAPI.getWelcomePath();
                                if (welcomePath) spawnTabWithUrl(welcomePath);
                            }
                        } else if (lastSeen !== appVer) {
                            window.miseAPI.updateBrowserSettings({ last_seen_version: appVer }).catch(() => {});
                            if (typeof window.miseAPI.getWhatsNewPath === 'function') {
                                const whatsNewPath = window.miseAPI.getWhatsNewPath();
                                if (whatsNewPath) spawnTabWithUrl(whatsNewPath);
                            }
                        }
                    }).catch(() => {});
                }
            }
        }).catch(() => {});
    }

    window.openWhatsNewTab = () => {
        if (window.miseAPI && typeof window.miseAPI.getWhatsNewPath === 'function') {
            const whatsNewPath = window.miseAPI.getWhatsNewPath();
            if (whatsNewPath) spawnTabWithUrl(whatsNewPath);
        }
    };

    window.openWelcomeTab = () => {
        if (window.miseAPI && typeof window.miseAPI.getWelcomePath === 'function') {
            const welcomePath = window.miseAPI.getWelcomePath();
            if (welcomePath) spawnTabWithUrl(welcomePath);
        }
    };

    if (window.miseAPI && typeof window.miseAPI.onUpdateAvailable === 'function') {
        window.miseAPI.onUpdateAvailable((info) => {
            if (typeof window.displayUpdateNotification === 'function') {
                window.displayUpdateNotification(info);
            }
        });
    }

    document.getElementById('WhatsNewOpenBtn')?.addEventListener('click', () => {
        if (typeof window.openWhatsNewTab === 'function') {
            window.openWhatsNewTab();
            if (typeof window.togglePreferencesView === 'function') {
                window.togglePreferencesView();
            }
        }
    });

    document.getElementById('CheckForUpdatesBtn')?.addEventListener('click', () => {
        if (typeof window.checkForUpdates === 'function') {
            window.checkForUpdates(true);
        }
    });

    if (window.miseAPI && typeof window.miseAPI.signalRendererReady === 'function') {
        window.miseAPI.signalRendererReady();
    }
}
