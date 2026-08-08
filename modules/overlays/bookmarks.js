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
    const container = document.getElementById('BookmarksResultsList');
    if (!container) return;

    container.innerHTML = '';
    const query = filterText.toLowerCase().trim();
    state.filteredBookmarksCache = [];

    // 1. Build Quickmarks Cache & DOM
    const quickmarkKeys = Object.keys(state.quickmarks).filter(key => {
        const qm = state.quickmarks[key];
        return key.toLowerCase().includes(query) || 
               (qm.title && qm.title.toLowerCase().includes(query)) || 
               (qm.url && qm.url.toLowerCase().includes(query));
    });

    if (quickmarkKeys.length > 0) {
        const qmHeader = document.createElement('div');
        qmHeader.className = 'quickmarks-section-title';
        qmHeader.textContent = 'Quickmarks (Ctrl + J + [key])';
        container.appendChild(qmHeader);

        quickmarkKeys.forEach(key => {
            const qm = state.quickmarks[key];
            const itemObj = { type: 'quickmark', key: key, url: qm.url, title: qm.title };
            state.filteredBookmarksCache.push(itemObj);

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

            container.appendChild(itemEl);
        });
    }

    // 2. Build Standard Bookmarks Cache & DOM
    const matchingBookmarks = state.bookmarks.filter(bm => 
        (bm.title && bm.title.toLowerCase().includes(query)) || 
        (bm.url && bm.url.toLowerCase().includes(query))
    );

    if (matchingBookmarks.length > 0) {
        const bmHeader = document.createElement('div');
        bmHeader.className = 'quickmarks-section-title';
        bmHeader.textContent = 'Bookmarks';
        container.appendChild(bmHeader);

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

            container.appendChild(itemEl);
        });
    }

    if (state.filteredBookmarksCache.length === 0) {
        container.innerHTML = '<div class="history-empty">No bookmarks or quickmarks found.</div>';
        state.bookmarkSelectionIdx = 0;
        return;
    }

    if (state.bookmarkSelectionIdx >= state.filteredBookmarksCache.length) {
        state.bookmarkSelectionIdx = Math.max(0, state.filteredBookmarksCache.length - 1);
    }

    updateBookmarkVisualSelection();
}

export function updateBookmarkVisualSelection() {
    const items = document.querySelectorAll('#BookmarksResultsList .bookmark-item-row');
    items.forEach((item, idx) => {
        if (idx === state.bookmarkSelectionIdx) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
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
        await window.miseAPI.saveQuickmarks(state.quickmarks);
    }
    const searchInput = document.getElementById('BookmarkSearchInput');
    renderBookmarksList(searchInput ? searchInput.value : '');
}

export function setupBookmarkOverlayListeners() {
    const searchInput = document.getElementById('BookmarkSearchInput');
    const closeBtn = document.getElementById('CloseBookmarksBtn');
    const overlay = document.getElementById('BookmarksOverlay');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.bookmarkSelectionIdx = 0;
            renderBookmarksList(e.target.value);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                toggleBookmarksOverlay();
                return;
            }

            if (state.filteredBookmarksCache.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                state.bookmarkSelectionIdx = (state.bookmarkSelectionIdx + 1) % state.filteredBookmarksCache.length;
                updateBookmarkVisualSelection();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                state.bookmarkSelectionIdx = (state.bookmarkSelectionIdx - 1 + state.filteredBookmarksCache.length) % state.filteredBookmarksCache.length;
                updateBookmarkVisualSelection();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const targetItem = state.filteredBookmarksCache[state.bookmarkSelectionIdx];
                if (targetItem && targetItem.url) {
                    spawnTabWithUrl(targetItem.url);
                    toggleBookmarksOverlay();
                }
            } else if (e.key === 'Delete') {
                e.preventDefault();
                const targetItem = state.filteredBookmarksCache[state.bookmarkSelectionIdx];
                if (targetItem) {
                    if (targetItem.type === 'quickmark') {
                        deleteQuickmark(targetItem.key);
                    } else if (targetItem.type === 'bookmark') {
                        deleteBookmark(targetItem.url);
                    }
                }
            }
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
