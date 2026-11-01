import { state } from '../state.js';
import { focusActiveWebview, getWorkspacePartition, isReservedWorkspaceName } from '../utils.js';
import { renderWorkspaceUI, switchTabFocus, spawnTabWithUrl, spawnNewBlankTab, handleTabRemoval, moveTabState, destroyGuestWebview } from '../webview.js';
import { transferTab } from '../tabTransfer.js';

let currentDialogMode = 'create';
let renameTargetWorkspace = '';

export function toggleDashboardView() {
    if (state.paletteActive && typeof window.toggleCommandPaletteView === 'function') {
        window.toggleCommandPaletteView();
    }
    if (state.preferencesActive && typeof window.togglePreferencesView === 'function') {
        window.togglePreferencesView();
    }
    
    const overlay = document.getElementById('DashboardOverlay');
    state.dashboardActive = !state.dashboardActive;

    if (state.dashboardActive) {
        buildDashboardTree();
        overlay.style.display = 'flex';
        overlay.focus();
        const allWebviews = document.getElementById('webview-container').querySelectorAll('webview');
        allWebviews.forEach((wv) => wv.style.display = 'none');
    } else {
        overlay.style.display = 'none';
        const currentWS = state.sessionState.current_workspace;
        const activeListItem = document.querySelector('#TabList li.selected');
        let currentIdx = activeListItem ? Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem) : -1;
        if (currentIdx < 0) {
            const savedTab = state.sessionState.active_tabs?.[currentWS];
            const urls = state.sessionState.workspaces?.[currentWS] || [];
            currentIdx = (typeof savedTab === 'number' && savedTab >= 0 && savedTab < urls.length) ? savedTab : 0;
        }
        switchTabFocus(currentIdx);
    }
}

export function renameWorkspace(oldName, newName) {
    if (String(oldName).trim().toLowerCase() === 'private') return;
    if (isReservedWorkspaceName(oldName)) return;
    const trimmed = newName ? newName.trim() : '';
    if (!trimmed || trimmed.toLowerCase() === 'private' || isReservedWorkspaceName(trimmed) || trimmed === oldName || state.sessionState.workspaces[trimmed]) return;

    // Migrate workspace tabs and references
    state.sessionState.workspaces[trimmed] = state.sessionState.workspaces[oldName];
    delete state.sessionState.workspaces[oldName];

    // Dispose cached webviews so they are re-created with the new container partition
    if (state.activeViewsCache[oldName]) {
        state.activeViewsCache[oldName].forEach(wv => destroyGuestWebview(wv));
        delete state.activeViewsCache[oldName];
    }

    if (state.activeTitlesCache[oldName]) {
        state.activeTitlesCache[trimmed] = state.activeTitlesCache[oldName];
        delete state.activeTitlesCache[oldName];
    }

    if (state.tabSleepStates[oldName]) {
        state.tabSleepStates[trimmed] = state.tabSleepStates[oldName];
        delete state.tabSleepStates[oldName];
    }
    if (state.tabActivityTimestamps[oldName]) {
        state.tabActivityTimestamps[trimmed] = state.tabActivityTimestamps[oldName];
        delete state.tabActivityTimestamps[oldName];
    }
    if (state.tabMediaAudible[oldName]) {
        state.tabMediaAudible[trimmed] = state.tabMediaAudible[oldName];
        delete state.tabMediaAudible[oldName];
    }
    if (state.tabPinned[oldName]) {
        state.tabPinned[trimmed] = state.tabPinned[oldName];
        delete state.tabPinned[oldName];
    }
    if (state.tabAudioMuted[oldName]) {
        state.tabAudioMuted[trimmed] = state.tabAudioMuted[oldName];
        delete state.tabAudioMuted[oldName];
    }
    if (state.sessionState.tab_pinned?.[oldName]) {
        state.sessionState.tab_pinned[trimmed] = state.sessionState.tab_pinned[oldName];
        delete state.sessionState.tab_pinned[oldName];
    }
    if (state.sessionState.tab_titles?.[oldName]) {
        state.sessionState.tab_titles[trimmed] = state.sessionState.tab_titles[oldName];
        delete state.sessionState.tab_titles[oldName];
    }
    if (state.sessionState.tab_sleep_states?.[oldName]) {
        state.sessionState.tab_sleep_states[trimmed] = state.sessionState.tab_sleep_states[oldName];
        delete state.sessionState.tab_sleep_states[oldName];
    }

    if (state.sessionState.active_tabs?.[oldName] !== undefined) {
        state.sessionState.active_tabs[trimmed] = state.sessionState.active_tabs[oldName];
        delete state.sessionState.active_tabs[oldName];
    }

    if (state.sessionState.current_workspace === oldName) {
        state.sessionState.current_workspace = trimmed;
    }

    window.miseAPI.saveSession(state.sessionState);
    const targetWs = state.sessionState.current_workspace;
    const targetTab = (state.sessionState.active_tabs && typeof state.sessionState.active_tabs[targetWs] === 'number')
        ? state.sessionState.active_tabs[targetWs]
        : 0;
    renderWorkspaceUI(targetTab);
    buildDashboardTree();
}

