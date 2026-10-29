// modules/statusBar.js
// Status and mode bar controller for link target previews, connection security, container partition badges, and modal states

import { state } from './state.js';
import { escapeHtml, getWorkspacePartition } from './utils.js';
import { isSplitActive, getSplitState } from './splitView.js';
import { updateDarkReaderButtonUI, isWebviewDarkReaderActive } from './darkReader.js';

let statusBarEl = null;
let modeBadgeEl = null;
let targetUrlEl = null;
let securityBadgeEl = null;
let partitionBadgeEl = null;
let permissionsBadgeEl = null;
let permissionsPopoverEl = null;
let popoverDomainEl = null;
let popoverBodyEl = null;
let popoverCloseBtn = null;
let popoverPrefsBtn = null;
let lastSecurityUrl = Symbol('uninitialised');
let lastPartitionKey = null;
let lastPermissionsKey = Symbol('uninitialised');
let isPermissionsPopoverOpen = false;
let currentPermissionsUrl = '';
let currentPermissionsIsPrivate = false;

let isStatusBarEnabled = true;
let isGuestInputFocused = false;
let isHostInputFocused = false;
let isHintsModeActive = false;
let isPassthroughModeActive = false;
let targetUrlClearTimer = null;
let currentMode = 'NORMAL';

export function initStatusBar() {
    statusBarEl = document.getElementById('StatusBar');
    modeBadgeEl = document.getElementById('StatusBarMode');
    targetUrlEl = document.getElementById('StatusBarUrl');
    securityBadgeEl = document.getElementById('StatusBarSecurity');
    partitionBadgeEl = document.getElementById('StatusBarPartition');
    permissionsBadgeEl = document.getElementById('StatusBarPermissions');
    permissionsPopoverEl = document.getElementById('PermissionsPopover');
    popoverDomainEl = document.getElementById('PermissionsPopoverDomain');
    popoverBodyEl = document.getElementById('PermissionsPopoverBody');
    popoverCloseBtn = document.getElementById('ClosePermissionsPopoverBtn');
    popoverPrefsBtn = document.getElementById('PermissionsPopoverPrefsBtn');

    if (!statusBarEl) return;

    for (const badge of [partitionBadgeEl, modeBadgeEl, permissionsBadgeEl]) {
        if (!badge) continue;
        badge.tabIndex = 0;
        badge.setAttribute('role', 'button');
        badge.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                badge.click();
            }
        });
    }

    // Attach click handler on permissions badge to toggle popover
    if (permissionsBadgeEl) {
        permissionsBadgeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePermissionsPopover();
        });
    }

    // Attach click handler on popover close button
    if (popoverCloseBtn) {
        popoverCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closePermissionsPopover();
        });
    }

    // Attach click handler on popover preferences navigation button
    if (popoverPrefsBtn) {
        popoverPrefsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closePermissionsPopover();
            if (typeof window.togglePreferencesView === 'function') {
                window.togglePreferencesView();
            }
            if (typeof window.switchPreferencesTab === 'function') {
                window.switchPreferencesTab('tab-permissions');
            }
        });
    }

    // Outside click dismiss handler for permissions popover
    document.addEventListener('click', (e) => {
        if (!isPermissionsPopoverOpen) return;
        if (permissionsPopoverEl && !permissionsPopoverEl.contains(e.target) &&
            permissionsBadgeEl && !permissionsBadgeEl.contains(e.target)) {
            closePermissionsPopover();
        }
    });

    // Escape key dismiss handler
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isPermissionsPopoverOpen) {
            e.stopPropagation();
            closePermissionsPopover();
        }
    });

    // Attach click handler on partition badge to open Workspace Dashboard
    if (partitionBadgeEl) {
        partitionBadgeEl.addEventListener('click', () => {
            if (typeof window.toggleDashboardView === 'function') {
                window.toggleDashboardView();
            }
        });
    }

    // Attach click handler on mode badge to cancel hints or toggle passthrough if active
    if (modeBadgeEl) {
        modeBadgeEl.addEventListener('click', () => {
            if (isHintsModeActive && typeof window.triggerLinkHints === 'function') {
                window.triggerLinkHints();
            } else if (isPassthroughModeActive) {
                togglePassthroughMode(false);
            } else if (currentMode === 'NORMAL') {
                togglePassthroughMode(true);
            }
        });
    }

    // Host input focus tracking for Insert mode
    window.addEventListener('focusin', (e) => {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
            isHostInputFocused = true;
            recalculateMode();
        }
    });

    window.addEventListener('focusout', (e) => {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
            isHostInputFocused = false;
            recalculateMode();
        }
    });

    // Initial state synchronisation
    updateStatusBarFromActiveView();
}

