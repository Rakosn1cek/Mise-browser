import { state } from '../state.js';
import { escapeHtml, focusActiveWebview } from '../utils.js';
import { renderWorkspaceUI, switchTabFocus, spawnTabWithUrl, spawnNewBlankTab, handleTabRemoval } from '../webview.js';
import { ensureOverlayMounted, mountOverlaySync } from '../templateLoader.js';

let historyListNavigated = false;

export function toggleHistoryOverlay() {
    let overlay = document.getElementById('HistoryOverlay');
    if (!overlay && typeof mountOverlaySync === 'function') {
        overlay = mountOverlaySync('HistoryOverlay', 'history', 'body');
        if (overlay) setupHistoryOverlayListeners();
    }
    const input = document.getElementById('HistorySearchInput');
    if (!overlay) return;
    
    state.historyActive = !state.historyActive;
    if (state.historyActive) {
        if (state.paletteActive && typeof window.toggleCommandPaletteView === 'function') {
            window.toggleCommandPaletteView();
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
        if (state.diagnosticsActive && typeof window.toggleDiagnosticsView === 'function') {
            window.toggleDiagnosticsView();
        }
        if (state.notificationsActive) {
            if (typeof window.closeNotificationsOverlay === 'function') {
                window.closeNotificationsOverlay();
            } else if (typeof window.toggleNotificationsOverlay === 'function') {
                window.toggleNotificationsOverlay();
            }
        }
        if (state.taskManagerActive) {
            if (typeof window.closeTaskManagerOverlay === 'function') {
                window.closeTaskManagerOverlay();
            } else if (typeof window.toggleTaskManagerOverlay === 'function') {
                window.toggleTaskManagerOverlay();
            }
        }
        if (state.qrModalActive) {
            if (typeof window.closeQrModal === 'function') {
                window.closeQrModal();
            } else if (typeof window.toggleQrModal === 'function') {
                window.toggleQrModal();
            }
        }

        overlay.style.display = 'flex';
        state.historySelectionIdx = 0;
        historyListNavigated = false;
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

export function renderHistoryResultsList() {
    const listContainer = document.getElementById('HistoryResultsList');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const results = Array.isArray(state.historyResults) ? state.historyResults : [];
    const isHistoryDisabled = state.keepHistory === false;

    if (results.length === 0) {
        if (isHistoryDisabled) {
            listContainer.innerHTML = '<div class="history-empty">History recording is disabled in Preferences.</div>';
        } else {
            listContainer.innerHTML = '<div class="history-empty">No recent history items found.</div>';
        }
        return;
    }

    if (isHistoryDisabled) {
        const bannerEl = document.createElement('div');
        bannerEl.className = 'history-disabled-banner';
        bannerEl.textContent = 'History recording is disabled in Preferences.';
        listContainer.appendChild(bannerEl);
    }

    results.forEach((item, idx) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'history-item' + (idx === state.historySelectionIdx ? ' selected' : '');
        itemEl.setAttribute('data-idx', String(idx));

        const safeTitle = escapeHtml(item.title || item.url);
        const safeUrl = escapeHtml(item.url);

        itemEl.innerHTML = `
            <div class="history-item-content">
                <div class="history-item-title">${safeTitle}</div>
                <div class="history-item-url">${safeUrl}</div>
            </div>
            <button type="button" class="history-item-delete-btn" tabindex="-1" title="Delete Entry (x or Delete)"><i class="fa-solid fa-trash-can"></i></button>
        `;

        itemEl.addEventListener('mouseenter', () => {
            state.historySelectionIdx = idx;
            historyListNavigated = true;
            updateHistoryVisualSelection();
        });

        itemEl.addEventListener('click', (e) => {
            if (e.target && typeof e.target.closest === 'function' && e.target.closest('.history-item-delete-btn')) {
                return;
            }
            spawnTabWithUrl(item.url);
            toggleHistoryOverlay();
        });

        const deleteBtn = typeof itemEl.querySelector === 'function'
            ? itemEl.querySelector('.history-item-delete-btn')
            : null;
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteHistoryEntry(idx);
            });
        }

        listContainer.appendChild(itemEl);
    });
    updateHistoryVisualSelection();
}

export async function deleteHistoryEntry(idx = state.historySelectionIdx) {
    if (!Array.isArray(state.historyResults) || idx < 0 || idx >= state.historyResults.length) {
        return false;
    }

    const target = state.historyResults[idx];
    state.historyResults.splice(idx, 1);
    state.historySelectionIdx = state.historyResults.length > 0
        ? Math.min(idx, state.historyResults.length - 1)
        : 0;

    renderHistoryResultsList();

    if (target && window.miseAPI && typeof window.miseAPI.deleteHistoryItem === 'function') {
        try {
            await window.miseAPI.deleteHistoryItem({
                url: target.url,
                timestamp: target.timestamp
            });
        } catch (err) {
            console.error('Failed to delete history entry:', err);
        }
    }

    return true;
}

export function deleteSelectedHistoryItem() {
    return deleteHistoryEntry(state.historySelectionIdx);
}

export function filterHistoryItems(filterText) {
    const listContainer = document.getElementById('HistoryResultsList');
    if (!listContainer) return Promise.resolve();
    listContainer.innerHTML = '';

    if (!window.miseAPI || typeof window.miseAPI.searchHistory !== 'function') {
        return Promise.resolve();
    }

    const settingsPromise = (typeof window.miseAPI.getBrowserSettings === 'function')
        ? window.miseAPI.getBrowserSettings().catch(() => null)
        : Promise.resolve(null);

    return Promise.all([
        window.miseAPI.searchHistory(filterText),
        settingsPromise
    ]).then(([results, cfg]) => {
        if (cfg && typeof cfg.keep_history === 'boolean') {
            state.keepHistory = cfg.keep_history;
        }
        state.historyResults = results || [];
        state.historySelectionIdx = 0;
        renderHistoryResultsList();
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
        historyListNavigated = true;
        state.historySelectionIdx = (state.historySelectionIdx + 1) % total;
        updateHistoryVisualSelection();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        historyListNavigated = true;
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
    } else if (e.key === 'Delete') {
        const input = document.getElementById('HistorySearchInput');
        if (input && document.activeElement === input) {
            if (typeof input.selectionStart === 'number' && typeof input.selectionEnd === 'number' && input.selectionStart !== input.selectionEnd) {
                return;
            }
            if (input.value && input.value.length > 0 && typeof input.selectionStart === 'number' && input.selectionStart < input.value.length) {
                return;
            }
        }
        e.preventDefault();
        e.stopPropagation();
        deleteSelectedHistoryItem();
    } else if ((e.key === 'x' || e.key === 'X') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const input = document.getElementById('HistorySearchInput');
        if (input && document.activeElement === input && input.value && input.value.length > 0 && !historyListNavigated) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        deleteSelectedHistoryItem();
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
            historyListNavigated = false;
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