export function deleteWorkspace(wsName) {
    if (String(wsName).trim().toLowerCase() === 'private') return;
    if (isReservedWorkspaceName(wsName)) return;
    const totalWorkspaces = Object.keys(state.sessionState.workspaces);
    if (totalWorkspaces.length <= 1) return;

    if (wsName === state.sessionState.current_workspace) {
        const sortedNonPrivate = totalWorkspaces
            .filter(k => k !== 'Private')
            .sort((a, b) => a.localeCompare(b));
        const currentIdx = sortedNonPrivate.indexOf(wsName);
        let fallbackWS = 'Default';
        if (currentIdx > 0) {
            fallbackWS = sortedNonPrivate[currentIdx - 1];
        } else if (sortedNonPrivate.length > 1) {
            fallbackWS = sortedNonPrivate[1];
        } else {
            fallbackWS = totalWorkspaces.find(k => k !== wsName) || 'Default';
        }
        state.sessionState.current_workspace = fallbackWS;
    }

    if (state.activeViewsCache[wsName]) {
        state.activeViewsCache[wsName].forEach(wv => destroyGuestWebview(wv));
        delete state.activeViewsCache[wsName];
    }
    delete state.activeTitlesCache[wsName];
    delete state.tabSleepStates[wsName];
    delete state.tabActivityTimestamps[wsName];
    delete state.tabMediaAudible[wsName];
    delete state.tabPinned[wsName];
    delete state.tabAudioMuted[wsName];
    if (state.sessionState.tab_pinned?.[wsName]) delete state.sessionState.tab_pinned[wsName];
    if (state.sessionState.tab_titles?.[wsName]) delete state.sessionState.tab_titles[wsName];
    if (state.sessionState.tab_sleep_states?.[wsName]) delete state.sessionState.tab_sleep_states[wsName];
    if (state.sessionState.active_tabs?.[wsName] !== undefined) delete state.sessionState.active_tabs[wsName];
    delete state.sessionState.workspaces[wsName];
    
    window.miseAPI.saveSession(state.sessionState);
    const targetWs = state.sessionState.current_workspace;
    const targetTab = (state.sessionState.active_tabs && typeof state.sessionState.active_tabs[targetWs] === 'number')
        ? state.sessionState.active_tabs[targetWs]
        : 0;
    renderWorkspaceUI(targetTab);
    if (state.dashboardActive) {
        buildDashboardTree();
        const overlay = document.getElementById('DashboardOverlay');
        if (overlay) overlay.focus();
    }
}