export function setTargetUrl(url, timeoutMs = 0) {
    if (targetUrlClearTimer) {
        clearTimeout(targetUrlClearTimer);
        targetUrlClearTimer = null;
    }

    if (!targetUrlEl) targetUrlEl = document.getElementById('StatusBarUrl');
    if (!targetUrlEl) return;

    if (!url) {
        targetUrlEl.textContent = '';
        targetUrlEl.title = '';
        return;
    }

    targetUrlEl.textContent = url;
    targetUrlEl.title = url;

    if (timeoutMs > 0) {
        targetUrlClearTimer = setTimeout(() => {
            if (targetUrlEl && targetUrlEl.textContent === url) {
                targetUrlEl.textContent = '';
                targetUrlEl.title = '';
            }
            targetUrlClearTimer = null;
        }, timeoutMs);
    }
}

export function updateSecurityStatus(url) {
    if (!securityBadgeEl) securityBadgeEl = document.getElementById('StatusBarSecurity');
    if (!securityBadgeEl || lastSecurityUrl === url) return;
    lastSecurityUrl = url;

    if (!url || url === 'about:blank') {
        securityBadgeEl.innerHTML = '<i class="fa-solid fa-circle-minus"></i><span class="status-badge-text">BLANK</span>';
        securityBadgeEl.className = 'status-badge status-badge-security security-neutral';
        securityBadgeEl.title = 'Empty page';
        return;
    }

    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:') {
            securityBadgeEl.innerHTML = '<i class="fa-solid fa-lock"></i><span class="status-badge-text">HTTPS</span>';
            securityBadgeEl.className = 'status-badge status-badge-security security-secure';
            securityBadgeEl.title = `Secure connection (TLS) | Host: ${parsed.hostname}`;
        } else if (parsed.protocol === 'http:') {
            securityBadgeEl.innerHTML = '<i class="fa-solid fa-lock-open"></i><span class="status-badge-text">HTTP</span>';
            securityBadgeEl.className = 'status-badge status-badge-security security-insecure';
            securityBadgeEl.title = `Insecure connection (HTTP) | Host: ${parsed.hostname}`;
        } else if (parsed.protocol === 'file:') {
            securityBadgeEl.innerHTML = '<i class="fa-solid fa-file-code"></i><span class="status-badge-text">FILE</span>';
            securityBadgeEl.className = 'status-badge status-badge-security security-local';
            securityBadgeEl.title = `Local file: ${parsed.pathname}`;
        } else {
            const proto = parsed.protocol.replace(':', '').toUpperCase();
            const safeProto = typeof escapeHtml === 'function' ? escapeHtml(proto) : proto;
            securityBadgeEl.innerHTML = `<i class="fa-solid fa-globe"></i><span class="status-badge-text">${safeProto}</span>`;
            securityBadgeEl.className = 'status-badge status-badge-security security-neutral';
            securityBadgeEl.title = `Protocol: ${parsed.protocol}`;
        }
    } catch {
        securityBadgeEl.innerHTML = '<i class="fa-solid fa-globe"></i><span class="status-badge-text">WEB</span>';
        securityBadgeEl.className = 'status-badge status-badge-security security-neutral';
        securityBadgeEl.title = url;
    }
}

