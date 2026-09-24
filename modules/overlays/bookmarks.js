import { state } from '../state.js';
import { escapeHtml, focusActiveWebview, getActiveWebview } from '../utils.js';
import { renderWorkspaceUI, switchTabFocus, spawnTabWithUrl, spawnNewBlankTab, handleTabRemoval } from '../webview.js';

export async function loadBookmarksAndQuickmarks() {
    if (window.miseAPI) {
        state.bookmarks = await window.miseAPI.readBookmarks();
        state.quickmarks = await window.miseAPI.readQuickmarks();
    }
}

export function promptQuickmark(mode) {
    state.quickmarkMode = mode;
    state.awaitingQuickmarkKey = true;

    if (document.activeElement) {
        document.activeElement.blur();
    }
    window.focus();

    const listener = (e) => {
        if (['control', 'shift', 'alt', 'meta'].includes(e.key.toLowerCase())) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        window.removeEventListener('keydown', listener, true);

        state.awaitingQuickmarkKey = false;

        if (e.key === 'Escape') {
            focusActiveWebview();
            return;
        }

        const key = e.key.toLowerCase();

        if (state.quickmarkMode === 'set') {
            const activeWv = getActiveWebview();
            if (!activeWv) return;
            const url = activeWv.getURL();
            const title = activeWv.getTitle() || url;

            state.quickmarks[key] = { url, title };
            if (window.miseAPI && typeof window.miseAPI.saveQuickmarks === 'function') {
                window.miseAPI.saveQuickmarks(state.quickmarks);
            }
            focusActiveWebview();
        } else if (state.quickmarkMode === 'jump') {
            if (state.quickmarks[key]) {
                spawnTabWithUrl(state.quickmarks[key].url);
            } else {
                focusActiveWebview();
            }
        }
    };

    window.addEventListener('keydown', listener, true);
}

export async function addCurrentPageToBookmarks() {
    const activeWv = getActiveWebview();
    if (!activeWv) return;
    
    const url = activeWv.getURL();
    const title = activeWv.getTitle() || url;
    
    if (!url || url === 'about:blank') return;

    if (!state.bookmarks.some(b => b.url === url)) {
        state.bookmarks.unshift({ title, url, timestamp: Date.now() });
        await window.miseAPI.saveBookmarks(state.bookmarks);
    }
}

export function toggleBookmarksOverlay() {
    const overlay = document.getElementById('BookmarksOverlay');
    const input = document.getElementById('BookmarkSearchInput');

    if (!overlay) return;

    state.bookmarksActive = !state.bookmarksActive;

    if (state.bookmarksActive) {
        overlay.style.display = 'flex';
        state.bookmarkActiveColumn = 'quickmarks';
        state.quickmarkSelectionIdx = 0;
        state.bookmarkSelectionIdx = 0;
        if (input) {
            input.value = '';
            input.focus();
        }
        renderBookmarksList('');
    } else {
        overlay.style.display = 'none';
        focusActiveWebview();
    }
}