export function buildDashboardTree() {
    const container = document.getElementById('DashboardTreeContainer');
    container.innerHTML = '';
    state.dashboardItems = [];

    if (!state.sessionState.workspaces) state.sessionState.workspaces = {};
    if (!state.sessionState.workspaces['Private']) {
        state.sessionState.workspaces['Private'] = [];
    }

    const wsKeys = Object.keys(state.sessionState.workspaces).sort((a, b) => {
        if (a === 'Private') return -1;
        if (b === 'Private') return 1;
        return a.localeCompare(b);
    });

    wsKeys.forEach((wsName) => {
        const isPrivate = wsName === 'Private';
        const node = document.createElement('div');
        node.className = 'workspace-tree-node';

        const headerContainer = document.createElement('div');
        headerContainer.className = 'workspace-tree-header';
        headerContainer.style.display = 'flex';
        headerContainer.style.alignItems = 'center';
        headerContainer.style.justifyContent = 'space-between';

        const titleSpan = document.createElement('span');
        if (isPrivate) {
            titleSpan.innerHTML = '<i class="fa-solid fa-shield-halved" style="margin-right: 6px; color: #f7768e;"></i>Private' + (wsName === state.sessionState.current_workspace ? ' (Active)' : '');
        } else {
            titleSpan.textContent = wsName + (wsName === state.sessionState.current_workspace ? ' (Active)' : '');
        }
        titleSpan.style.flex = '1';
        titleSpan.style.cursor = 'pointer';

        const actionsDiv = document.createElement('div');
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '6px';

        if (!isPrivate) {
            // Trigger inline edit mode
            const activateRenameMode = () => {
                const input = document.createElement('input');
                input.type = 'text';
                input.value = wsName;
                input.className = 'dashboard-rename-input';
                input.style.flex = '1';
                input.style.background = 'var(--bg-main)';
                input.style.color = 'var(--text)';
                input.style.border = '1px solid var(--accent)';
                input.style.borderRadius = '3px';
                input.style.padding = '2px 6px';
                input.style.fontSize = '14px';
                input.style.outline = 'none';

                let saved = false;
                const submitRename = () => {
                    if (saved) return;
                    saved = true;
                    const val = input.value.trim();
                    if (val && val !== wsName) {
                        renameWorkspace(wsName, val);
                    } else {
                        buildDashboardTree();
                    }
                };

                input.addEventListener('keydown', (ie) => {
                    ie.stopPropagation();
                    if (ie.key === 'Enter') {
                        submitRename();
                    } else if (ie.key === 'Escape') {
                        saved = true;
                        buildDashboardTree();
                    }
                });

                input.addEventListener('blur', submitRename);

                headerContainer.replaceChild(input, titleSpan);
                input.focus();
                input.select();
            };

            // Dedicated Rename Button
            const renameBtn = document.createElement('button');
            renameBtn.className = 'nav-icon-button';
            renameBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
            renameBtn.title = 'Rename Workspace';
            renameBtn.style.width = '24px';
            renameBtn.style.height = '24px';
            renameBtn.style.fontSize = '11px';
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                activateRenameMode();
            });
            actionsDiv.appendChild(renameBtn);

            // Dedicated Delete Button
            if (wsKeys.length > 1) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'nav-icon-button';
                deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
                deleteBtn.title = 'Delete Workspace';
                deleteBtn.style.width = '24px';
                deleteBtn.style.height = '24px';
                deleteBtn.style.fontSize = '11px';
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteWorkspace(wsName);
                });
                actionsDiv.appendChild(deleteBtn);
            }
        }

        const containerTag = document.createElement('span');
        containerTag.className = 'workspace-container-tag';
        const partitionName = getWorkspacePartition(wsName);
        containerTag.textContent = isPrivate ? 'volatile' : partitionName.replace('persist:', '');
        containerTag.style.fontSize = '11px';
        containerTag.style.fontFamily = 'monospace';
        containerTag.style.color = isPrivate ? '#f7768e' : 'var(--accent)';
        containerTag.style.background = isPrivate ? 'rgba(247, 118, 142, 0.12)' : 'rgba(255,255,255,0.06)';
        containerTag.style.padding = '1px 6px';
        containerTag.style.borderRadius = '3px';
        containerTag.style.marginRight = '8px';
        containerTag.title = isPrivate ? 'Volatile partition: MisePrivateProfile' : `Container Partition: ${partitionName}`;

        headerContainer.appendChild(titleSpan);
        headerContainer.appendChild(containerTag);
        headerContainer.appendChild(actionsDiv);
        
        const wsPayload = ['workspace', wsName, null];
        const wsItemRef = { element: headerContainer, payload: wsPayload };
        state.dashboardItems.push(wsItemRef);

        titleSpan.addEventListener('click', () => {
            executeDashboardItemActivation(wsPayload);
        });

        headerContainer.addEventListener('dragover', (e) => e.preventDefault());
        headerContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                const sourceWS = data.workspace;
                const sourceIdx = data.index;
                const targetWS = wsName;

                transferTab(state, sourceWS, sourceIdx, targetWS);
                window.miseAPI.saveSession(state.sessionState);
                renderWorkspaceUI();
                buildDashboardTree();
            } catch (err) {
                console.error("Workspace drop failed:", err);
            }
        });

        node.appendChild(headerContainer);

        const urls = state.sessionState.workspaces[wsName] || [];
        urls.forEach((url, idx) => {
            const tabItem = document.createElement('div');
            tabItem.className = 'dashboard-tab-item';
            const cachedTitle = (state.activeTitlesCache[wsName] && state.activeTitlesCache[wsName][idx]) || url;
            const isSleeping = state.tabSleepStates[wsName] && state.tabSleepStates[wsName][idx];
            const isPinned = !!state.tabPinned?.[wsName]?.[idx];
            const pinBadge = isPinned ? ' 📌' : '';
            const sleepBadge = isSleeping ? ' 🌙' : '';
            tabItem.textContent = `- ${cachedTitle}${pinBadge}${sleepBadge}`;
            
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

                    let targetIdx = idx;
                    if (sourceWS === targetWS && sourceIdx < idx) {
                        targetIdx--;
                    }

                    if (sourceWS === targetWS) {
                        moveTabState(sourceWS, sourceIdx, targetIdx);
                        window.miseAPI.saveSession(state.sessionState);
                        renderWorkspaceUI();
                        buildDashboardTree();
                        return;
                    }

                    transferTab(state, sourceWS, sourceIdx, targetWS, targetIdx);
                    window.miseAPI.saveSession(state.sessionState);
                    renderWorkspaceUI();
                    buildDashboardTree();
                } catch (err) {
                    console.error("Tab reorder/move drop failed:", err);
                }
            });

            const tabPayload = ['tab', wsName, idx];
            const tabItemRef = { element: tabItem, payload: tabPayload };
            state.dashboardItems.push(tabItemRef);

            tabItem.addEventListener('click', () => {
                executeDashboardItemActivation(tabPayload);
            });

            node.appendChild(tabItem);
        });

        container.appendChild(node);
    });

    const activeWsIdx = state.dashboardItems.findIndex(item => item.payload[0] === 'workspace' && item.payload[1] === state.sessionState.current_workspace);
    if (activeWsIdx >= 0) {
        state.dashboardSelectionIdx = activeWsIdx;
    } else {
        state.dashboardSelectionIdx = Math.min(state.dashboardSelectionIdx, state.dashboardItems.length - 1);
        if (state.dashboardSelectionIdx < 0) state.dashboardSelectionIdx = 0;
    }
    updateDashboardVisualSelection();

    const overlay = document.getElementById('DashboardOverlay');
    if (state.dashboardActive && overlay) {
        overlay.focus();
    }
}

