import { state } from './modules/state.js';
import { getActiveWebview, focusActiveWebview, showNotificationToast } from './modules/utils.js';
import { 
    renderWorkspaceUI, switchTabFocus, jumpToTabByIndex, spawnNewBlankTab, spawnTabWithUrl, 
    handleTabRemoval, navigateFrameBack, navigateFrameForward, toggleGlobalMediaPlayback, 
    toggleActiveTabAudioMute, toggleGlobalAudioMute, togglePinActiveTab, hibernateInactiveTabs, 
    toggleReaderViewOnActiveTab, exportActiveTabToNotes, exportActiveTabToExternal 
} from './modules/webview.js';
import { toggleBookmarksOverlay, promptQuickmark, addCurrentPageToBookmarks, deleteBookmark, deleteQuickmark } from './modules/overlays/bookmarks.js';
import { toggleCommandPaletteView, togglePreferencesView, cycleWebRTCPolicy, toggleWebRTCProtection, setWebRTCPolicy, inspectWebRTCStatus, getWebRTCReadableLabel } from './modules/overlays/commandPalette.js';
import { toggleDashboardView, promptWorkspaceCreation, promptWorkspaceRename, confirmWorkspaceDeletion } from './modules/overlays/dashboard.js';
import { toggleHistoryOverlay } from './modules/overlays/history.js';
import { toggleNotesOverlay, appendSelectionToNotes, openNotesInExternalApp } from './modules/overlays/notes.js';
import { displayAddressOverlay } from './modules/navigation.js';
import { openTransientShareModal } from './modules/overlays/shareModal.js';
import { openPeekModal, closePeekModal } from './modules/overlays/peekModal.js';
import { toggleDownloadShelf } from './modules/downloads.js';
import { toggleSplitView, cycleSplitOrientation, switchSplitFocus, swapSplitPanes, closeSplitView, openUrlInSplit } from './modules/splitView.js';
import { toggleStatusBar, setTargetUrl } from './modules/statusBar.js';
import { toggleDarkReaderOnActiveTab } from './modules/darkReader.js';
import { toggleClock, cycleClockFormat } from './modules/clock.js';
import { toggleDiagnosticsView, toggleDiagnosticsRecording } from './modules/overlays/diagnostics.js';
import { toggleWindowControls } from './modules/windowControls.js';
import { toggleWebviewTheme, toggleInterfaceTheme } from './modules/renderer/themeController.js';
import { toggleInPageSearch } from './modules/renderer/pageSearch.js';
import { togglePrivateWorkspace, handlePrivateBrowsingStateShift, executeSurgicalCookieWipe, executeGlobalCacheWipe, testCleanGoogleSignIn } from './modules/renderer/workspaceController.js';
import { applySidebarMode, toggleSidebarExpansion, toggleSidebarPin, focusSidebar, defaultOverlayIds } from './modules/renderer/sidebarController.js';
import { initializeBrowser } from './modules/renderer/browserInit.js';

export { applySidebarMode, toggleSidebarExpansion, toggleSidebarPin, focusSidebar, togglePrivateWorkspace, testCleanGoogleSignIn, toggleInPageSearch, toggleWebviewTheme, toggleInterfaceTheme, initializeBrowser };

export const overlayIds = [
    'PaletteInput', 'PaletteList', 'PreferencesOverlay', 'BookmarksOverlay', 'BookmarkSearchInput',
    'HistoryOverlay', 'HistorySearchInput', 'NotesOverlay', 'NotesTextArea', 'DashboardOverlay',
    'ShareModalOverlay', 'PeekModalOverlay', 'FindBarOverlay', 'DiagnosticsOverlay'
];

function dispatchHintMode(opts) {
    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;
    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
    const activeWv = state.activeViewsCache[currentWS]?.[currentIdx];
    if (activeWv && typeof activeWv.executeJavaScript === 'function') {
        const arg = opts ? JSON.stringify(opts) : '';
        activeWv.executeJavaScript(`if (typeof window.toggleHints === 'function') { window.toggleHints(${arg}); }`).catch(() => {});
    }
}
export function triggerLinkHints() { dispatchHintMode(); }
export function triggerGlanceHints() { dispatchHintMode({ mode: 'glance' }); }