export function renderBookmarksList(filterText = '') {
    const qmContainer = document.getElementById('QuickmarksResultsList');
    const bmContainer = document.getElementById('BookmarksResultsList');
    if (!qmContainer || !bmContainer) return;

    qmContainer.innerHTML = '';
    bmContainer.innerHTML = '';
    const query = filterText.toLowerCase().trim();
    state.filteredQuickmarksCache = [];
    state.filteredBookmarksCache = [];

    // Build quickmarks cache and dom
    const quickmarkKeys = Object.keys(state.quickmarks).filter(key => {
        const qm = state.quickmarks[key];
        return key.toLowerCase().includes(query) || 
               (qm.title && qm.title.toLowerCase().includes(query)) || 
               (qm.url && qm.url.toLowerCase().includes(query));
    });

    if (quickmarkKeys.length > 0) {
        quickmarkKeys.forEach(key => {
            const qm = state.quickmarks[key];
            const itemObj = { type: 'quickmark', key: key, url: qm.url, title: qm.title };
            state.filteredQuickmarksCache.push(itemObj);

            const itemEl = document.createElement('div');
            itemEl.className = 'bookmark-item-row quickmark-row';
            itemEl.setAttribute('tabindex', '-1');

            itemEl.innerHTML = `
                <div class="quickmark-key-badge">${escapeHtml(key.toUpperCase())}</div>
                <div class="bookmark-info">
                    <div class="history-item-title">${escapeHtml(qm.title)}</div>
                    <div class="history-item-url">${escapeHtml(qm.url)}</div>
                </div>
                <button class="bookmark-delete-btn" title="Delete Quickmark"><i class="fa-solid fa-trash-can"></i></button>
            `;

            itemEl.querySelector('.bookmark-info').addEventListener('click', () => {
                spawnTabWithUrl(qm.url);
                toggleBookmarksOverlay();
            });

            itemEl.querySelector('.bookmark-delete-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                deleteQuickmark(key);
            });

            qmContainer.appendChild(itemEl);
        });
    } else {
        qmContainer.innerHTML = '<div class="history-empty">No quickmarks found.</div>';
    }

    // Build standard bookmarks cache and dom
    const matchingBookmarks = state.bookmarks.filter(bm => 
        (bm.title && bm.title.toLowerCase().includes(query)) || 
        (bm.url && bm.url.toLowerCase().includes(query))
    );

    if (matchingBookmarks.length > 0) {
        matchingBookmarks.forEach(bm => {
            const itemObj = { type: 'bookmark', url: bm.url, title: bm.title };
            state.filteredBookmarksCache.push(itemObj);

            const itemEl = document.createElement('div');
            itemEl.className = 'bookmark-item-row';
            itemEl.setAttribute('tabindex', '-1');

            itemEl.innerHTML = `
                <div class="bookmark-info">
                    <div class="history-item-title">${escapeHtml(bm.title)}</div>
                    <div class="history-item-url">${escapeHtml(bm.url)}</div>
                </div>
                <button class="bookmark-delete-btn" title="Delete Bookmark"><i class="fa-solid fa-trash-can"></i></button>
            `;

            itemEl.querySelector('.bookmark-info').addEventListener('click', () => {
                spawnTabWithUrl(bm.url);
                toggleBookmarksOverlay();
            });

            itemEl.querySelector('.bookmark-delete-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                deleteBookmark(bm.url);
            });

            bmContainer.appendChild(itemEl);
        });
    } else {
        bmContainer.innerHTML = '<div class="history-empty">No bookmarks found.</div>';
    }

    if (state.quickmarkSelectionIdx >= state.filteredQuickmarksCache.length) {
        state.quickmarkSelectionIdx = Math.max(0, state.filteredQuickmarksCache.length - 1);
    }
    if (state.bookmarkSelectionIdx >= state.filteredBookmarksCache.length) {
        state.bookmarkSelectionIdx = Math.max(0, state.filteredBookmarksCache.length - 1);
    }

    updateBookmarkVisualSelection();
}

export function updateBookmarkVisualSelection() {
    const qmItems = document.querySelectorAll('#QuickmarksResultsList .bookmark-item-row');
    const bmItems = document.querySelectorAll('#BookmarksResultsList .bookmark-item-row');
    const qmPane = document.getElementById('QuickmarksResultsList')?.closest('.bookmarks-column-pane');
    const bmPane = document.getElementById('BookmarksResultsList')?.closest('.bookmarks-column-pane');

    qmItems.forEach((item, idx) => {
        if (state.bookmarkActiveColumn === 'quickmarks' && idx === state.quickmarkSelectionIdx) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });

    bmItems.forEach((item, idx) => {
        if (state.bookmarkActiveColumn === 'bookmarks' && idx === state.bookmarkSelectionIdx) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });

    if (qmPane && bmPane) {
        if (state.bookmarkActiveColumn === 'quickmarks') {
            qmPane.classList.add('active-pane');
            bmPane.classList.remove('active-pane');
        } else {
            bmPane.classList.add('active-pane');
            qmPane.classList.remove('active-pane');
        }
    }
}