export function updateDashboardVisualSelection() {
    state.dashboardItems.forEach((item, idx) => {
        if (idx === state.dashboardSelectionIdx) {
            item.element.classList.add('dashboard-selected');
            item.element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.element.classList.remove('dashboard-selected');
        }
    });
}

export function executeDashboardItemActivation(payload) {
    const [type, wsName, idx] = payload;
    state.sessionState.current_workspace = wsName;
    window.miseAPI.saveSession(state.sessionState);
    
    const container = document.getElementById('webview-container');
    const allWebviews = container.querySelectorAll('webview');
    allWebviews.forEach(wv => wv.style.display = 'none');

    state.dashboardActive = false;
    document.getElementById('DashboardOverlay').style.display = 'none';

    if (type === 'tab') {
        renderWorkspaceUI(idx);
    } else {
        const lastActive = state.sessionState.active_tabs?.[wsName] ?? 0;
        renderWorkspaceUI(lastActive);
    }
}

export function showWorkspaceInputDialog(mode = 'create', targetWs = '') {
    const container = document.getElementById('WorkspaceInputBox');
    const input = document.getElementById('NewWorkspaceTitleInput');
    const submitBtn = document.getElementById('submit-ws-btn');
    if (container && input) {
        currentDialogMode = mode;
        renameTargetWorkspace = targetWs;
        container.style.display = 'flex';
        input.value = mode === 'rename' ? targetWs : '';
        input.placeholder = mode === 'rename' ? 'New workspace name...' : 'Workspace name...';
        if (submitBtn) submitBtn.textContent = mode === 'rename' ? 'Rename' : 'Save';
        input.focus();
        if (mode === 'rename') input.select();
        setTimeout(() => {
            if (document.activeElement !== input) {
                input.focus();
                if (mode === 'rename') input.select();
            }
        }, 50);
    }
}

