import { state } from '../state.js';
import { focusActiveWebview } from '../utils.js';
import { renderWorkspaceUI, switchTabFocus, spawnTabWithUrl, spawnNewBlankTab, handleTabRemoval } from '../webview.js';

export function toggleDashboardView() {
    if (state.paletteActive && typeof window.toggleCommandPaletteView === 'function') {
        window.toggleCommandPaletteView();
    }
    if (state.helpActive && typeof window.toggleHelpMenuWindow === 'function') {
        window.toggleHelpMenuWindow();
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

export function buildDashboardTree() {
    const container = document.getElementById('DashboardTreeContainer');
    container.innerHTML = '';
    state.dashboardItems = [];

    Object.keys(state.sessionState.workspaces).forEach((wsName) => {
        const node = document.createElement('div');
        node.className = 'workspace-tree-node';

        const header = document.createElement('div');
        header.className = 'workspace-tree-header';
        header.textContent = wsName + (wsName === state.sessionState.current_workspace ? ' (Active)' : '');
        
        const wsPayload = ['workspace', wsName, null];
        const wsItemRef = { element: header, payload: wsPayload };
        state.dashboardItems.push(wsItemRef);

        header.addEventListener('click', () => {
            executeDashboardItemActivation(wsPayload);
        });

        header.addEventListener('dragover', (e) => e.preventDefault());
        header.addEventListener('drop', (e) => {
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

        node.appendChild(header);

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
        state.sessionState.workspaces[name] = ["https://duckduckgo.com"];
        state.sessionState.current_workspace = name;
        window.miseAPI.saveSession(state.sessionState);
        hideWorkspaceInputDialog();
        
        const overlay = document.getElementById('DashboardOverlay');
        state.dashboardActive = false;
        overlay.style.display = 'none';
        renderWorkspaceUI(0);
    } else {
        hideWorkspaceInputDialog();
    }
}