export function updatePermissionsStatus(url, isPrivate) {
    if (!permissionsBadgeEl) permissionsBadgeEl = document.getElementById('StatusBarPermissions');
    if (!permissionsBadgeEl) return;

    if (isPrivate) {
        currentPermissionsIsPrivate = true;
        currentPermissionsUrl = url || '';
        if (lastPermissionsKey === 'private') return;
        lastPermissionsKey = 'private';
        permissionsBadgeEl.style.display = 'inline-flex';
        permissionsBadgeEl.className = 'status-badge status-badge-permissions permissions-locked';
        permissionsBadgeEl.innerHTML = '<i class="fa-solid fa-shield-cat"></i><span class="status-badge-text">LOCKED</span>';
        permissionsBadgeEl.title = 'Private Profile: All sensors and device permissions are strictly locked';
        if (isPermissionsPopoverOpen) {
            renderPermissionsPopoverContent('Private Profile', {}, true);
        }
        return;
    }

    currentPermissionsIsPrivate = false;

    if (!url || url === 'about:blank' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        if (lastPermissionsKey === 'hidden') return;
        lastPermissionsKey = 'hidden';
        currentPermissionsUrl = '';
        permissionsBadgeEl.style.display = 'none';
        closePermissionsPopover();
        return;
    }

    let hostname = '';
    try {
        hostname = new URL(url).hostname;
    } catch (_) {
        permissionsBadgeEl.style.display = 'none';
        return;
    }

    if (!hostname) {
        permissionsBadgeEl.style.display = 'none';
        return;
    }

    currentPermissionsUrl = url;
    const key = `normal:${hostname}`;
    if (key === lastPermissionsKey) return;
    lastPermissionsKey = key;

    if (typeof window !== 'undefined' && window.miseAPI && typeof window.miseAPI.getDomainPermissions === 'function') {
        window.miseAPI.getDomainPermissions(hostname).then((perms) => {
            if (lastPermissionsKey !== key) return;
            renderPermissionsBadgeUI(hostname, perms || {});
            if (isPermissionsPopoverOpen) {
                renderPermissionsPopoverContent(hostname, perms || {}, false);
            }
        }).catch(() => {
            if (lastPermissionsKey !== key) return;
            renderPermissionsBadgeUI(hostname, {});
        });
    } else {
        renderPermissionsBadgeUI(hostname, {});
    }
}

export function renderPermissionsBadgeUI(hostname, perms = {}) {
    if (!permissionsBadgeEl) permissionsBadgeEl = document.getElementById('StatusBarPermissions');
    if (!permissionsBadgeEl) return;

    permissionsBadgeEl.style.display = 'inline-flex';
    const isAudio = perms['media:audio'] === 'allow';
    const isVideo = perms['media:video'] === 'allow';
    const isGeo = perms['geolocation'] === 'allow';
    const isClip = perms['clipboard-read'] === 'allow';
    const hasAllowed = isAudio || isVideo || isGeo || isClip;
    const hasDenied = Object.values(perms).includes('deny');

    if (hasAllowed) {
        permissionsBadgeEl.className = 'status-badge status-badge-permissions permissions-allowed';
        let icons = '';
        if (isVideo) icons += '<i class="fa-solid fa-video"></i>';
        if (isAudio) icons += '<i class="fa-solid fa-microphone"></i>';
        if (isGeo) icons += '<i class="fa-solid fa-location-dot"></i>';
        if (isClip) icons += '<i class="fa-solid fa-clipboard"></i>';
        const safeIcons = icons || '<i class="fa-solid fa-sliders"></i>';
        permissionsBadgeEl.innerHTML = `${safeIcons}<span class="status-badge-text">ACTIVE</span>`;
        permissionsBadgeEl.title = `Site Permissions: ${hostname} (Active access granted | Click to manage)`;
    } else if (hasDenied) {
        permissionsBadgeEl.className = 'status-badge status-badge-permissions permissions-denied';
        permissionsBadgeEl.innerHTML = '<i class="fa-solid fa-ban"></i><span class="status-badge-text">BLOCKED</span>';
        permissionsBadgeEl.title = `Site Permissions: ${hostname} (Some capabilities blocked | Click to manage)`;
    } else {
        permissionsBadgeEl.className = 'status-badge status-badge-permissions permissions-neutral';
        permissionsBadgeEl.innerHTML = '<i class="fa-solid fa-sliders"></i><span class="status-badge-text">PERMS</span>';
        permissionsBadgeEl.title = `Site Permissions: ${hostname} (Click to manage)`;
    }
}

export function closePermissionsPopover() {
    isPermissionsPopoverOpen = false;
    if (!permissionsPopoverEl) permissionsPopoverEl = document.getElementById('PermissionsPopover');
    if (permissionsPopoverEl) {
        permissionsPopoverEl.style.display = 'none';
    }
    if (permissionsBadgeEl) {
        permissionsBadgeEl.setAttribute('aria-expanded', 'false');
    }
}

