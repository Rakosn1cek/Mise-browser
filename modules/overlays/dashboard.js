import { state } from '../state.js';
import { focusActiveWebview } from '../utils.js';
import { renderWorkspaceUI, switchTabFocus, spawnTabWithUrl, spawnNewBlankTab, handleTabRemoval } from '../webview.js';

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
        const activeListItem = document.querySelector('#TabList li.selected');
        const currentIdx = activeListItem ? Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem) : 0;
        switchTabFocus(currentIdx);
    }
}

export function renameWorkspace(oldName, newName) {
    const trimmed = newName ? newName.trim() : '';
    if (!trimmed || trimmed === oldName || state.sessionState.workspaces[trimmed]) return;

    // Migrate workspace tabs and references
    state.sessionState.workspaces[trimmed] = state.sessionState.workspaces[oldName];
    delete state.sessionState.workspaces[oldName];

    if (state.activeViewsCache[oldName]) {
        state.activeViewsCache[trimmed] = state.activeViewsCache[oldName];
        delete state.activeViewsCache[oldName];
    }

    if (state.activeTitlesCache[oldName]) {
        state.activeTitlesCache[trimmed] = state.activeTitlesCache[oldName];
        delete state.activeTitlesCache[oldName];
    }

    if (state.sessionState.current_workspace === oldName) {
        state.sessionState.current_workspace = trimmed;
    }

    window.miseAPI.saveSession(state.sessionState);
    renderWorkspaceUI();
    buildDashboardTree();
}

export function deleteWorkspace(wsName) {
    const totalWorkspaces = Object.keys(state.sessionState.workspaces);
    if (totalWorkspaces.length <= 1) return;

    if (wsName === state.sessionState.current_workspace) {
        const fallbackWS = totalWorkspaces.find(k => k !== wsName);
        state.sessionState.current_workspace = fallbackWS;
    }

    if (state.activeViewsCache[wsName]) {
        state.activeViewsCache[wsName].forEach(wv => wv.remove());
        delete state.activeViewsCache[wsName];
    }
    delete state.activeTitlesCache[wsName];
    delete state.sessionState.workspaces[wsName];
    
    window.miseAPI.saveSession(state.sessionState);
    renderWorkspaceUI();
    buildDashboardTree();
}

export function buildDashboardTree() {
    const container = document.getElementById('DashboardTreeContainer');
    container.innerHTML = '';
    state.dashboardItems = [];

    const wsKeys = Object.keys(state.sessionState.workspaces);

    wsKeys.forEach((wsName) => {
        const node = document.createElement('div');
        node.className = 'workspace-tree-node';

        const headerContainer = document.createElement('div');
        headerContainer.className = 'workspace-tree-header';
        headerContainer.style.display = 'flex';
        headerContainer.style.alignItems = 'center';
        headerContainer.style.justifyContent = 'space-between';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = wsName + (wsName === state.sessionState.current_workspace ? ' (Active)' : '');
        titleSpan.style.flex = '1';
        titleSpan.style.cursor = 'pointer';

        const actionsDiv = document.createElement('div');
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '6px';

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

        headerContainer.appendChild(titleSpan);
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

                if (sourceWS === targetWS) return;

                const [movedUrl] = state.sessionState.workspaces[sourceWS].splice(sourceIdx, 1);
                if (!state.sessionState.workspaces[targetWS]) {
                    state.sessionState.workspaces[targetWS] = [];
                }
                state.sessionState.workspaces[targetWS].push(movedUrl);

                if (state.activeViewsCache[sourceWS] && state.activeViewsCache[sourceWS][sourceIdx]) {
                    const [movedView] = state.activeViewsCache[sourceWS].splice(sourceIdx, 1);
                    if (!state.activeViewsCache[targetWS]) state.activeViewsCache[targetWS] = [];
                    state.activeViewsCache[targetWS].push(movedView);
                }

                if (state.activeTitlesCache[sourceWS] && state.activeTitlesCache[sourceWS][sourceIdx]) {
                    const [movedTitle] = state.activeTitlesCache[sourceWS].splice(sourceIdx, 1);
                    if (!state.activeTitlesCache[targetWS]) state.activeTitlesCache[targetWS] = [];
                    state.activeTitlesCache[targetWS].push(movedTitle);
                }

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
            tabItem.textContent = `- ${cachedTitle}`;
            
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

                    const [movedUrl] = state.sessionState.workspaces[sourceWS].splice(sourceIdx, 1);
                    
                    let targetIdx = idx;
                    if (sourceWS === targetWS && sourceIdx < idx) {
                        targetIdx--;
                    }
                    
                    if (!state.sessionState.workspaces[targetWS]) {
                        state.sessionState.workspaces[targetWS] = [];
                    }
                    state.sessionState.workspaces[targetWS].splice(targetIdx, 0, movedUrl);

                    if (state.activeViewsCache[sourceWS] && state.activeViewsCache[sourceWS][sourceIdx]) {
                        const [movedView] = state.activeViewsCache[sourceWS].splice(sourceIdx, 1);
                        if (!state.activeViewsCache[targetWS]) state.activeViewsCache[targetWS] = [];
                        state.activeViewsCache[targetWS].splice(targetIdx, 0, movedView);
                    }

                    if (state.activeTitlesCache[sourceWS] && state.activeTitlesCache[sourceWS][sourceIdx]) {
                        const [movedTitle] = state.activeTitlesCache[sourceWS].splice(sourceIdx, 1);
                        if (!state.activeTitlesCache[targetWS]) state.activeTitlesCache[targetWS] = [];
                        state.activeTitlesCache[targetWS].splice(targetIdx, 0, movedTitle);
                    }

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

    state.dashboardSelectionIdx = Math.min(state.dashboardSelectionIdx, state.dashboardItems.length - 1);
    if (state.dashboardSelectionIdx < 0) state.dashboardSelectionIdx = 0;
    updateDashboardVisualSelection();
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
        renderWorkspaceUI(0);
    }
}

export function showWorkspaceInputDialog() {
    const container = document.getElementById('WorkspaceInputBox');
    const input = document.getElementById('NewWorkspaceTitleInput');
    if (container && input) {
        container.style.display = 'flex';
        input.value = '';
        input.focus();
    }
}

export function hideWorkspaceInputDialog() {
    document.getElementById('WorkspaceInputBox').style.display = 'none';
    document.getElementById('DashboardOverlay').focus();
}

export function processWorkspaceCreation() {
    const input = document.getElementById('NewWorkspaceTitleInput');
    const name = input.value.trim();
    if (!name) return;

    if (!state.sessionState.workspaces[name]) {
        state.sessionState.workspaces[name] = [];
        state.sessionState.current_workspace = name;
        window.miseAPI.saveSession(state.sessionState);
        hideWorkspaceInputDialog();
        
        const overlay = document.getElementById('DashboardOverlay');
        state.dashboardActive = false;
        overlay.style.display = 'none';
        renderWorkspaceUI();
    } else {
        hideWorkspaceInputDialog();
    }
}