export function displayUpdateNotification(updateInfo) {
    if (!updateInfo || !updateInfo.updateAvailable) return;
    const banner = document.getElementById('UpdateNotificationBanner');
    const textEl = document.getElementById('UpdateNotificationText');
    const actionBtn = document.getElementById('UpdateActionBtn');
    if (banner && textEl) {
        textEl.textContent = `A newer release (${updateInfo.latestVersion}) is available. You are running v${updateInfo.currentVersion}.`;
        banner.style.display = 'flex';
        if (actionBtn) {
            actionBtn.style.display = 'inline-block';
            actionBtn.onclick = () => { if (window.miseAPI?.openExternal) window.miseAPI.openExternal(updateInfo.releaseUrl); };
        }
    }
    const sidebarIndicator = document.getElementById('update-indicator-btn');
    if (sidebarIndicator) {
        sidebarIndicator.style.display = 'inline-flex';
        sidebarIndicator.title = `Mise ${updateInfo.latestVersion} available. Click to review release.`;
        sidebarIndicator.onclick = () => { if (typeof window.togglePreferencesView === 'function') window.togglePreferencesView(); };
    }
}

export async function triggerUpdateCheck(manual = false) {
    const checkBtn = document.getElementById('CheckForUpdatesBtn');
    if (checkBtn) { checkBtn.disabled = true; checkBtn.textContent = 'Checking...'; }
    try {
        if (window.miseAPI && typeof window.miseAPI.checkForUpdates === 'function') {
            const result = await window.miseAPI.checkForUpdates(manual);
            if (result && result.error) {
                if (checkBtn) checkBtn.textContent = 'Check Failed';
                if (manual) {
                    const banner = document.getElementById('UpdateNotificationBanner');
                    const textEl = document.getElementById('UpdateNotificationText');
                    const actionBtn = document.getElementById('UpdateActionBtn');
                    if (banner && textEl) {
                        textEl.textContent = `Update check failed: ${result.error}`;
                        banner.style.display = 'flex';
                        if (actionBtn) actionBtn.style.display = 'none';
                        setTimeout(() => { banner.style.display = 'none'; }, 6000);
                    }
                }
                if (window.miseAPI && typeof window.miseAPI.logDiagnosticsEvent === 'function') {
                    window.miseAPI.logDiagnosticsEvent({ level: 'warn', category: 'updater', message: `Update check failed: ${result.error}` });
                }
            } else if (result && result.updateAvailable) {
                displayUpdateNotification(result);
                if (checkBtn) checkBtn.textContent = 'Update Available';
            } else {
                if (checkBtn) checkBtn.textContent = 'Up to Date';
                if (manual) {
                    const banner = document.getElementById('UpdateNotificationBanner');
                    const textEl = document.getElementById('UpdateNotificationText');
                    const actionBtn = document.getElementById('UpdateActionBtn');
                    if (banner && textEl) {
                        textEl.textContent = `Mise v${result?.currentVersion || ''} is currently up to date.`;
                        banner.style.display = 'flex';
                        if (actionBtn) actionBtn.style.display = 'none';
                        setTimeout(() => { if (!result?.updateAvailable) banner.style.display = 'none'; }, 5000);
                    }
                }
            }
        }
    } catch (err) {
        if (checkBtn) checkBtn.textContent = 'Check Failed';
        const errorMsg = err?.message || 'Network error encountered';
        if (manual) {
            const banner = document.getElementById('UpdateNotificationBanner');
            const textEl = document.getElementById('UpdateNotificationText');
            const actionBtn = document.getElementById('UpdateActionBtn');
            if (banner && textEl) {
                textEl.textContent = `Update check failed: ${errorMsg}`;
                banner.style.display = 'flex';
                if (actionBtn) actionBtn.style.display = 'none';
                setTimeout(() => { banner.style.display = 'none'; }, 6000);
            }
        }
        if (window.miseAPI && typeof window.miseAPI.logDiagnosticsEvent === 'function') {
            window.miseAPI.logDiagnosticsEvent({ level: 'warn', category: 'updater', message: `Update check failed: ${errorMsg}` });
        }
    } finally {
        setTimeout(() => {
            if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Check for Updates'; }
        }, 3000);
    }
}