export function togglePermissionsPopover(force) {
    if (typeof force === 'boolean') {
        isPermissionsPopoverOpen = force;
    } else {
        isPermissionsPopoverOpen = !isPermissionsPopoverOpen;
    }

    if (!permissionsPopoverEl) permissionsPopoverEl = document.getElementById('PermissionsPopover');
    if (!permissionsPopoverEl) return;

    if (!isPermissionsPopoverOpen) {
        permissionsPopoverEl.style.display = 'none';
        if (permissionsBadgeEl) permissionsBadgeEl.setAttribute('aria-expanded', 'false');
        return;
    }

    permissionsPopoverEl.style.display = 'flex';
    if (permissionsBadgeEl) permissionsBadgeEl.setAttribute('aria-expanded', 'true');

    if (currentPermissionsIsPrivate) {
        renderPermissionsPopoverContent('Private Profile', {}, true);
        return;
    }

    let hostname = '';
    try {
        hostname = new URL(currentPermissionsUrl).hostname;
    } catch (_) {}

    if (hostname && typeof window !== 'undefined' && window.miseAPI && typeof window.miseAPI.getDomainPermissions === 'function') {
        window.miseAPI.getDomainPermissions(hostname).then((perms) => {
            renderPermissionsPopoverContent(hostname, perms || {}, false);
        }).catch(() => {
            renderPermissionsPopoverContent(hostname, {}, false);
        });
    } else {
        renderPermissionsPopoverContent(hostname || 'Site', {}, false);
    }
}

export function renderPermissionsPopoverContent(domain, perms = {}, isPrivate = false) {
    if (!popoverDomainEl) popoverDomainEl = document.getElementById('PermissionsPopoverDomain');
    if (!popoverBodyEl) popoverBodyEl = document.getElementById('PermissionsPopoverBody');
    if (!popoverPrefsBtn) popoverPrefsBtn = document.getElementById('PermissionsPopoverPrefsBtn');
    if (!popoverBodyEl) return;

    if (popoverDomainEl) {
        popoverDomainEl.textContent = domain;
    }

    if (isPrivate) {
        if (popoverPrefsBtn) popoverPrefsBtn.style.display = 'none';
        popoverBodyEl.innerHTML = `
            <div class="permissions-private-advisory">
                <i class="fa-solid fa-lock" style="font-size: 20px; color: #f7768e; margin-bottom: 8px;"></i>
                <div style="font-weight: 600; margin-bottom: 4px; color: var(--text);">Zero-Trust Sensor Lockdown</div>
                <div style="font-size: 11px; color: var(--text); opacity: 0.8; line-height: 1.4;">
                    Hardware sensors, camera, microphone, geolocation, and clipboard access are strictly disabled in Private Profile to prevent device fingerprinting and physical location tracking.
                </div>
            </div>
        `;
        return;
    }

    if (popoverPrefsBtn) popoverPrefsBtn.style.display = 'inline-flex';

    const capabilities = [
        { key: 'media:audio', label: 'Microphone', icon: 'fa-microphone' },
        { key: 'media:video', label: 'Camera', icon: 'fa-video' },
        { key: 'geolocation', label: 'Geolocation', icon: 'fa-location-dot' },
        { key: 'clipboard-read', label: 'Clipboard Read', icon: 'fa-clipboard' }
    ];

    let itemsHtml = '';
    for (const cap of capabilities) {
        const state = perms[cap.key] || 'prompt';
        const safeDomain = typeof escapeHtml === 'function' ? escapeHtml(domain) : domain;
        itemsHtml += `
            <div class="permissions-popover-item">
                <span class="permissions-popover-label">
                    <i class="fa-solid ${cap.icon}"></i>
                    <span>${cap.label}</span>
                </span>
                <select class="permissions-popover-select" data-domain="${safeDomain}" data-cap="${cap.key}">
                    <option value="prompt"${state === 'prompt' ? ' selected' : ''}>Ask (Default)</option>
                    <option value="allow"${state === 'allow' ? ' selected' : ''}>Allow</option>
                    <option value="deny"${state === 'deny' ? ' selected' : ''}>Block</option>
                </select>
            </div>
        `;
    }
    popoverBodyEl.innerHTML = itemsHtml;

    const selects = popoverBodyEl.querySelectorAll('.permissions-popover-select');
    for (const sel of selects) {
        sel.addEventListener('change', async (e) => {
            const dom = e.target.dataset.domain;
            const cap = e.target.dataset.cap;
            const val = e.target.value;
            if (typeof window !== 'undefined' && window.miseAPI && typeof window.miseAPI.setDomainPermission === 'function') {
                await window.miseAPI.setDomainPermission(dom, cap, val);
                const updated = await window.miseAPI.getDomainPermissions(dom);
                renderPermissionsBadgeUI(dom, updated || {});
            }
        });
    }
}

