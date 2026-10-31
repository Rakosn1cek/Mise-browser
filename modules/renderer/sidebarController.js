import { state } from '../state.js';
import { focusActiveWebview } from '../utils.js';
import { 
    switchTabFocus, 
    jumpToTabByIndex, 
    spawnNewBlankTab, 
    handleTabRemoval 
} from '../webview.js';
import { displayAddressOverlay } from '../navigation.js';
import { toggleDashboardView } from '../overlays/dashboard.js';
import { setTargetUrl, togglePassthroughMode } from '../statusBar.js';

export const defaultOverlayIds = [
    'PaletteInput', 'PaletteList', 'PreferencesOverlay',
    'BookmarksOverlay', 'BookmarkSearchInput', 'HistoryOverlay',
    'HistorySearchInput', 'NotesOverlay', 'NotesTextArea',
    'DashboardOverlay', 'ShareModalOverlay', 'PeekModalOverlay',
    'FindBarOverlay', 'DiagnosticsOverlay'
];

export function applySidebarMode(autoCollapse) {
    const body = document.body;
    const pinBtn = document.getElementById('pin-sidebar-btn');
    if (autoCollapse) {
        body.classList.remove('sidebar-pinned');
        body.classList.add('sidebar-auto-collapse');
        if (pinBtn) pinBtn.classList.remove('pin-active');
    } else {
        body.classList.remove('sidebar-auto-collapse');
        body.classList.add('sidebar-pinned');
        if (pinBtn) pinBtn.classList.add('pin-active');
        const sidebar = document.getElementById('Sidebar');
        if (sidebar) sidebar.classList.remove('expanded');
    }
}

