import { state } from '../state.js';
import { escapeHtml, focusActiveWebview } from '../utils.js';
import { renderWorkspaceUI, switchTabFocus, spawnTabWithUrl, spawnNewBlankTab, handleTabRemoval } from '../webview.js';

export function toggleHistoryOverlay() {
    const overlay = document.getElementById('HistoryOverlay');
    const input = document.getElementById('HistorySearchInput');
    
    state.historyActive = !state.historyActive;
    if (state.historyActive) {
        if (state.paletteActive && typeof window.toggleCommandPaletteView === 'function') {
            window.toggleCommandPaletteView();
        }
        if (state.helpActive && typeof window.toggleHelpMenuWindow === 'function') {
            window.toggleHelpMenuWindow();
        }
        if (state.dashboardActive && typeof window.toggleDashboardView === 'function') {
            window.toggleDashboardView();
        }

        overlay.style.display = 'flex';
        input.value = '';
        input.focus();
        filterHistoryItems('');
    } else {
        overlay.style.display = 'none';
        focusActiveWebview();
    }
}

export function filterHistoryItems(filterText) {
    const listContainer = document.getElementById('HistoryResultsList');
    listContainer.innerHTML = '';

    window.miseAPI.searchHistory(filterText).then((results) => {
        state.historyResults = results;

        if (state.historyResults.length === 0) {
            listContainer.innerHTML = '<div class="history-empty">No recent history items found.</div>';
            return;
        }

        state.historyResults.forEach((item) => {
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