export function updatePartitionBadge(workspaceName, isPrivate) {
    if (!partitionBadgeEl) partitionBadgeEl = document.getElementById('StatusBarPartition');
    if (!partitionBadgeEl) return;

    const privateProfile = isPrivate || workspaceName === 'Private' || getWorkspacePartition(workspaceName) === 'MisePrivateProfile' || state.globalPrivateModeActive;
    const ws = privateProfile ? null : workspaceName || state.sessionState.current_workspace || 'Workspace 1';
    const key = privateProfile ? 'private' : `workspace:${ws}`;
    if (key === lastPartitionKey) return;
    lastPartitionKey = key;

    if (privateProfile) {
        partitionBadgeEl.innerHTML = '<i class="fa-solid fa-user-secret"></i><span class="status-badge-text">Private Profile</span>';
        partitionBadgeEl.className = 'status-badge status-badge-partition partition-private';
        partitionBadgeEl.title = 'Partition: MisePrivateProfile (Click to manage workspaces)';
        return;
    }

    const partitionStr = getWorkspacePartition(ws);
    const safeWs = typeof escapeHtml === 'function' ? escapeHtml(ws) : ws;
    partitionBadgeEl.innerHTML = `<i class="fa-solid fa-box-archive"></i><span class="status-badge-text">${safeWs}</span>`;
    partitionBadgeEl.className = 'status-badge status-badge-partition partition-container';
    partitionBadgeEl.title = `Container partition: ${partitionStr} (Click to manage workspaces)`;
}

export function setMode(modeName) {
    currentMode = modeName || 'NORMAL';
    if (!modeBadgeEl) modeBadgeEl = document.getElementById('StatusBarMode');
    if (!modeBadgeEl) return;

    modeBadgeEl.textContent = currentMode;
    modeBadgeEl.className = `status-badge status-badge-mode mode-${currentMode.toLowerCase()}`;
    modeBadgeEl.title = `Current browser mode: ${currentMode}`;
}

export function getMode() {
    return currentMode;
}

export function recalculateMode() {
    const currentWS = state.sessionState.current_workspace;
    let nextMode = 'NORMAL';

    if (isPassthroughModeActive) {
        nextMode = 'PASSTHROUGH';
    } else if (isHintsModeActive) {
        nextMode = 'HINTS';
    } else if (isHostInputFocused || isGuestInputFocused) {
        nextMode = 'INSERT';
    } else if (isSplitActive(currentWS)) {
        nextMode = 'SPLIT';
    } else {
        nextMode = 'NORMAL';
    }

    setMode(nextMode);
}

export function togglePassthroughMode(force) {
    if (typeof force === 'boolean') {
        isPassthroughModeActive = force;
    } else {
        isPassthroughModeActive = !isPassthroughModeActive;
    }
    recalculateMode();

    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    const currentIdx = activeListItem ? Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem) : 0;
    const activeWv = state.activeViewsCache[currentWS]?.[currentIdx];
    if (activeWv) {
        activeWv.__miseKeyboardMode ||= {};
        activeWv.__miseKeyboardMode.passthrough = isPassthroughModeActive;
    }
    if (activeWv && typeof activeWv.send === 'function') {
        try {
            activeWv.send('set-passthrough-mode', isPassthroughModeActive);
        } catch (err) {}
    }

    if (isPassthroughModeActive) {
        setTargetUrl('PASSTHROUGH mode enabled (Shift+Escape to return)', 2500);
    } else {
        setTargetUrl('NORMAL mode restored', 1500);
    }
    return isPassthroughModeActive;
}

