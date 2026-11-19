// modules/overlays/taskManager.js
// Keyboard-driven Task Manager Overlay (Tab Resource Inspector)

import { state } from '../state.js';
import { escapeHtml, focusActiveWebview, showNotificationToast } from '../utils.js';
import { ensureOverlayMounted, mountOverlaySync } from '../templateLoader.js';
import {
    hibernateTab,
    hibernateInactiveTabs,
    renderWorkspaceUI,
    switchTabFocus,
    handleTabRemoval,
    destroyGuestWebview
} from '../webview.js';
import { isSplitActive, getSplitState } from '../splitView.js';
import { setTargetUrl } from '../statusBar.js';
import { resolveWorkspaceVisual } from '../workspaceVisuals.js';

const POLL_INTERVAL_MS = 2000;

let latestMetrics = null;
let tabRows = [];
let selectedIndex = 0;
let pollTimerId = null;
let isRefreshing = false;

function setStatusFeedback(message) {
    if (!message) return;
    if (typeof setTargetUrl === 'function') {
        setTargetUrl(message, 3200);
    }
    if (typeof showNotificationToast === 'function') {
        showNotificationToast(message, 'fa-gauge-high');
    }
}

function getCpuSeverityClass(cpuPercent, isSleeping) {
    if (isSleeping) return 'tm-metric-idle';
    if (cpuPercent >= 25) return 'tm-metric-high';
    if (cpuPercent >= 8) return 'tm-metric-med';
    return 'tm-metric-low';
}

function getMemorySeverityClass(memMB, isSleeping) {
    if (isSleeping) return 'tm-metric-idle';
    if (memMB >= 250) return 'tm-metric-high';
    if (memMB >= 120) return 'tm-metric-med';
    return 'tm-metric-low';
}

function resolveOrderedWorkspaces() {
    const workspaces = state.sessionState?.workspaces || {};
    const currentWS = state.sessionState?.current_workspace || 'Workspace 1';
    const ordered = [];

    if (Object.prototype.hasOwnProperty.call(workspaces, currentWS)) {
        ordered.push(currentWS);
    }

    for (const wsName of Object.keys(workspaces)) {
        if (wsName === currentWS) continue;
        const urls = workspaces[wsName] || [];
        if (wsName === 'Private' && urls.length === 0) continue;
        ordered.push(wsName);
    }

    return ordered;
}

function resolveActiveTabIndex(currentWS) {
    const urls = state.sessionState?.workspaces?.[currentWS] || [];
    if (typeof document !== 'undefined') {
        const activeLi = document.querySelector('#TabList li.selected');
        if (activeLi) {
            const tabItems = Array.from(document.querySelectorAll('#TabList li'));
            const domIdx = tabItems.indexOf(activeLi);
            if (domIdx >= 0 && domIdx < urls.length) {
                return domIdx;
            }
        }
    }
    const saved = state.sessionState?.active_tabs?.[currentWS];
    if (typeof saved === 'number' && saved >= 0 && saved < urls.length) {
        return saved;
    }
    return 0;
}

function safelyReadWebviewIds(webview) {
    let wcId = null;
    let osPid = null;
    if (!webview || webview.__miseDestroyed) {
        return { wcId, osPid };
    }

    if (typeof webview.getWebContentsId === 'function') {
        try {
            const rawId = webview.getWebContentsId();
            if (typeof rawId === 'number' && rawId >= 0) {
                wcId = rawId;
            }
        } catch (_) {
            wcId = null;
        }
    }

    if (typeof webview.getOSProcessId === 'function') {
        try {
            const rawPid = webview.getOSProcessId();
            if (typeof rawPid === 'number' && rawPid > 0) {
                osPid = rawPid;
            }
        } catch (_) {
            osPid = null;
        }
    }

    return { wcId, osPid };
}

function safelyReadWebviewTitle(webview) {
    if (!webview || webview.__miseDestroyed || typeof webview.getTitle !== 'function') {
        return '';
    }
    try {
        const liveTitle = webview.getTitle();
        if (liveTitle && liveTitle !== 'about:blank') {
            return liveTitle;
        }
    } catch (_) {}
    return '';
}