export async function deleteBookmark(url) {
    if (!url) return;
    state.bookmarks = state.bookmarks.filter(bm => bm.url !== url);
    if (window.miseAPI && typeof window.miseAPI.saveBookmarks === 'function') {
        await window.miseAPI.saveBookmarks(state.bookmarks);
    }
    const searchInput = document.getElementById('BookmarkSearchInput');
    renderBookmarksList(searchInput ? searchInput.value : '');
}

export async function deleteQuickmark(key) {
    if (!key || !state.quickmarks[key]) return;
    delete state.quickmarks[key];
    if (window.miseAPI && typeof window.miseAPI.saveQuickmarks === 'function') {
        window.miseAPI.saveQuickmarks(state.quickmarks);
    }
    const searchInput = document.getElementById('BookmarkSearchInput');
    renderBookmarksList(searchInput ? searchInput.value : '');
}

export function setupBookmarkOverlayListeners() {
    const searchInput = document.getElementById('BookmarkSearchInput');
    const closeBtn = document.getElementById('CloseBookmarksBtn');
    const overlay = document.getElementById('BookmarksOverlay');

    window.addEventListener('keydown', (e) => {
        if (!state.bookmarksActive) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            toggleBookmarksOverlay();
            return;
        }

        const activeEl = document.activeElement;
        const isInsideOverlay = overlay && overlay.contains(activeEl);
        const isBodyOrNull = !activeEl || activeEl === document.body;

        if (isInsideOverlay || isBodyOrNull) {
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (state.bookmarkActiveColumn === 'quickmarks' && state.filteredBookmarksCache.length > 0) {
                    state.bookmarkActiveColumn = 'bookmarks';
                    updateBookmarkVisualSelection();
                }
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (state.bookmarkActiveColumn === 'bookmarks' && state.filteredQuickmarksCache.length > 0) {
                    state.bookmarkActiveColumn = 'quickmarks';
                    updateBookmarkVisualSelection();
                }
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const currentCache = state.bookmarkActiveColumn === 'quickmarks' ? state.filteredQuickmarksCache : state.filteredBookmarksCache;
                if (currentCache.length > 0) {
                    let selIdx = state.bookmarkActiveColumn === 'quickmarks' ? state.quickmarkSelectionIdx : state.bookmarkSelectionIdx;
                    if (e.key === 'ArrowDown') {
                        selIdx = (selIdx + 1) % currentCache.length;
                    } else {
                        selIdx = (selIdx - 1 + currentCache.length) % currentCache.length;
                    }
                    if (state.bookmarkActiveColumn === 'quickmarks') state.quickmarkSelectionIdx = selIdx;
                    else state.bookmarkSelectionIdx = selIdx;
                    updateBookmarkVisualSelection();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const currentCache = state.bookmarkActiveColumn === 'quickmarks' ? state.filteredQuickmarksCache : state.filteredBookmarksCache;
                let selIdx = state.bookmarkActiveColumn === 'quickmarks' ? state.quickmarkSelectionIdx : state.bookmarkSelectionIdx;
                const targetItem = currentCache[selIdx];
                if (targetItem && targetItem.url) {
                    spawnTabWithUrl(targetItem.url);
                    toggleBookmarksOverlay();
                }
            } else if (e.key === 'Delete') {
                e.preventDefault();
                const currentCache = state.bookmarkActiveColumn === 'quickmarks' ? state.filteredQuickmarksCache : state.filteredBookmarksCache;
                let selIdx = state.bookmarkActiveColumn === 'quickmarks' ? state.quickmarkSelectionIdx : state.bookmarkSelectionIdx;
                const targetItem = currentCache[selIdx];
                if (targetItem) {
                    if (targetItem.type === 'quickmark') {
                        deleteQuickmark(targetItem.key);
                    } else if (targetItem.type === 'bookmark') {
                        deleteBookmark(targetItem.url);
                    }
                }
            }
        }
    });

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.quickmarkSelectionIdx = 0;
            state.bookmarkSelectionIdx = 0;
            renderBookmarksList(e.target.value);
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', toggleBookmarksOverlay);
    }

    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target.id === 'BookmarksOverlay') {
                toggleBookmarksOverlay();
            }
        });
    }
}