export function handleGuestPassthroughState(isActive, wsName, tabIdx) {
    const view = state.activeViewsCache[wsName]?.[tabIdx];
    if (view) {
        view.__miseKeyboardMode ||= {};
        view.__miseKeyboardMode.passthrough = !!isActive;
    }
    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    const currentIdx = activeListItem ? Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem) : 0;

    if (wsName === currentWS && tabIdx === currentIdx) {
        const nextState = !!isActive;
        if (isPassthroughModeActive !== nextState) {
            isPassthroughModeActive = nextState;
            recalculateMode();
            if (isPassthroughModeActive) {
                setTargetUrl('PASSTHROUGH mode enabled (Shift+Escape to return)', 2500);
            } else {
                setTargetUrl('NORMAL mode restored', 1500);
            }
        }
    }
}

export function isPassthroughActive() {
    return isPassthroughModeActive;
}

export function handleGuestInputFocus(isFocused, wsName, tabIdx) {
    const view = state.activeViewsCache[wsName]?.[tabIdx];
    if (view) {
        view.__miseKeyboardMode ||= {};
        view.__miseKeyboardMode.input = !!isFocused;
    }
    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    const currentIdx = activeListItem ? Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem) : 0;

    if (wsName === currentWS && tabIdx === currentIdx) {
        const nextState = !!isFocused;
        if (isGuestInputFocused !== nextState) {
            isGuestInputFocused = nextState;
            recalculateMode();
        }
    }
}

export function handleGuestHintsState(isActive, wsName, tabIdx) {
    const view = state.activeViewsCache[wsName]?.[tabIdx];
    if (view) {
        view.__miseKeyboardMode ||= {};
        view.__miseKeyboardMode.hints = !!isActive;
    }
    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    const currentIdx = activeListItem ? Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem) : 0;

    if (wsName === currentWS && tabIdx === currentIdx) {
        const nextState = !!isActive;
        if (isHintsModeActive !== nextState) {
            isHintsModeActive = nextState;
            recalculateMode();
        }
    }
}

export function updateStatusBarFromActiveView() {
    const currentWS = state.sessionState.current_workspace;
    const isPrivate = currentWS === 'Private' || getWorkspacePartition(currentWS) === 'MisePrivateProfile' || !!state.globalPrivateModeActive;
    updatePartitionBadge(currentWS, isPrivate);

    const activeListItem = document.querySelector('#TabList li.selected');
    const currentIdx = activeListItem ? Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem) : 0;
    const urls = state.sessionState.workspaces[currentWS] || [];
    const activeUrl = urls[currentIdx] || '';

    updateSecurityStatus(activeUrl);
    updatePermissionsStatus(activeUrl, isPrivate);
    setTargetUrl('');

    const addressBar = document.getElementById('WideAddressBar');
    if (addressBar && document.activeElement !== addressBar) {
        addressBar.value = activeUrl || '';
    }

    const activeWv = state.activeViewsCache[currentWS]?.[currentIdx];
    const mode = activeWv?.__miseKeyboardMode || {};
    isGuestInputFocused = !!mode.input;
    isHintsModeActive = !!mode.hints;
    isPassthroughModeActive = !!mode.passthrough;
    recalculateMode();

    updateDarkReaderButtonUI(isWebviewDarkReaderActive(activeWv));
    updateReaderViewButtonUI(!!(activeWv && activeWv.__miseReaderActive));
}

export function updateReaderViewButtonUI(enabled) {
    const btn = document.getElementById('reader-view-btn');
    if (!btn) return;
    if (enabled) {
        btn.classList.add('active');
        btn.title = 'Toggle Reader View (Active - F9 / e)';
    } else {
        btn.classList.remove('active');
        btn.title = 'Toggle Reader View (F9 / e)';
    }
}

export function toggleStatusBar(force) {
    if (!statusBarEl) statusBarEl = document.getElementById('StatusBar');
    if (!statusBarEl) return;

    if (typeof force === 'boolean') {
        isStatusBarEnabled = force;
    } else {
        isStatusBarEnabled = !isStatusBarEnabled;
    }

    statusBarEl.style.display = isStatusBarEnabled ? 'flex' : 'none';

    // Synchronise with settings if API available
    if (window.miseAPI && typeof window.miseAPI.updateBrowserSettings === 'function') {
        window.miseAPI.updateBrowserSettings({ show_status_bar: isStatusBarEnabled }).catch(() => {});
    }

    // Update preferences toggle checkbox if present
    const toggleInput = document.getElementById('setting-status-bar-toggle');
    if (toggleInput) {
        toggleInput.checked = isStatusBarEnabled;
    }

    return isStatusBarEnabled;
}

export function isStatusBarVisible() {
    return isStatusBarEnabled;
}
