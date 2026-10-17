import { state } from '../state.js';
import { escapeHtml, focusActiveWebview } from '../utils.js';
import { renderWorkspaceUI, switchTabFocus, spawnTabWithUrl, spawnNewBlankTab, handleTabRemoval } from '../webview.js';

export function toggleHistoryOverlay() {
    const overlay = document.getElementById('HistoryOverlay');
    const input = document.getElementById('HistorySearchInput');
    if (!overlay) return;
    
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
        if (state.bookmarksActive && typeof window.toggleBookmarksOverlay === 'function') {
            window.toggleBookmarksOverlay();
        }
        if (state.notesActive && typeof window.toggleNotesOverlay === 'function') {
            window.toggleNotesOverlay();
        }
        if (state.preferencesActive && typeof window.togglePreferencesView === 'function') {
            window.togglePreferencesView();
        }

        overlay.style.display = 'flex';
        state.historySelectionIdx = 0;
        if (input) {
            input.value = '';
            input.focus();
        }
        filterHistoryItems('');
    } else {
        overlay.style.display = 'none';
        focusActiveWebview();
    }
}

export function updateHistoryVisualSelection() {
    const listContainer = document.getElementById('HistoryResultsList');
    if (!listContainer) return;

    const items = listContainer.querySelectorAll('.history-item');
    items.forEach((itemEl, idx) => {
        if (idx === state.historySelectionIdx) {
            itemEl.classList.add('selected');
            itemEl.scrollIntoView({ block: 'nearest' });
        } else {
            itemEl.classList.remove('selected');
        }
    });
}

export function filterHistoryItems(filterText) {
    const listContainer = document.getElementById('HistoryResultsList');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    if (!window.miseAPI || typeof window.miseAPI.searchHistory !== 'function') return;

    window.miseAPI.searchHistory(filterText).then((results) => {
        state.historyResults = results || [];
        state.historySelectionIdx = 0;

        if (state.historyResults.length === 0) {
            listContainer.innerHTML = '<div class="history-empty">No recent history items found.</div>';
            return;
        }

        state.historyResults.forEach((item, idx) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'history-item' + (idx === state.historySelectionIdx ? ' selected' : '');
            itemEl.setAttribute('data-idx', String(idx));
            
            const safeTitle = escapeHtml(item.title || item.url);
            const safeUrl = escapeHtml(item.url);

            itemEl.innerHTML = `
                <div class="history-item-title">${safeTitle}</div>
                <div class="history-item-url">${safeUrl}</div>
            `;

            itemEl.addEventListener('mouseenter', () => {
                state.historySelectionIdx = idx;
                updateHistoryVisualSelection();
            });

            itemEl.addEventListener('click', () => {
                spawnTabWithUrl(item.url);
                toggleHistoryOverlay();
            });

            listContainer.appendChild(itemEl);
        });
        updateHistoryVisualSelection();
    }).catch((err) => {
        console.error('Failed to load history:', err);
    });
}

export function handleHistoryKeyDown(e) {
    if (!state.historyActive) return;

    // Instant Escape dismissal
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        toggleHistoryOverlay();
        return;
    }

    // Focus trap cycling between input and header action buttons
    if (e.key === 'Tab') {
        const input = document.getElementById('HistorySearchInput');
        const purgeBtn = document.getElementById('PurgeHistoryBtn');
        const closeBtn = document.getElementById('CloseHistoryBtn');
        const focusable = [input, purgeBtn, closeBtn].filter(Boolean);

        if (focusable.length > 0) {
            const activeEl = document.activeElement;
            const currentIdx = focusable.indexOf(activeEl);

            if (e.shiftKey) {
                if (currentIdx <= 0) {
                    e.preventDefault();
                    focusable[focusable.length - 1].focus();
                }
            } else {
                if (currentIdx === -1 || currentIdx >= focusable.length - 1) {
                    e.preventDefault();
                    focusable[0].focus();
                }
            }
        }
        return;
    }

    const total = state.historyResults ? state.historyResults.length : 0;
    if (total === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        state.historySelectionIdx = (state.historySelectionIdx + 1) % total;
        updateHistoryVisualSelection();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        state.historySelectionIdx = (state.historySelectionIdx - 1 + total) % total;
        updateHistoryVisualSelection();
    } else if (e.key === 'Enter') {
        // Activate currently selected item
        e.preventDefault();
        e.stopPropagation();
        const selected = state.historyResults[state.historySelectionIdx];
        if (selected && selected.url) {
            spawnTabWithUrl(selected.url);
            toggleHistoryOverlay();
        }
    }
}

let historyListenersInitialised = false;

export function setupHistoryOverlayListeners() {
    if (historyListenersInitialised) return;

    const overlay = document.getElementById('HistoryOverlay');
    const input = document.getElementById('HistorySearchInput');
    const closeBtn = document.getElementById('CloseHistoryBtn');
    const purgeBtn = document.getElementById('PurgeHistoryBtn');

    if (!overlay && !input) return;
    historyListenersInitialised = true;

    if (input) {
        input.addEventListener('input', (e) => {
            state.historySelectionIdx = 0;
            filterHistoryItems(e.target.value.trim());
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', toggleHistoryOverlay);
    }

    if (purgeBtn) {
        purgeBtn.addEventListener('click', async () => {
            const confirmPurge = confirm('Are you sure you want to permanently delete all history?');
            if (confirmPurge && window.miseAPI && typeof window.miseAPI.purgeHistory === 'function') {
                const success = await window.miseAPI.purgeHistory();
                if (success) {
                    state.historySelectionIdx = 0;
                    filterHistoryItems('');
                }
            }
        });
    }

    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target.id === 'HistoryOverlay') {
                toggleHistoryOverlay();
            }
        });
    }

    window.addEventListener('keydown', handleHistoryKeyDown, true);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupHistoryOverlayListeners);
    } else {
        setupHistoryOverlayListeners();
    }
}