function safelyReadWebviewAudible(webview) {
    if (!webview || webview.__miseDestroyed || typeof webview.isCurrentlyAudible !== 'function') {
        return false;
    }
    try {
        return !!webview.isCurrentlyAudible();
    } catch (_) {
        return false;
    }
}

/**
 * Builds ordered per-tab resource rows across workspaces, active workspace first.
 */
export function buildTaskManagerTabRows(metricsData = null) {
    const workspaces = state.sessionState?.workspaces || {};
    const currentWS = state.sessionState?.current_workspace || 'Workspace 1';
    const activeIdx = resolveActiveTabIndex(currentWS);
    const splitActive = isSplitActive(currentWS);
    const split = getSplitState(currentWS);
    const orderedWorkspaces = resolveOrderedWorkspaces();

    const webContentsMap = metricsData?.webContentsMap || {};
    const processList = Array.isArray(metricsData?.processes) ? metricsData.processes : [];
    const processByPid = new Map();
    for (const proc of processList) {
        if (proc && proc.pid) {
            processByPid.set(proc.pid, proc);
        }
    }

    const rawRows = [];
    const claimedWcIds = new Set();

    for (const wsName of orderedWorkspaces) {
        const urls = workspaces[wsName] || [];
        for (let tabIdx = 0; tabIdx < urls.length; tabIdx++) {
            const url = urls[tabIdx] || '';
            const sleepRecord = state.tabSleepStates?.[wsName]?.[tabIdx] || null;
            const webview = state.activeViewsCache?.[wsName]?.[tabIdx] || null;
            const isSleeping = Boolean(sleepRecord) || !webview;
            const isActive = (wsName === currentWS) && (
                tabIdx === activeIdx ||
                (splitActive && (tabIdx === split.primaryIdx || tabIdx === split.secondaryIdx))
            );
            const isPinned = Boolean(state.tabPinned?.[wsName]?.[tabIdx]);
            const isAudible = Boolean(state.tabMediaAudible?.[wsName]?.[tabIdx]) || (!isSleeping && safelyReadWebviewAudible(webview));

            const liveTitle = !isSleeping ? safelyReadWebviewTitle(webview) : '';
            const title = liveTitle ||
                state.activeTitlesCache?.[wsName]?.[tabIdx] ||
                sleepRecord?.title ||
                url ||
                'New Tab';

            const { wcId, osPid } = !isSleeping ? safelyReadWebviewIds(webview) : { wcId: null, osPid: null };
            let procInfo = null;

            if (!isSleeping && wcId !== null && webContentsMap[wcId]) {
                procInfo = webContentsMap[wcId];
                claimedWcIds.add(String(wcId));
            } else if (!isSleeping && osPid !== null && processByPid.has(osPid)) {
                procInfo = processByPid.get(osPid);
            }

            rawRows.push({
                workspace: wsName,
                tabIndex: tabIdx,
                url,
                title,
                isSleeping,
                isActive,
                isPinned,
                isAudible,
                wcId,
                osPid,
                procInfo
            });
        }
    }

    // Fallback URL matching for awake webviews whose IDs were unavailable before dom-ready
    const webviewEntries = Object.entries(webContentsMap);
    for (const row of rawRows) {
        if (row.isSleeping || row.procInfo) continue;
        for (const [entryId, entry] of webviewEntries) {
            if (claimedWcIds.has(String(entryId))) continue;
            if (entry && entry.type === 'webview' && entry.url && entry.url === row.url) {
                row.procInfo = entry;
                claimedWcIds.add(String(entryId));
                break;
            }
        }
    }

    const pidShareCounts = new Map();
    for (const row of rawRows) {
        if (row.isSleeping) continue;
        const resolvedPid = row.procInfo?.pid || row.osPid || null;
        if (resolvedPid) {
            pidShareCounts.set(resolvedPid, (pidShareCounts.get(resolvedPid) || 0) + 1);
        }
    }

    return rawRows.map((row) => {
        const pid = row.isSleeping ? null : (row.procInfo?.pid || row.osPid || null);
        const cpuPercent = row.isSleeping ? 0 : (Number(row.procInfo?.cpuPercent) || 0);
        const memoryMB = row.isSleeping ? 0 : (Number(row.procInfo?.pssMB ?? row.procInfo?.rssMB) || 0);
        const rssMB = row.isSleeping ? 0 : (Number(row.procInfo?.rssMB) || 0);
        const ussMB = row.isSleeping ? 0 : (Number(row.procInfo?.ussMB) || 0);
        const sharedCount = pid ? (pidShareCounts.get(pid) || 1) : 1;

        let statusLabel = 'Awake';
        if (row.isSleeping) {
            statusLabel = 'Hibernated';
        } else if (row.isActive) {
            statusLabel = 'Active';
        }

        return {
            workspace: row.workspace,
            tabIndex: row.tabIndex,
            url: row.url,
            title: row.title,
            isSleeping: row.isSleeping,
            isActive: row.isActive,
            isPinned: row.isPinned,
            isAudible: row.isAudible,
            pid,
            sharedCount,
            cpuPercent,
            memoryMB,
            rssMB,
            ussMB,
            statusLabel
        };
    });
}