export function toggleSidebarExpansion() {
    const sidebar = document.getElementById('Sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('expanded');
    if (sidebar.classList.contains('expanded')) {
        const selectedTab = document.querySelector('#TabList li.selected');
        if (selectedTab) selectedTab.focus();
    } else {
        focusActiveWebview();
    }
}

export async function toggleSidebarPin() {
    const isCurrentlyPinned = document.body.classList.contains('sidebar-pinned');
    const newAutoCollapse = isCurrentlyPinned;
    applySidebarMode(newAutoCollapse);
    if (window.miseAPI && typeof window.miseAPI.updateBrowserSettings === 'function') {
        try {
            await window.miseAPI.updateBrowserSettings({ sidebar_auto_collapse: newAutoCollapse });
        } catch (e) {}
    }
}

export function focusSidebar() {
    const activeEl = document.activeElement;
    const isInsideTabList = activeEl && (activeEl.closest('#TabList') || activeEl.id === 'TabList');
    const isInsideNavAction = activeEl && activeEl.closest('.nav-action-layout');
    const isInsideBottomLayout = activeEl && activeEl.closest('.bottom-theme-layout');

    if (isInsideTabList) {
        const backBtn = document.getElementById('back-btn') || document.getElementById('toggle-nav-btn');
        if (backBtn) backBtn.focus();
    } else if (isInsideNavAction || isInsideBottomLayout) {
        const selectedTab = document.querySelector('#TabList li.selected') || document.querySelector('#TabList li');
        if (selectedTab) selectedTab.focus();
    } else {
        const selectedTab = document.querySelector('#TabList li.selected') || document.querySelector('#TabList li');
        if (selectedTab) {
            selectedTab.focus();
        } else {
            const navBtn = document.getElementById('back-btn') || document.getElementById('toggle-nav-btn');
            if (navBtn) navBtn.focus();
        }
    }
}

export function setupSidebarListeners(overlayIds = defaultOverlayIds) {
    const pinSidebarBtn = document.getElementById('pin-sidebar-btn');
    if (pinSidebarBtn) {
        pinSidebarBtn.onclick = () => toggleSidebarPin();
    }

    const topNavIds = ['back-btn', 'forward-btn', 'toggle-nav-btn', 'split-toggle-btn', 'menu-btn'];
    topNavIds.forEach((id, idx) => {
        const btn = document.getElementById(id);
        if (!btn) return;

        btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                const nextIdx = (idx + 1) % topNavIds.length;
                document.getElementById(topNavIds[nextIdx])?.focus();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const prevIdx = (idx - 1 + topNavIds.length) % topNavIds.length;
                document.getElementById(topNavIds[prevIdx])?.focus();
            } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
                e.preventDefault();
                const selectedTab = document.querySelector('#TabList li.selected') || document.querySelector('#TabList li');
                if (selectedTab) selectedTab.focus();
            } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
                e.preventDefault();
                const notiBtn = document.getElementById('noti-toggle-btn') || document.getElementById('pin-sidebar-btn');
                if (notiBtn) notiBtn.focus();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                const sidebar = document.getElementById('Sidebar');
                if (sidebar) sidebar.classList.remove('expanded');
                focusActiveWebview();
            }
        });
    });

    const bottomButtons = ['pin-sidebar-btn', 'reader-view-btn', 'dark-reader-btn', 'theme-toggle-btn', 'noti-toggle-btn'];
    bottomButtons.forEach((id, idx) => {
        const btn = document.getElementById(id);
        if (!btn) return;

        btn.addEventListener('keydown', (e) => {
            if (state.dashboardActive || state.bookmarksActive || state.paletteActive || state.preferencesActive || state.historyActive || state.notesActive) return;
            if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey && idx < bottomButtons.length - 1)) {
                e.preventDefault();
                const nextBtn = document.getElementById(bottomButtons[idx + 1]);
                if (nextBtn) nextBtn.focus();
            } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey && idx > 0)) {
                e.preventDefault();
                const prevBtn = document.getElementById(bottomButtons[idx - 1]);
                if (prevBtn) prevBtn.focus();
            } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey && idx === 0)) {
                e.preventDefault();
                const selectedTab = document.querySelector('#TabList li.selected') || document.querySelector('#TabList li');
                if (selectedTab) {
                    selectedTab.focus();
                } else {
                    const backBtn = document.getElementById('back-btn');
                    if (backBtn) backBtn.focus();
                }
            } else if (e.key === 'Tab' && !e.shiftKey && idx === bottomButtons.length - 1) {
                e.preventDefault();
                const backBtn = document.getElementById('back-btn');
                if (backBtn) backBtn.focus();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                const sidebar = document.getElementById('Sidebar');
                if (sidebar) sidebar.classList.remove('expanded');
                focusActiveWebview();
            }
        });
    });

    const tabListContainer = document.getElementById('TabList');
    if (tabListContainer) {
        tabListContainer.addEventListener('keydown', (e) => {
            if (state.dashboardActive || state.bookmarksActive || state.paletteActive || state.preferencesActive || state.historyActive || state.notesActive) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                const sidebar = document.getElementById('Sidebar');
                if (sidebar) sidebar.classList.remove('expanded');
                focusActiveWebview();
                return;
            }

            if (e.key === 'Tab') {
                e.preventDefault();
                if (e.shiftKey) {
                    const backBtn = document.getElementById('back-btn') || document.getElementById('toggle-nav-btn');
                    if (backBtn) backBtn.focus();
                } else {
                    const pinBtn = document.getElementById('pin-sidebar-btn');
                    if (pinBtn) pinBtn.focus();
                }
                return;
            }

            const tabItems = Array.from(document.querySelectorAll('#TabList li'));
            const activeListItem = document.querySelector('#TabList li.selected');
            const focusedListItem = document.activeElement ? document.activeElement.closest('#TabList li') : null;
            let currentIdx = tabItems.indexOf(focusedListItem || activeListItem);
            if (currentIdx === -1) currentIdx = 0;

            if (e.key === 'ArrowDown' || e.key === 'j') {
                e.preventDefault();
                if (currentIdx < tabItems.length - 1) {
                    currentIdx++;
                    tabItems.forEach((item, idx) => item.setAttribute('tabindex', idx === currentIdx ? '0' : '-1'));
                    tabItems[currentIdx].focus();
                } else {
                    const pinBtn = document.getElementById('pin-sidebar-btn');
                    if (pinBtn) pinBtn.focus();
                }
            } else if (e.key === 'ArrowUp' || e.key === 'k') {
                e.preventDefault();
                if (currentIdx > 0) {
                    currentIdx--;
                    tabItems.forEach((item, idx) => item.setAttribute('tabindex', idx === currentIdx ? '0' : '-1'));
                    tabItems[currentIdx].focus();
                } else {
                    const backBtn = document.getElementById('back-btn') || document.getElementById('toggle-nav-btn');
                    if (backBtn) backBtn.focus();
                }
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const targetIdx = focusedListItem ? tabItems.indexOf(focusedListItem) : currentIdx;
                if (targetIdx !== -1) {
                    if (state.dashboardActive && typeof window.toggleDashboardView === 'function') {
                        window.toggleDashboardView();
                    }
                    switchTabFocus(targetIdx);
                }
            } else if (e.key === 'ArrowLeft' || e.key === 'h') {
                e.preventDefault();
                const backBtn = document.getElementById('back-btn') || document.getElementById('toggle-nav-btn');
                if (backBtn) backBtn.focus();
            } else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'i') {
                e.preventDefault();
                const targetIdx = focusedListItem ? tabItems.indexOf(focusedListItem) : currentIdx;
                if (targetIdx !== -1) {
                    switchTabFocus(targetIdx);
                }
                focusActiveWebview();
            } else if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
                e.preventDefault();
                const num = parseInt(e.key, 10);
                jumpToTabByIndex(num);
                const updatedItems = Array.from(document.querySelectorAll('#TabList li'));
                const targetIdx = Math.min(num - 1, updatedItems.length - 1);
                if (targetIdx >= 0 && updatedItems[targetIdx]) {
                    updatedItems.forEach((item, idx) => item.setAttribute('tabindex', idx === targetIdx ? '0' : '-1'));
                    updatedItems[targetIdx].focus();
                }
            } else if (e.key === 't') {
                e.preventDefault();
                spawnNewBlankTab();
            } else if (e.key === 'x') {
                e.preventDefault();
                const targetIdx = focusedListItem ? tabItems.indexOf(focusedListItem) : currentIdx;
                handleTabRemoval(targetIdx !== -1 ? targetIdx : undefined);
            } else if (e.key === 'o') {
                e.preventDefault();
                displayAddressOverlay();
            } else if (e.key === 'w') {
                e.preventDefault();
                toggleDashboardView();
            } else if (e.key === 'y') {
                e.preventDefault();
                const targetIdx = focusedListItem ? tabItems.indexOf(focusedListItem) : currentIdx;
                const currentWS = state.sessionState.current_workspace;
                const urls = state.sessionState.workspaces[currentWS] || [];
                const activeUrl = urls[targetIdx] || '';
                if (activeUrl) {
                    navigator.clipboard.writeText(activeUrl).catch(() => {});
                    setTargetUrl(`Yanked URL to clipboard: ${activeUrl}`, 2500);
                }
            }
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Control' && !document.body.classList.contains('show-tab-badges')) {
            document.body.classList.add('show-tab-badges');
        }
        if (e.shiftKey && e.key === 'Escape') {
            e.preventDefault();
            togglePassthroughMode();
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'Control') {
            document.body.classList.remove('show-tab-badges');
        }
    });

    window.addEventListener('blur', () => {
        document.body.classList.remove('show-tab-badges');
    });

    const sidebar = document.getElementById('Sidebar');
    if (sidebar) {
        sidebar.addEventListener('focusout', (e) => {
            if (e.relatedTarget && !sidebar.contains(e.relatedTarget)) {
                if (state.dashboardActive || state.paletteActive || state.preferencesActive || state.bookmarksActive || state.historyActive || state.notesActive || state.diagnosticsActive) return;

                for (const id of overlayIds) {
                    const el = document.getElementById(id);
                    if (el && (e.relatedTarget === el || el.contains(e.relatedTarget))) return;
                }

                if (window.miseAllowWebviewFocus) {
                    window.miseAllowWebviewFocus = false;
                    return;
                }
                e.preventDefault();
                const selectedTab = document.querySelector('#TabList li.selected');
                if (selectedTab) selectedTab.focus();
            }
        });
    }

    const notiBtn = document.getElementById('noti-toggle-btn');
    if (notiBtn) {
        notiBtn.addEventListener('click', async () => {
            const isMuted = !!notiBtn.querySelector('.fa-bell-slash');
            const targetState = isMuted;

            if (window.miseAPI && typeof window.miseAPI.toggleGlobalNotifications === 'function') {
                await window.miseAPI.toggleGlobalNotifications(targetState);
            }

            if (targetState) {
                notiBtn.innerHTML = '<i class="fa-solid fa-bell"></i>';
            } else {
                notiBtn.innerHTML = '<i class="fa-solid fa-bell-slash"></i>';
            }

            window.miseAllowWebviewFocus = true;
            focusActiveWebview();
        });
    }
}