function toggleActiveDevTools() {
    const wv = getActiveWebview();
    if (wv) { if (wv.isDevToolsOpened()) wv.closeDevTools(); else wv.openDevTools(); }
}
function toggleZenMode() { document.body.classList.toggle('zen-mode'); }

Object.assign(window, {
    toggleDarkReaderOnActiveTab, toggleReaderViewOnActiveTab, toggleDashboardView,
    displayAddressOverlay, triggerLinkHints, triggerGlanceHints, openPeekModal, closePeekModal,
    toggleInPageSearch, toggleDownloadShelf, toggleStatusBar, toggleClock, toggleWindowControls,
    cycleClockFormat, toggleZenMode, toggleSidebarExpansion, toggleSidebarPin, applySidebarMode,
    toggleInterfaceTheme, toggleWebviewTheme, togglePreferencesView, toggleHistoryOverlay,
    handlePrivateBrowsingStateShift, togglePrivateWorkspace, executeSurgicalCookieWipe,
    executeGlobalCacheWipe, toggleDiagnosticsView, toggleDiagnosticsRecording, cycleWebRTCPolicy,
    toggleWebRTCProtection, setWebRTCPolicy, inspectWebRTCStatus, toggleActiveDevTools,
    toggleCommandPaletteView, toggleGlobalMediaPlayback, toggleActiveTabAudioMute,
    toggleGlobalAudioMute, togglePinActiveTab, toggleSplitView, cycleSplitOrientation,
    switchSplitFocus, swapSplitPanes, closeSplitView, openUrlInSplit, toggleBookmarksOverlay,
    promptQuickmark, addCurrentPageToBookmarks, focusSidebar, testCleanGoogleSignIn, checkForUpdates: triggerUpdateCheck, promptWorkspaceCreation, promptWorkspaceRename, confirmWorkspaceDeletion
});