function updateVisualSelection(scrollIntoView = false) {
    if (typeof document === 'undefined') return;
    const listEl = document.getElementById('TaskManagerTabList');
    if (!listEl) return;

    const rowEls = listEl.querySelectorAll('.task-manager-row');
    rowEls.forEach((el, idx) => {
        const isSelected = idx === selectedIndex;
        el.classList.toggle('selected', isSelected);
        if (typeof el.setAttribute === 'function') {
            el.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        }
        if (isSelected && scrollIntoView && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' });
        }
    });
}

/**
 * Renders totals summary cards and per-tab resource rows into the Task Manager DOM.
 */
export function renderTaskManagerUI(metricsData = latestMetrics) {
    if (typeof document === 'undefined') return;

    const totals = metricsData?.totals || {
        pssMB: 0,
        rssMB: 0,
        ussMB: 0,
        cpuPercent: 0,
        processCount: 0
    };

    const pssEl = document.getElementById('TaskManagerTotalPss');
    const rssEl = document.getElementById('TaskManagerTotalRss');
    const ussEl = document.getElementById('TaskManagerTotalUss');
    const cpuEl = document.getElementById('TaskManagerTotalCpu');
    const procCountEl = document.getElementById('TaskManagerProcessCount');

    if (pssEl) pssEl.textContent = `${Number(totals.pssMB || 0).toFixed(1)} MB`;
    if (rssEl) rssEl.textContent = `${Number(totals.rssMB || 0).toFixed(1)} MB`;
    if (ussEl) ussEl.textContent = `${Number(totals.ussMB || 0).toFixed(1)} MB`;
    if (cpuEl) cpuEl.textContent = `${Number(totals.cpuPercent || 0).toFixed(1)}%`;
    if (procCountEl) procCountEl.textContent = String(totals.processCount || 0);

    tabRows = buildTaskManagerTabRows(metricsData);
    if (tabRows.length === 0) {
        selectedIndex = 0;
    } else {
        selectedIndex = Math.max(0, Math.min(tabRows.length - 1, selectedIndex));
    }
    state.taskManagerSelectionIdx = selectedIndex;

    const listEl = document.getElementById('TaskManagerTabList');
    const emptyEl = document.getElementById('TaskManagerEmptyState');
    if (!listEl) return;

    if (tabRows.length === 0) {
        listEl.innerHTML = '';
        listEl.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'block';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    listEl.style.display = 'flex';

    const prevScrollTop = listEl.scrollTop || 0;

    const markup = tabRows.map((row, idx) => {
        const isSelected = idx === selectedIndex;
        const visual = resolveWorkspaceVisual(row.workspace, state.sessionState);
        const safeWs = escapeHtml(row.workspace);
        const safeGlyph = escapeHtml(visual.glyph);
        const safeTitle = escapeHtml(row.title);
        const safeUrl = escapeHtml(row.url);

        const statusClass = row.isSleeping ? 'sleeping' : (row.isActive ? 'active' : 'awake');
        const pidText = row.pid ? `PID ${row.pid}` : row.statusLabel;
        const statusTitle = row.pid && row.sharedCount > 1
            ? `${row.statusLabel} - Process PID ${row.pid} (shared across ${row.sharedCount} tabs)`
            : `${row.statusLabel}${row.pid ? ` - PID ${row.pid}` : ''}`;

        const cpuClass = getCpuSeverityClass(row.cpuPercent, row.isSleeping);
        const memClass = getMemorySeverityClass(row.memoryMB, row.isSleeping);
        const memTitle = row.isSleeping
            ? 'Hibernated tab (DOM detached)'
            : `PSS: ${row.memoryMB.toFixed(1)} MB | RSS: ${row.rssMB.toFixed(1)} MB | USS: ${row.ussMB.toFixed(1)} MB`;

        const hibernateDisabled = row.isSleeping || row.isActive || row.isAudible;
        let hibernateTitle = 'Hibernate tab (z)';
        if (row.isSleeping) hibernateTitle = 'Tab is already hibernated';
        else if (row.isActive) hibernateTitle = 'Active tab cannot be hibernated';
        else if (row.isAudible) hibernateTitle = 'Tab is playing audio';

        const closeDisabled = row.isPinned;
        const closeTitle = row.isPinned ? 'Pinned tabs cannot be closed' : 'Close tab (x)';

        return `
            <div class="task-manager-row${isSelected ? ' selected' : ''}${row.isSleeping ? ' sleeping' : ''}" data-idx="${idx}" role="option" aria-selected="${isSelected ? 'true' : 'false'}">
                <div class="tm-tab-cell">
                    <span class="tm-ws-badge" style="border-color: ${escapeHtml(visual.color)}; color: ${escapeHtml(visual.color)};" title="${safeWs}">
                        <span>${safeGlyph}</span>
                        <span>${safeWs}</span>
                    </span>
                    <div class="tm-tab-meta">
                        <div class="tm-tab-title-line">
                            <span class="tm-tab-title" title="${safeTitle}">${safeTitle}</span>
                            ${row.isPinned ? '<i class="fa-solid fa-thumbtack tm-tab-flag" title="Pinned tab"></i>' : ''}
                            ${row.isAudible ? '<i class="fa-solid fa-volume-high tm-tab-flag audible" title="Playing audio"></i>' : ''}
                        </div>
                        <span class="tm-tab-url" title="${safeUrl}">${safeUrl}</span>
                    </div>
                </div>
                <div class="tm-status-cell">
                    <span class="tm-status-pill ${statusClass}" title="${escapeHtml(statusTitle)}">
                        ${row.isSleeping ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-circle" style="font-size: 7px;"></i>'}
                        <span>${escapeHtml(pidText)}</span>
                    </span>
                </div>
                <div class="tm-cpu-cell ${cpuClass}">${row.cpuPercent.toFixed(1)}%</div>
                <div class="tm-mem-cell ${memClass}" title="${escapeHtml(memTitle)}">${row.memoryMB.toFixed(1)} MB</div>
                <div class="tm-actions-cell">
                    <button type="button" class="tm-row-btn" data-action="hibernate" title="${escapeHtml(hibernateTitle)}"${hibernateDisabled ? ' disabled' : ''}>
                        <i class="fa-solid fa-bed"></i>
                    </button>
                    <button type="button" class="tm-row-btn close" data-action="close" title="${escapeHtml(closeTitle)}"${closeDisabled ? ' disabled' : ''}>
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    listEl.innerHTML = markup;
    listEl.scrollTop = prevScrollTop;
}

/**
 * Fetches fresh process and memory metrics from the main process and updates the overlay.
 */
export async function refreshTaskManagerMetrics() {
    if (isRefreshing) return latestMetrics;
    isRefreshing = true;

    try {
        if (typeof window !== 'undefined' && window.miseAPI && typeof window.miseAPI.getTaskManagerMetrics === 'function') {
            latestMetrics = await window.miseAPI.getTaskManagerMetrics();
        }
        if (isTaskManagerActive() || typeof document === 'undefined') {
            renderTaskManagerUI(latestMetrics);
        }
        return latestMetrics;
    } catch (err) {
        console.error('[TaskManager] Failed to gather resource metrics:', err);
        return latestMetrics;
    } finally {
        isRefreshing = false;
    }
}

export function getTaskManagerRows() {
    return [...tabRows];
}

export function getSelectedTaskManagerIndex() {
    return selectedIndex;
}

export function setSelectedTaskManagerIndex(idx) {
    if (tabRows.length === 0) {
        selectedIndex = 0;
    } else {
        selectedIndex = Math.max(0, Math.min(tabRows.length - 1, idx));
    }
    state.taskManagerSelectionIdx = selectedIndex;
    updateVisualSelection(true);
}

/**
 * Hibernates the tab at the specified row index immediately.
 */
export async function hibernateTaskManagerRow(idx = selectedIndex) {
    const row = tabRows[idx];
    if (!row) return false;

    if (row.isSleeping) {
        setStatusFeedback('Tab is already hibernated.');
        return false;
    }
    if (row.isActive) {
        setStatusFeedback('Active tab cannot be hibernated.');
        return false;
    }
    if (row.isAudible) {
        setStatusFeedback('Cannot hibernate a tab playing audio.');
        return false;
    }

    const hibernated = await hibernateTab(row.workspace, row.tabIndex);
    if (!hibernated) {
        setStatusFeedback('Unable to hibernate tab.');
        return false;
    }

    if (typeof window !== 'undefined' && window.miseAPI && typeof window.miseAPI.compactMemory === 'function') {
        window.miseAPI.compactMemory().catch(() => {});
    }

    setStatusFeedback(`Hibernated: ${row.title}`);
    renderTaskManagerUI(latestMetrics);
    await refreshTaskManagerMetrics();
    return true;
}

/**
 * Hibernates all background tabs except the active, pinned, or audible ones.
 */
export async function hibernateAllBackgroundTabs() {
    await hibernateInactiveTabs();
    setStatusFeedback('Hibernated all eligible background tabs.');
    renderTaskManagerUI(latestMetrics);
    await refreshTaskManagerMetrics();
    return true;
}

/**
 * Closes the tab at the specified row index unless pinned.
 */
export function closeTaskManagerRow(idx = selectedIndex) {
    const row = tabRows[idx];
    if (!row) return false;

    if (row.isPinned) {
        setStatusFeedback('Tab is pinned. Unpin before closing.');
        return false;
    }

    const ws = row.workspace;
    const tabIdx = row.tabIndex;

    if (ws === state.sessionState.current_workspace) {
        handleTabRemoval(tabIdx);
    } else {
        const tabs = state.sessionState.workspaces?.[ws];
        if (!Array.isArray(tabs) || tabIdx < 0 || tabIdx >= tabs.length) {
            return false;
        }
        tabs.splice(tabIdx, 1);

        if (state.activeViewsCache?.[ws]) {
            if (state.activeViewsCache[ws][tabIdx]) {
                destroyGuestWebview(state.activeViewsCache[ws][tabIdx]);
            }
            state.activeViewsCache[ws].splice(tabIdx, 1);
        }

        const parallelCaches = [
            state.activeTitlesCache,
            state.tabSleepStates,
            state.tabActivityTimestamps,
            state.tabMediaAudible,
            state.tabAudioMuted,
            state.tabDarkReaderStates,
            state.tabFavicons,
            state.tabPinned,
            state.sessionState.tab_titles,
            state.sessionState.tab_sleep_states,
            state.sessionState.tab_dark_reader,
            state.sessionState.tab_favicons,
            state.sessionState.tab_pinned
        ];
        for (const cache of parallelCaches) {
            if (Array.isArray(cache?.[ws])) {
                cache[ws].splice(tabIdx, 1);
            }
        }

        if (Array.isArray(state.tabHistory?.[ws])) {
            state.tabHistory[ws] = state.tabHistory[ws]
                .filter((hIdx) => hIdx !== tabIdx)
                .map((hIdx) => (hIdx > tabIdx ? hIdx - 1 : hIdx));
        }

        if (!state.sessionState.active_tabs) state.sessionState.active_tabs = {};
        if (tabs.length === 0) {
            state.sessionState.active_tabs[ws] = 0;
        } else if (typeof state.sessionState.active_tabs[ws] === 'number') {
            const cur = state.sessionState.active_tabs[ws];
            if (cur > tabIdx) {
                state.sessionState.active_tabs[ws] = cur - 1;
            } else if (cur >= tabs.length) {
                state.sessionState.active_tabs[ws] = tabs.length - 1;
            }
        }

        if (typeof window !== 'undefined' && window.miseAPI && typeof window.miseAPI.saveSession === 'function') {
            window.miseAPI.saveSession(state.sessionState);
        }
    }

    renderTaskManagerUI(latestMetrics);
    refreshTaskManagerMetrics();
    return true;
}

/**
 * Jumps directly to the tab at the specified row index, switching workspaces if needed.
 */
export function jumpToTaskManagerRow(idx = selectedIndex) {
    const row = tabRows[idx];
    if (!row) return false;

    const targetWS = row.workspace;
    const targetIdx = row.tabIndex;

    closeTaskManagerOverlay();

    if (targetWS !== state.sessionState.current_workspace) {
        state.sessionState.current_workspace = targetWS;
        if (!state.sessionState.active_tabs) state.sessionState.active_tabs = {};
        state.sessionState.active_tabs[targetWS] = targetIdx;
        if (typeof window !== 'undefined' && window.miseAPI && typeof window.miseAPI.saveSession === 'function') {
            window.miseAPI.saveSession(state.sessionState);
        }
        renderWorkspaceUI(targetIdx);
    } else {
        switchTabFocus(targetIdx);
    }

    window.miseAllowWebviewFocus = true;
    focusActiveWebview();
    return true;
}

function startTaskManagerPolling() {
    stopTaskManagerPolling();
    pollTimerId = setInterval(() => {
        if (!state.taskManagerActive) {
            stopTaskManagerPolling();
            return;
        }
        refreshTaskManagerMetrics();
    }, POLL_INTERVAL_MS);
}

export function stopTaskManagerPolling() {
    if (pollTimerId) {
        clearInterval(pollTimerId);
        pollTimerId = null;
    }
}

export function isTaskManagerActive() {
    if (state.taskManagerActive) return true;
    if (typeof document === 'undefined') return false;
    const overlay = document.getElementById('TaskManagerOverlay');
    return Boolean(overlay && overlay.style.display !== 'none' && overlay.style.display !== '');
}

function closeOtherOverlays() {
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
    if (state.historyActive && typeof window.toggleHistoryOverlay === 'function') {
        window.toggleHistoryOverlay();
    }
    if (state.diagnosticsActive && typeof window.toggleDiagnosticsView === 'function') {
        window.toggleDiagnosticsView();
    }
    if (state.notificationsActive && typeof window.closeNotificationsOverlay === 'function') {
        window.closeNotificationsOverlay();
    }
    if (state.qrModalActive && typeof window.closeQrModal === 'function') {
        window.closeQrModal();
    }
}

export function setupTaskManagerListeners(overlayEl) {
    if (!overlayEl) return;

    overlayEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeTaskManagerOverlay();
            return;
        }

        if (e.key === 'ArrowDown' || (e.key === 'j' && !e.ctrlKey && !e.metaKey && !e.altKey)) {
            e.preventDefault();
            e.stopPropagation();
            if (tabRows.length > 0) {
                setSelectedTaskManagerIndex(Math.min(tabRows.length - 1, selectedIndex + 1));
            }
            return;
        }

        if (e.key === 'ArrowUp' || (e.key === 'k' && !e.ctrlKey && !e.metaKey && !e.altKey)) {
            e.preventDefault();
            e.stopPropagation();
            if (tabRows.length > 0) {
                setSelectedTaskManagerIndex(Math.max(0, selectedIndex - 1));
            }
            return;
        }

        if (e.key === 'Home') {
            e.preventDefault();
            e.stopPropagation();
            if (tabRows.length > 0) {
                setSelectedTaskManagerIndex(0);
            }
            return;
        }

        if (e.key === 'End') {
            e.preventDefault();
            e.stopPropagation();
            if (tabRows.length > 0) {
                setSelectedTaskManagerIndex(tabRows.length - 1);
            }
            return;
        }

        if (e.key === 'z' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            hibernateTaskManagerRow(selectedIndex);
            return;
        }

        if (e.key === 'x' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            closeTaskManagerRow(selectedIndex);
            return;
        }

        if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            refreshTaskManagerMetrics();
            return;
        }

        if (e.key === 'Enter') {
            const focused = document.activeElement;
            if (focused && focused.tagName === 'BUTTON' && focused !== overlayEl) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            jumpToTaskManagerRow(selectedIndex);
            return;
        }

        if (e.key === 'Tab') {
            const focusables = Array.from(overlayEl.querySelectorAll('#TaskManagerHibernateAllBtn, #TaskManagerRefreshBtn, #CloseTaskManagerBtn'))
                .filter((el) => !el.disabled);
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

    const listEl = overlayEl.querySelector('#TaskManagerTabList') || document.getElementById('TaskManagerTabList');
    if (listEl) {
        listEl.addEventListener('click', (e) => {
            const rowEl = e.target?.closest ? e.target.closest('.task-manager-row') : null;
            if (!rowEl) return;
            const idx = parseInt(rowEl.dataset.idx, 10);
            if (Number.isNaN(idx)) return;

            selectedIndex = idx;
            state.taskManagerSelectionIdx = idx;

            const actionBtn = e.target?.closest ? e.target.closest('[data-action]') : null;
            if (actionBtn) {
                e.stopPropagation();
                const action = actionBtn.dataset.action;
                if (action === 'hibernate') {
                    hibernateTaskManagerRow(idx);
                } else if (action === 'close') {
                    closeTaskManagerRow(idx);
                }
                return;
            }

            jumpToTaskManagerRow(idx);
        });
    }

    const hibernateAllBtn = overlayEl.querySelector('#TaskManagerHibernateAllBtn') || document.getElementById('TaskManagerHibernateAllBtn');
    if (hibernateAllBtn) {
        hibernateAllBtn.addEventListener('click', () => {
            hibernateAllBackgroundTabs();
        });
    }

    const refreshBtn = overlayEl.querySelector('#TaskManagerRefreshBtn') || document.getElementById('TaskManagerRefreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.classList.add('spinning');
            await refreshTaskManagerMetrics();
            setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
        });
    }

    const closeBtn = overlayEl.querySelector('#CloseTaskManagerBtn') || document.getElementById('CloseTaskManagerBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeTaskManagerOverlay();
        });
    }
}

export function openTaskManagerOverlay() {
    let overlay = document.getElementById('TaskManagerOverlay');
    if (!overlay && typeof mountOverlaySync === 'function') {
        overlay = mountOverlaySync('TaskManagerOverlay', 'task-manager', '#webview-container');
        if (overlay) setupTaskManagerListeners(overlay);
    }
    if (!overlay) return false;

    closeOtherOverlays();

    state.taskManagerActive = true;
    selectedIndex = 0;
    state.taskManagerSelectionIdx = 0;
    overlay.style.display = 'flex';

    renderTaskManagerUI(latestMetrics);
    overlay.focus();

    startTaskManagerPolling();
    refreshTaskManagerMetrics();
    return true;
}

export function closeTaskManagerOverlay() {
    stopTaskManagerPolling();
    const overlay = document.getElementById('TaskManagerOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    state.taskManagerActive = false;

    window.miseAllowWebviewFocus = true;
    focusActiveWebview();
}

export async function toggleTaskManagerOverlay() {
    let overlay = document.getElementById('TaskManagerOverlay');
    if (!overlay && typeof mountOverlaySync === 'function') {
        overlay = mountOverlaySync('TaskManagerOverlay', 'task-manager', '#webview-container');
        if (overlay) setupTaskManagerListeners(overlay);
    }
    if (!overlay && typeof ensureOverlayMounted === 'function') {
        overlay = await ensureOverlayMounted('TaskManagerOverlay', 'task-manager', '#webview-container', setupTaskManagerListeners);
    }
    if (!overlay) return false;

    if (isTaskManagerActive()) {
        closeTaskManagerOverlay();
        return false;
    }
    return openTaskManagerOverlay();
}

export function resetTaskManagerState() {
    stopTaskManagerPolling();
    latestMetrics = null;
    tabRows = [];
    selectedIndex = 0;
    isRefreshing = false;
    state.taskManagerActive = false;
    state.taskManagerSelectionIdx = 0;
}

if (typeof window !== 'undefined') {
    window.toggleTaskManagerOverlay = toggleTaskManagerOverlay;
    window.openTaskManagerOverlay = openTaskManagerOverlay;
    window.closeTaskManagerOverlay = closeTaskManagerOverlay;
    window.refreshTaskManagerMetrics = refreshTaskManagerMetrics;
}