export function hideWorkspaceInputDialog() {
    const container = document.getElementById('WorkspaceInputBox');
    if (container) container.style.display = 'none';
    currentDialogMode = 'create';
    renameTargetWorkspace = '';
    const overlay = document.getElementById('DashboardOverlay');
    if (overlay && state.dashboardActive) overlay.focus();
}

export function processWorkspaceCreation() {
    const input = document.getElementById('NewWorkspaceTitleInput');
    const name = input ? input.value.trim() : '';
    if (!name || name.toLowerCase() === 'private' || isReservedWorkspaceName(name)) {
        hideWorkspaceInputDialog();
        return;
    }

    if (currentDialogMode === 'rename' && renameTargetWorkspace) {
        renameWorkspace(renameTargetWorkspace, name);
        hideWorkspaceInputDialog();
        return;
    }

    if (!state.sessionState.workspaces[name]) {
        state.sessionState.workspaces[name] = [];
        state.sessionState.current_workspace = name;
        window.miseAPI.saveSession(state.sessionState);
        hideWorkspaceInputDialog();
        
        const overlay = document.getElementById('DashboardOverlay');
        state.dashboardActive = false;
        if (overlay) overlay.style.display = 'none';
        renderWorkspaceUI();
    } else {
        hideWorkspaceInputDialog();
    }
}

export function promptWorkspaceCreation() {
    if (!state.dashboardActive) toggleDashboardView();
    showWorkspaceInputDialog('create');
}

export function promptWorkspaceRename(wsName) {
    const targetWs = wsName || state.sessionState.current_workspace;
    if (String(targetWs).trim().toLowerCase() === 'private' || isReservedWorkspaceName(targetWs)) {
        return;
    }
    if (!state.dashboardActive) toggleDashboardView();
    showWorkspaceInputDialog('rename', targetWs);
}

export function confirmWorkspaceDeletion(wsName) {
    const targetWs = wsName || state.sessionState.current_workspace;
    if (String(targetWs).trim().toLowerCase() === 'private' || isReservedWorkspaceName(targetWs)) {
        return false;
    }
    const totalWorkspaces = Object.keys(state.sessionState.workspaces || {});
    if (totalWorkspaces.length <= 1) {
        return false;
    }

    const tabCount = state.sessionState.workspaces[targetWs]?.length || 0;
    if (tabCount > 0) {
        const confirmed = window.confirm(`Workspace "${targetWs}" has ${tabCount} open tab(s). Are you sure you want to delete it?`);
        if (!confirmed) return false;
    }

    deleteWorkspace(targetWs);
    return true;
}