if (window.miseAPI && typeof window.miseAPI.onMasterShortcut === 'function') {
    window.miseAPI.onMasterShortcut((action, ...args) => {
        switch (action) {
            case 'spawn-tab': spawnNewBlankTab(); break;
            case 'spawn-tab-with-url': spawnTabWithUrl(args[0]); break;
            case 'open-link-in-split': openUrlInSplit(args[0]); break;
            case 'open-transient-share': openTransientShareModal(args[0]); break;
            case 'toggle-address': displayAddressOverlay(); break;
            case 'toggle-dashboard': toggleDashboardView(); break;
            case 'create-workspace': promptWorkspaceCreation(); break;
            case 'rename-workspace': promptWorkspaceRename(); break;
            case 'delete-workspace': confirmWorkspaceDeletion(); break;
            case 'reload-active-tab': getActiveWebview()?.reload(); break;
            case 'toggle-devtools': toggleActiveDevTools(); break;
            case 'toggle-bookmarks': toggleBookmarksOverlay(); break;
            case 'toggle-notes': toggleNotesOverlay(); break;
            case 'save-selection-to-notes': appendSelectionToNotes(args[0]); break;
            case 'export-reader-to-notes': exportActiveTabToNotes(); break;
            case 'export-reader-to-external': exportActiveTabToExternal(); break;
            case 'open-notes-external': openNotesInExternalApp(); break;
            case 'toggle-downloads': toggleDownloadShelf(); break;
            case 'toggle-find': toggleInPageSearch(); break;
            case 'remove-tab': handleTabRemoval(); break;
            case 'toggle-zen-mode': toggleSidebarExpansion(); break;
            case 'toggle-sidebar-collapse-mode': applySidebarMode(args[0]); break;
            case 'set-quickmark': promptQuickmark('set'); break;
            case 'jump-quickmark': promptQuickmark('jump'); break;
            case 'add-bookmark': addCurrentPageToBookmarks(); break;
            case 'toggle-global-media': toggleGlobalMediaPlayback(); break;
            case 'toggle-tab-audio-mute': toggleActiveTabAudioMute(); break;
            case 'toggle-global-audio-mute': toggleGlobalAudioMute(); break;
            case 'toggle-pin-tab': togglePinActiveTab(); break;
            case 'jump-to-tab-1': case 'jump-to-tab-2': case 'jump-to-tab-3': case 'jump-to-tab-4':
            case 'jump-to-tab-5': case 'jump-to-tab-6': case 'jump-to-tab-7': case 'jump-to-tab-8': case 'jump-to-tab-9':
                jumpToTabByIndex(parseInt(action.slice(-1), 10)); break;
            case 'jump-to-tab': jumpToTabByIndex(args[0]); break;
            case 'toggle-split': toggleSplitView(); break;
            case 'switch-split-focus': switchSplitFocus(); break;
            case 'swap-split-panes': swapSplitPanes(); break;
            case 'close-split': closeSplitView(); break;
            case 'delete-bookmark-entry': {
                if (state.bookmarksActive) {
                    if (state.bookmarkActiveColumn === 'quickmarks' && state.filteredQuickmarksCache[state.quickmarkSelectionIdx]) {
                        deleteQuickmark(state.filteredQuickmarksCache[state.quickmarkSelectionIdx].key);
                    } else if (state.filteredBookmarksCache[state.bookmarkSelectionIdx]) {
                        deleteBookmark(state.filteredBookmarksCache[state.bookmarkSelectionIdx].url);
                    }
                }
                break;
            }
            case 'focus-sidebar': focusSidebar(); break;
            case 'focus-nav-buttons': (document.getElementById('back-btn') || document.getElementById('toggle-nav-btn'))?.focus(); break;
            case 'focus-webview': focusActiveWebview(); break;
            case 'trigger-hints': triggerLinkHints(); break;
            case 'trigger-glance': triggerGlanceHints(); break;
            case 'toggle-palette': toggleCommandPaletteView(); break;
            case 'toggle-help': togglePreferencesView(); break;
            case 'toggle-history': toggleHistoryOverlay(); break;
            case 'toggle-status-bar': toggleStatusBar(); break;
            case 'toggle-clock': toggleClock(); break;
            case 'cycle-clock-format': cycleClockFormat(); break;
            case 'toggle-window-controls': toggleWindowControls(args[0]); break;
            case 'open-diagnostics': case 'toggle-diagnostics': toggleDiagnosticsView(); break;
            case 'toggle-diagnostics-recording': toggleDiagnosticsRecording(); break;
            case 'cycle-webrtc-policy': cycleWebRTCPolicy(); break;
            case 'toggle-webrtc-protection': toggleWebRTCProtection(); break;
            case 'webrtc-policy-balanced': setWebRTCPolicy('default_public_interface_only'); break;
            case 'webrtc-policy-strict': setWebRTCPolicy('disable_non_proxied_udp'); break;
            case 'webrtc-policy-disabled': setWebRTCPolicy('disabled'); break;
            case 'webrtc-policy-permissive': setWebRTCPolicy('default'); break;
            case 'inspect-webrtc-status': inspectWebRTCStatus(); break;
            case 'webrtc-policy-changed': {
                const policy = args[0];
                const prefSelect = document.getElementById('setting-webrtc-policy');
                if (prefSelect) prefSelect.value = policy;
                const readable = getWebRTCReadableLabel(policy);
                showNotificationToast(`WebRTC Policy: ${readable}`);
                setTargetUrl(`WebRTC Policy: ${readable}`, 3500);
                break;
            }
            case 'toggle-dark-reader': toggleDarkReaderOnActiveTab(); break;
            case 'toggle-reader-view': toggleReaderViewOnActiveTab(); break;
            case 'go-back': case 'go-back-signal': navigateFrameBack(); break;
            case 'go-forward': case 'go-forward-signal': navigateFrameForward(); break;
            case 'toggle-private-mode': togglePrivateWorkspace(); break;
            case 'hibernate-inactive-tabs': hibernateInactiveTabs(); break;
        }
    });
}

document.addEventListener('DOMContentLoaded', initializeBrowser);
