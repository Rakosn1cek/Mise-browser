import { state } from '../state.js';
import { 
    focusActiveWebview, 
    getWorkspacePartition, 
    isTargetPrivateDomain 
} from '../utils.js';
import { 
    renderWorkspaceUI, 
    spawnTabWithUrl, 
    handleTabRemoval 
} from '../webview.js';
import { setTargetUrl } from '../statusBar.js';
import { 
    toggleDashboardView, 
    updateDashboardVisualSelection, 
    executeDashboardItemActivation, 
    showWorkspaceInputDialog, 
    hideWorkspaceInputDialog, 
    processWorkspaceCreation 
} from '../overlays/dashboard.js';

let previousNonPrivateWorkspace = 'Workspace 1';

export function togglePrivateWorkspace() {
    if (!state.sessionState.workspaces) state.sessionState.workspaces = {};
    if (!state.sessionState.workspaces['Private']) {
        state.sessionState.workspaces['Private'] = [];
    }

    const currentWS = state.sessionState.current_workspace;
    if (currentWS === 'Private') {
        const target = (previousNonPrivateWorkspace && previousNonPrivateWorkspace !== 'Private' && state.sessionState.workspaces[previousNonPrivateWorkspace])
            ? previousNonPrivateWorkspace
            : Object.keys(state.sessionState.workspaces).find(k => k !== 'Private') || 'Workspace 1';
        state.sessionState.current_workspace = target;
    } else {
        previousNonPrivateWorkspace = currentWS;
        state.sessionState.current_workspace = 'Private';
    }

    if (window.miseAPI && typeof window.miseAPI.saveSession === 'function') {
        window.miseAPI.saveSession(state.sessionState);
    }

    const container = document.getElementById('webview-container');
    if (container) {
        const allWebviews = container.querySelectorAll('webview');
        allWebviews.forEach(wv => wv.style.display = 'none');
    }
    const targetActiveTab = state.sessionState.active_tabs?.[state.sessionState.current_workspace] ?? 0;
    renderWorkspaceUI(targetActiveTab);
}

export function handlePrivateBrowsingStateShift() {
    togglePrivateWorkspace();
}

export async function executeSurgicalCookieWipe() {
    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;

    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
    const urlStr = state.sessionState.workspaces[currentWS]?.[currentIdx] || '';

    const isTargetPrivate = currentWS === 'Private' || getWorkspacePartition(currentWS) === 'MisePrivateProfile' || state.globalPrivateModeActive || isTargetPrivateDomain(urlStr);
    if (window.miseAPI && typeof window.miseAPI.clearDomainCookies === 'function') {
        await window.miseAPI.clearDomainCookies({ urlStr, isPrivate: isTargetPrivate, workspace: currentWS });
    }

    window.miseAllowWebviewFocus = true;
    focusActiveWebview();
}

export async function executeGlobalCacheWipe() {
    const currentWS = state.sessionState.current_workspace;
    const isTargetPrivate = currentWS === 'Private' || getWorkspacePartition(currentWS) === 'MisePrivateProfile' || state.globalPrivateModeActive;
    if (window.miseAPI && typeof window.miseAPI.clearActiveCache === 'function') {
        await window.miseAPI.clearActiveCache({ isPrivate: isTargetPrivate, workspace: currentWS });
    }

    window.miseAllowWebviewFocus = true;
    focusActiveWebview();
}

export async function testCleanGoogleSignIn() {
    try {
        if (window.miseAPI && typeof window.miseAPI.clearGoogleAuthCookies === 'function') {
            await window.miseAPI.clearGoogleAuthCookies('MisePrivateProfile');
        }
        setTargetUrl('Opening clean Google sign-in test in volatile partition...', 3500);
        spawnTabWithUrl('https://accounts.google.com/ServiceLogin?mise_test_auth=1');
    } catch (err) {
        console.error('Failed to launch clean Google sign-in test:', err);
    }
}

export function setupWorkspaceListeners() {
    document.getElementById('add-ws-btn')?.addEventListener('click', showWorkspaceInputDialog);
    document.getElementById('submit-ws-btn')?.addEventListener('click', processWorkspaceCreation);
    document.getElementById('cancel-ws-btn')?.addEventListener('click', hideWorkspaceInputDialog);

    document.getElementById('NewWorkspaceTitleInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') processWorkspaceCreation();
        else if (e.key === 'Escape') hideWorkspaceInputDialog();
    });

    const overlay = document.getElementById('DashboardOverlay');
    if (overlay) {
        overlay.addEventListener('keydown', (e) => {
            if (!state.dashboardActive) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                toggleDashboardView();
                return;
            }

            if (state.dashboardItems.length === 0) return;
            if (document.activeElement === document.getElementById('NewWorkspaceTitleInput') || document.activeElement?.classList.contains('dashboard-rename-input')) return;

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
    }
}
