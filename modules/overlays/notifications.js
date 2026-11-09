// modules/overlays/notifications.js
// Dedicated keyboard-driven Notifications & Activity Overlay controller

import { state } from '../state.js';
import { escapeHtml, focusActiveWebview } from '../utils.js';
import { ensureOverlayMounted, mountOverlaySync } from '../templateLoader.js';

const MAX_NOTIFICATIONS = 50;
const VALID_FILTERS = ['all', 'downloads', 'system', 'web'];

const notificationFeed = [];
let activeFilter = 'all';
let selectedIndex = 0;

/**
 * Normalises and formats notification timestamps for display.
 * @param {number} timestamp Epoch timestamp in milliseconds
 * @returns {string} Human-readable relative or formatted time
 */
export function formatNotificationTimestamp(timestamp) {
    if (!timestamp || typeof timestamp !== 'number') return '';
    const now = Date.now();
    const diffSec = Math.floor((now - timestamp) / 1000);
    if (diffSec < 45) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDays = Math.floor(diffHour / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

/**
 * Resolves an appropriate FontAwesome icon for a given notification category.
 * @param {string} category Category identifier
 * @param {string} [customIcon] Optional custom icon override
 * @returns {string} CSS icon classes
 */
function resolveNotificationIcon(category, customIcon) {
    if (customIcon) return customIcon;
    switch (category) {
        case 'downloads': return 'fa-solid fa-arrow-down';
        case 'web': return 'fa-solid fa-globe';
        case 'system':
        default: return 'fa-solid fa-shield-halved';
    }
}

/**
 * Ingests a new activity event into the bounded circular buffer.
 * @param {Object} item Notification item definition
 * @returns {Object} Ingested notification item
 */
export function addNotificationItem(item) {
    if (!item || typeof item !== 'object') return null;

    const rawCategory = String(item.category || 'system').toLowerCase();
    const category = (VALID_FILTERS.includes(rawCategory) && rawCategory !== 'all') ? rawCategory : 'system';
    const id = item.id ? String(item.id) : `noti-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = typeof item.timestamp === 'number' ? item.timestamp : Date.now();

    const normalisedItem = {
        id,
        category,
        title: item.title ? String(item.title) : 'Notification',
        message: item.message ? String(item.message) : '',
        details: item.details ? String(item.details) : '',
        timestamp,
        icon: resolveNotificationIcon(category, item.icon),
        unread: item.unread !== false,
        actionLabel: item.actionLabel ? String(item.actionLabel) : '',
        action: typeof item.action === 'function' ? item.action : null,
        state: item.state ? String(item.state) : ''
    };

    const existingIdx = notificationFeed.findIndex((n) => n.id === id);
    if (existingIdx !== -1) {
        notificationFeed[existingIdx] = {
            ...notificationFeed[existingIdx],
            ...normalisedItem
        };
    } else {
        notificationFeed.unshift(normalisedItem);
        if (notificationFeed.length > MAX_NOTIFICATIONS) {
            notificationFeed.length = MAX_NOTIFICATIONS;
        }
    }

    updateUnreadIndicators();

    if (isOverlayVisible()) {
        renderNotificationsUI();
    }

    return normalisedItem;
}

/**
 * Dismisses a single notification item by identifier.
 * @param {string} id Notification identifier
 * @returns {boolean} True if found and removed
 */
export function dismissNotificationItem(id) {
    if (!id) return false;
    const targetIdx = notificationFeed.findIndex((item) => item.id === id);
    if (targetIdx === -1) return false;

    notificationFeed.splice(targetIdx, 1);

    const filtered = getNotificationFeed(activeFilter);
    if (selectedIndex >= filtered.length) {
        selectedIndex = Math.max(0, filtered.length - 1);
    }
    state.notificationsSelectionIdx = selectedIndex;

    updateUnreadIndicators();
    renderNotificationsUI();
    return true;
}

/**
 * Clears notifications in the active category view or globally.
 * @param {string} [filter] Category filter to clear (defaults to activeFilter)
 */
export function clearNotifications(filter = activeFilter) {
    if (filter && filter !== 'all') {
        const remaining = notificationFeed.filter((item) => item.category !== filter);
        notificationFeed.length = 0;
        notificationFeed.push(...remaining);
    } else {
        notificationFeed.length = 0;
    }

    selectedIndex = 0;
    state.notificationsSelectionIdx = 0;

    updateUnreadIndicators();
    renderNotificationsUI();
}

/**
 * Retrieves the current activity feed, optionally filtered.
 * @param {string} [filter] Optional category filter
 * @returns {Array<Object>} List of notification items
 */
export function getNotificationFeed(filter = null) {
    const target = filter || activeFilter;
    if (target && target !== 'all') {
        return notificationFeed.filter((item) => item.category === target);
    }
    return [...notificationFeed];
}

/**
 * Sets the active category filter and refreshes view.
 * @param {string} filter Target filter chip name
 */
export function setNotificationFilter(filter) {
    const clean = String(filter || 'all').toLowerCase();
    if (!VALID_FILTERS.includes(clean)) return;

    activeFilter = clean;
    state.notificationsFilter = activeFilter;
    selectedIndex = 0;
    state.notificationsSelectionIdx = 0;

    const overlay = document.getElementById('NotificationsOverlay');
    if (overlay) {
        const chips = overlay.querySelectorAll('.notifications-filter-chip');
        chips.forEach((chip) => {
            const isMatch = chip.dataset.filter === activeFilter;
            chip.classList.toggle('active', isMatch);
            if (typeof chip.setAttribute === 'function') {
                chip.setAttribute('aria-selected', isMatch ? 'true' : 'false');
            }
        });
    }

    renderNotificationsUI();
}

/**
 * Cycles to the next or previous category filter chip.
 * @param {number} direction +1 for next, -1 for previous
 */
export function cycleNotificationFilter(direction = 1) {
    const currentIndex = VALID_FILTERS.indexOf(activeFilter);
    const validIdx = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (validIdx + direction + VALID_FILTERS.length) % VALID_FILTERS.length;
    setNotificationFilter(VALID_FILTERS[nextIndex]);

    const overlay = document.getElementById('NotificationsOverlay');
    if (overlay) {
        const activeChip = overlay.querySelector(`.notifications-filter-chip[data-filter="${VALID_FILTERS[nextIndex]}"]`);
        if (activeChip && typeof activeChip.focus === 'function') {
            activeChip.focus({ preventScroll: true });
        }
    }
}

export function getNotificationFilter() {
    return activeFilter;
}

export function getSelectedIndex() {
    return selectedIndex;
}

export function setSelectedIndex(idx) {
    const filtered = getNotificationFeed(activeFilter);
    if (filtered.length === 0) {
        selectedIndex = 0;
    } else {
        selectedIndex = Math.max(0, Math.min(filtered.length - 1, idx));
    }
    state.notificationsSelectionIdx = selectedIndex;
    updateVisualSelection();
}

/**
 * Triggers the primary action of the highlighted notification item.
 */
export function triggerSelectedAction() {
    const filtered = getNotificationFeed(activeFilter);
    const item = filtered[selectedIndex];
    if (item && typeof item.action === 'function') {
        try {
            item.action();
        } catch (err) {
            console.error('[Notifications] Failed to execute item action:', err);
        }
    }
}

/**
 * Dismisses the highlighted notification item.
 */
export function dismissSelectedNotification() {
    const filtered = getNotificationFeed(activeFilter);
    const item = filtered[selectedIndex];
    if (item) {
        dismissNotificationItem(item.id);
    }
}

/**
 * Updates visual selection state across rendered feed items.
 */
function updateVisualSelection() {
    const feedEl = document.getElementById('NotificationsFeed');
    if (!feedEl) return;

    const items = feedEl.querySelectorAll('.notification-item');
    items.forEach((itemEl, idx) => {
        const isSelected = idx === selectedIndex;
        itemEl.classList.toggle('selected', isSelected);
        if (isSelected) {
            itemEl.scrollIntoView({ block: 'nearest' });
        }
    });
}

/**
 * Updates unread badges in the overlay header and sidebar bell button.
 */
function updateUnreadIndicators() {
    if (typeof document === 'undefined') return;

    const unreadCount = notificationFeed.filter((item) => item.unread).length;
    const badge = document.getElementById('NotificationsCountBadge');
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = String(unreadCount);
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }

    const bellBtn = document.getElementById('noti-toggle-btn');
    if (bellBtn) {
        bellBtn.classList.toggle('has-unread', unreadCount > 0);
    }
}

/**
 * Helper to check whether NotificationsOverlay is currently visible in DOM.
 * @returns {boolean} True if mounted and visible
 */
function isOverlayVisible() {
    if (typeof document === 'undefined') return false;
    const overlay = document.getElementById('NotificationsOverlay');
    return Boolean(overlay && overlay.style.display !== 'none' && overlay.style.display !== '');
}

/**
 * Renders the notifications activity feed and empty state.
 */
export function renderNotificationsUI() {
    if (typeof document === 'undefined') return;

    const feedEl = document.getElementById('NotificationsFeed');
    const emptyStateEl = document.getElementById('NotificationsEmptyState');
    if (!feedEl) return;

    const filtered = getNotificationFeed(activeFilter);

    if (filtered.length === 0) {
        feedEl.innerHTML = '';
        feedEl.style.display = 'none';
        if (emptyStateEl) {
            emptyStateEl.style.display = 'flex';
            const desc = emptyStateEl.querySelector('.notifications-empty-desc');
            if (desc) {
                if (activeFilter === 'all') {
                    desc.textContent = 'Recent downloads, system alerts, and web events will appear here.';
                } else {
                    desc.textContent = `No ${activeFilter} notifications recorded yet.`;
                }
            }
        }
        return;
    }

    if (emptyStateEl) emptyStateEl.style.display = 'none';
    feedEl.style.display = 'flex';

    if (selectedIndex >= filtered.length) {
        selectedIndex = Math.max(0, filtered.length - 1);
    }
    state.notificationsSelectionIdx = selectedIndex;

    const markup = filtered.map((item, idx) => {
        const isSelected = idx === selectedIndex;
        const safeTitle = escapeHtml(item.title);
        const safeMessage = escapeHtml(item.message);
        const safeDetails = item.details ? `<div class="notification-item-details">${escapeHtml(item.details)}</div>` : '';
        const safeTime = formatNotificationTimestamp(item.timestamp);
        const actionBtn = item.actionLabel
            ? `<button class="notification-primary-btn" data-action="primary">${escapeHtml(item.actionLabel)}</button>`
            : '';

        return `
            <div class="notification-item${isSelected ? ' selected' : ''}" data-id="${escapeHtml(item.id)}" data-idx="${idx}" tabindex="-1">
                <div class="notification-icon-col ${escapeHtml(item.category)}">
                    <i class="${escapeHtml(item.icon)}"></i>
                </div>
                <div class="notification-content-col">
                    <div class="notification-title-row">
                        <span class="notification-item-title">${safeTitle}</span>
                        <span class="notification-item-time">${safeTime}</span>
                    </div>
                    <div class="notification-item-message">${safeMessage}</div>
                    ${safeDetails}
                </div>
                <div class="notification-actions-col">
                    ${actionBtn}
                    <button class="notification-dismiss-btn" data-action="dismiss" title="Dismiss item (x)"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
        `;
    }).join('');

    feedEl.innerHTML = markup;

    // Attach interaction listeners to rendered notification cards
    feedEl.querySelectorAll('.notification-item').forEach((itemEl) => {
        const id = itemEl.dataset.id;
        const idx = parseInt(itemEl.dataset.idx, 10);

        itemEl.addEventListener('mouseenter', () => {
            selectedIndex = idx;
            state.notificationsSelectionIdx = selectedIndex;
            updateVisualSelection();
        });

        itemEl.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('[data-action="primary"]');
            const dismissBtn = e.target.closest('[data-action="dismiss"]');

            if (dismissBtn) {
                e.stopPropagation();
                dismissNotificationItem(id);
                return;
            }

            if (actionBtn) {
                e.stopPropagation();
                const targetItem = notificationFeed.find((n) => n.id === id);
                if (targetItem && typeof targetItem.action === 'function') {
                    targetItem.action();
                }
                return;
            }

            selectedIndex = idx;
            state.notificationsSelectionIdx = selectedIndex;
            updateVisualSelection();

            const targetItem = notificationFeed.find((n) => n.id === id);
            if (targetItem && typeof targetItem.action === 'function') {
                targetItem.action();
            }
        });
    });

    updateVisualSelection();
}

/**
 * Sets up event listeners for the notifications overlay elements.
 * @param {HTMLElement} overlayEl Root overlay DOM element
 */
export function setupNotificationsListeners(overlayEl) {
    if (!overlayEl) return;

    // Keyboard navigation within overlay
    overlayEl.addEventListener('keydown', (e) => {
        const filtered = getNotificationFeed(activeFilter);

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeNotificationsOverlay();
            return;
        }

        // Horizontal navigation: ArrowLeft / ArrowRight or vim h / l
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'h' || e.key === 'l') {
            const isInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
            if (!isInput) {
                e.preventDefault();
                e.stopPropagation();
                const direction = (e.key === 'ArrowRight' || e.key === 'l') ? 1 : -1;
                cycleNotificationFilter(direction);
                return;
            }
        }

        // Direct number jump: 1 = All, 2 = Downloads, 3 = System, 4 = Web
        if (['1', '2', '3', '4'].includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const numIndex = parseInt(e.key, 10) - 1;
            if (numIndex >= 0 && numIndex < VALID_FILTERS.length) {
                e.preventDefault();
                e.stopPropagation();
                setNotificationFilter(VALID_FILTERS[numIndex]);
                const targetChip = overlayEl.querySelector(`.notifications-filter-chip[data-filter="${VALID_FILTERS[numIndex]}"]`);
                if (targetChip && typeof targetChip.focus === 'function') {
                    targetChip.focus({ preventScroll: true });
                }
                return;
            }
        }

        if (e.key === 'ArrowDown' || e.key === 'j') {
            e.preventDefault();
            e.stopPropagation();
            if (filtered.length > 0) {
                selectedIndex = Math.min(filtered.length - 1, selectedIndex + 1);
                state.notificationsSelectionIdx = selectedIndex;
                updateVisualSelection();
            }
            return;
        }

        if (e.key === 'ArrowUp' || e.key === 'k') {
            e.preventDefault();
            e.stopPropagation();
            if (filtered.length > 0) {
                selectedIndex = Math.max(0, selectedIndex - 1);
                state.notificationsSelectionIdx = selectedIndex;
                updateVisualSelection();
            }
            return;
        }

        if (e.key === 'x' || e.key === 'X') {
            e.preventDefault();
            e.stopPropagation();
            dismissSelectedNotification();
            return;
        }

        if (e.key === 'c' || e.key === 'C') {
            e.preventDefault();
            e.stopPropagation();
            clearNotifications(activeFilter);
            return;
        }

        if (e.key === 'Enter') {
            const focusedEl = document.activeElement;
            const isChip = focusedEl && focusedEl.classList && focusedEl.classList.contains('notifications-filter-chip');
            const isButton = focusedEl && focusedEl.tagName === 'BUTTON';
            if (isChip) {
                // Allow normal button activation
                return;
            }
            if (isButton && focusedEl !== overlayEl) {
                // Allow button click to fire natively
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            triggerSelectedAction();
            return;
        }

        if (e.key === 'Tab') {
            // Keep Tab navigation trapped smoothly inside the overlay card
            const focusables = Array.from(overlayEl.querySelectorAll('button:not([disabled]), [tabindex="0"]'))
                .filter((el) => el !== overlayEl && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.offsetParent !== null || el.style.display !== 'none'));
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === overlayEl)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    });

    // Filter chip clicks and keyboard activation
    const filterStrip = overlayEl.querySelector('.notifications-filter-strip');
    if (filterStrip) {
        filterStrip.addEventListener('click', (e) => {
            const chip = e.target.closest('.notifications-filter-chip');
            if (!chip) return;
            const targetFilter = chip.dataset.filter;
            if (targetFilter) {
                setNotificationFilter(targetFilter);
                chip.focus({ preventScroll: true });
            }
        });
    }

    // Action button clicks
    const clearBtn = overlayEl.querySelector('#ClearNotificationsBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearNotifications(activeFilter);
        });
    }

    const closeBtn = overlayEl.querySelector('#CloseNotificationsBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeNotificationsOverlay();
        });
    }

    // Backdrop click dismiss
    overlayEl.addEventListener('click', (e) => {
        if (e.target === overlayEl) {
            closeNotificationsOverlay();
        }
    });
}

/**
 * Closes all other active overlays to prevent focus and display collisions.
 */
function closeOtherOverlays() {
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
    if (state.historyActive && typeof window.toggleHistoryOverlay === 'function') {
        window.toggleHistoryOverlay();
    }
}

/**
 * Opens the notifications activity overlay.
 */
export function openNotificationsOverlay() {
    let overlay = document.getElementById('NotificationsOverlay');
    if (!overlay && typeof mountOverlaySync === 'function') {
        overlay = mountOverlaySync('NotificationsOverlay', 'notifications', '#webview-container');
        if (overlay) setupNotificationsListeners(overlay);
    }
    if (!overlay) return;

    closeOtherOverlays();

    state.notificationsActive = true;
    overlay.style.display = 'flex';

    // Mark current items as read
    notificationFeed.forEach((item) => {
        item.unread = false;
    });
    updateUnreadIndicators();

    renderNotificationsUI();
    overlay.focus();
}

/**
 * Closes the notifications activity overlay and returns focus cleanly to webview.
 */
export function closeNotificationsOverlay() {
    const overlay = document.getElementById('NotificationsOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    state.notificationsActive = false;

    window.miseAllowWebviewFocus = true;
    focusActiveWebview();
}

/**
 * Toggles the notifications activity overlay.
 */
export async function toggleNotificationsOverlay() {
    let overlay = document.getElementById('NotificationsOverlay');
    if (!overlay && typeof mountOverlaySync === 'function') {
        overlay = mountOverlaySync('NotificationsOverlay', 'notifications', '#webview-container');
        if (overlay) setupNotificationsListeners(overlay);
    }
    if (!overlay && typeof ensureOverlayMounted === 'function') {
        overlay = await ensureOverlayMounted('NotificationsOverlay', 'notifications', '#webview-container', setupNotificationsListeners);
    }
    if (!overlay) return;

    const isVisible = overlay.style.display !== 'none' && overlay.style.display !== '';
    if (isVisible) {
        closeNotificationsOverlay();
    } else {
        openNotificationsOverlay();
    }
}

/**
 * Helper to record a background web notification.
 * @param {Object} data Web notification data
 */
export function recordWebNotification(data) {
    if (!data) return;
    addNotificationItem({
        category: 'web',
        title: data.title || 'Web Notification',
        message: data.body || '',
        details: data.url || '',
        timestamp: Date.now(),
        icon: 'fa-solid fa-globe',
        actionLabel: data.url ? 'Open' : '',
        action: data.url && typeof window.spawnTabWithUrl === 'function' ? () => window.spawnTabWithUrl(data.url) : null
    });
}

/**
 * Resets notification module state (designed for testing environments).
 */
export function resetNotificationState() {
    notificationFeed.length = 0;
    activeFilter = 'all';
    selectedIndex = 0;
    state.notificationsActive = false;
    state.notificationsFilter = 'all';
    state.notificationsSelectionIdx = 0;
}

// Bind to window context for global access across controllers and tests
if (typeof window !== 'undefined') {
    window.toggleNotificationsOverlay = toggleNotificationsOverlay;
    window.openNotificationsOverlay = openNotificationsOverlay;
    window.closeNotificationsOverlay = closeNotificationsOverlay;
    window.addNotificationItem = addNotificationItem;
    window.dismissNotificationItem = dismissNotificationItem;
    window.clearNotifications = clearNotifications;
    window.getNotificationFeed = getNotificationFeed;
    window.setNotificationFilter = setNotificationFilter;
    window.cycleNotificationFilter = cycleNotificationFilter;
    window.recordWebNotification = recordWebNotification;
    window.resetNotificationState = resetNotificationState;
}
