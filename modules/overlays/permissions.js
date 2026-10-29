// modules/overlays/permissions.js
// Client-side controller for the Granular Per-Domain Permission Vault and interactive prompt broker

import { escapeHtml } from '../utils.js';

let activeFilter = 'all';
let searchQuery = '';
let cachedVault = null;
let activePromptRequestId = null;

const CAPABILITIES = [
    { key: 'media:audio', label: 'Microphone', icon: 'fa-microphone' },
    { key: 'media:video', label: 'Camera', icon: 'fa-video' },
    { key: 'geolocation', label: 'Geolocation', icon: 'fa-location-dot' },
    { key: 'clipboard-read', label: 'Clipboard Read', icon: 'fa-clipboard' },
    { key: 'notifications', label: 'Notifications', icon: 'fa-bell' }
];

export function initPermissionsOverlay() {
    const searchInput = document.getElementById('permissions-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = (e.target.value || '').trim().toLowerCase();
            renderVaultListUI();
        });
    }

    const filterContainer = document.querySelector('.permissions-filter-chips');
    if (filterContainer) {
        filterContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-perm-filter]');
            if (!btn) return;
            const targetFilter = btn.dataset.permFilter;
            if (activeFilter === targetFilter) return;

            activeFilter = targetFilter;
            filterContainer.querySelectorAll('[data-perm-filter]').forEach((chip) => {
                chip.classList.toggle('active', chip.dataset.permFilter === activeFilter);
            });
            renderVaultListUI();
        });
    }

    const clearAllBtn = document.getElementById('permissions-clear-all-btn');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', async () => {
            if (typeof window.confirm === 'function') {
                const confirmed = window.confirm('Reset all saved domain permissions? This action cannot be undone.');
                if (!confirmed) return;
            }
            if (window.miseAPI && typeof window.miseAPI.clearAllPermissions === 'function') {
                await window.miseAPI.clearAllPermissions();
                await renderPermissionsVaultView();
            }
        });
    }

    // Interactive prompt banner initialisation
    setupPermissionPromptListeners();

    // Expose global render hook for Preferences navigation
    if (typeof window !== 'undefined') {
        window.renderPermissionsVaultView = renderPermissionsVaultView;
    }
}

export async function renderPermissionsVaultView() {
    if (!window.miseAPI || typeof window.miseAPI.getPermissionsVault !== 'function') return;
    try {
        cachedVault = await window.miseAPI.getPermissionsVault();
    } catch (_) {
        cachedVault = { version: 1, domains: {} };
    }
    renderVaultListUI();
}

function renderVaultListUI() {
    const listEl = document.getElementById('permissions-vault-list');
    if (!listEl) return;

    const domainsObj = (cachedVault && cachedVault.domains) || {};
    const domainNames = Object.keys(domainsObj);

    if (domainNames.length === 0) {
        listEl.innerHTML = `
            <div class="permissions-vault-empty">
                <i class="fa-solid fa-shield-halved" style="font-size: 28px; opacity: 0.35; margin-bottom: 8px;"></i>
                <p>No per-domain permission overrides configured yet.</p>
                <span style="font-size: 11px; opacity: 0.7;">Permissions are recorded as you grant access, or pre-configured via the status bar.</span>
            </div>
        `;
        return;
    }

    let filteredDomains = domainNames.filter((dom) => {
        if (searchQuery && !dom.toLowerCase().includes(searchQuery)) {
            return false;
        }
        if (activeFilter !== 'all') {
            const record = domainsObj[dom] || {};
            if (!record[activeFilter] || record[activeFilter] === 'prompt') {
                return false;
            }
        }
        return true;
    });

    // Sort domains alphabetically
    filteredDomains.sort((a, b) => a.localeCompare(b));

    if (filteredDomains.length === 0) {
        listEl.innerHTML = `
            <div class="permissions-vault-empty">
                <i class="fa-solid fa-magnifying-glass" style="font-size: 24px; opacity: 0.35; margin-bottom: 8px;"></i>
                <p>No domain records matching "${escapeHtml(searchQuery)}".</p>
            </div>
        `;
        return;
    }

    let html = '';
    for (const domain of filteredDomains) {
        const record = domainsObj[domain] || {};
        const safeDomain = escapeHtml(domain);

        let dateStr = '';
        if (record.updated_at) {
            try {
                const d = new Date(record.updated_at);
                dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            } catch (_) {}
        }

        let gridHtml = '';
        for (const cap of CAPABILITIES) {
            const state = record[cap.key] || 'prompt';
            gridHtml += `
                <div class="permissions-card-item">
                    <span class="permissions-card-item-label">
                        <i class="fa-solid ${cap.icon}"></i>
                        <span>${cap.label}</span>
                    </span>
                    <select class="permissions-cap-select" data-domain="${safeDomain}" data-cap="${cap.key}">
                        <option value="prompt"${state === 'prompt' ? ' selected' : ''}>Ask (Default)</option>
                        <option value="allow"${state === 'allow' ? ' selected' : ''}>Allow</option>
                        <option value="deny"${state === 'deny' ? ' selected' : ''}>Block</option>
                    </select>
                </div>
            `;
        }

        html += `
            <div class="permissions-vault-card" data-domain="${safeDomain}">
                <div class="permissions-card-header">
                    <div class="permissions-card-title-group">
                        <i class="fa-solid fa-globe permissions-card-globe"></i>
                        <span class="permissions-card-domain">${safeDomain}</span>
                        ${dateStr ? `<span class="permissions-card-date">${dateStr}</span>` : ''}
                    </div>
                    <button type="button" class="permissions-card-revoke-btn" data-domain="${safeDomain}" title="Forget all rules for ${safeDomain}">
                        <i class="fa-solid fa-trash-can"></i> Forget
                    </button>
                </div>
                <div class="permissions-card-grid">
                    ${gridHtml}
                </div>
            </div>
        `;
    }

    listEl.innerHTML = html;

    // Attach capability change listeners
    const selects = listEl.querySelectorAll('.permissions-cap-select');
    for (const sel of selects) {
        sel.addEventListener('change', async (e) => {
            const dom = e.target.dataset.domain;
            const cap = e.target.dataset.cap;
            const val = e.target.value;
            if (window.miseAPI && typeof window.miseAPI.setDomainPermission === 'function') {
                await window.miseAPI.setDomainPermission(dom, cap, val);
                if (cachedVault && cachedVault.domains && cachedVault.domains[dom]) {
                    cachedVault.domains[dom][cap] = val;
                }
            }
        });
    }

    // Attach revoke domain listeners
    const revokeBtns = listEl.querySelectorAll('.permissions-card-revoke-btn');
    for (const btn of revokeBtns) {
        btn.addEventListener('click', async (e) => {
            const dom = e.target.closest('[data-domain]')?.dataset.domain;
            if (!dom) return;
            if (window.miseAPI && typeof window.miseAPI.revokeDomainPermissions === 'function') {
                await window.miseAPI.revokeDomainPermissions(dom);
                if (cachedVault && cachedVault.domains) {
                    delete cachedVault.domains[dom];
                }
                renderVaultListUI();
            }
        });
    }
}

function setupPermissionPromptListeners() {
    const banner = document.getElementById('PermissionPromptBanner');
    const domainEl = document.getElementById('PermissionPromptDomain');
    const msgEl = document.getElementById('PermissionPromptMessage');
    const iconEl = document.getElementById('PermissionPromptIcon');

    const allowOnceBtn = document.getElementById('PermissionPromptAllowOnceBtn');
    const alwaysAllowBtn = document.getElementById('PermissionPromptAlwaysAllowBtn');
    const denyOnceBtn = document.getElementById('PermissionPromptDenyOnceBtn');
    const alwaysDenyBtn = document.getElementById('PermissionPromptAlwaysDenyBtn');

    if (!banner || !window.miseAPI || typeof window.miseAPI.onPermissionPromptRequested !== 'function') {
        return;
    }

    window.miseAPI.onPermissionPromptRequested((requestData) => {
        if (!requestData || !requestData.requestId) return;
        activePromptRequestId = requestData.requestId;

        const domain = requestData.domain || 'This website';
        const permission = requestData.permission || 'feature';
        const caps = requestData.capabilities || [];

        let readableCap = permission;
        let iconClass = 'fa-solid fa-shield-halved';

        if (caps.includes('media:video') && caps.includes('media:audio')) {
            readableCap = 'camera and microphone';
            iconClass = 'fa-solid fa-video';
        } else if (caps.includes('media:video')) {
            readableCap = 'camera';
            iconClass = 'fa-solid fa-video';
        } else if (caps.includes('media:audio')) {
            readableCap = 'microphone';
            iconClass = 'fa-solid fa-microphone';
        } else if (caps.includes('geolocation') || permission === 'geolocation') {
            readableCap = 'physical location';
            iconClass = 'fa-solid fa-location-dot';
        } else if (caps.includes('clipboard-read') || permission === 'clipboard-read') {
            readableCap = 'clipboard contents';
            iconClass = 'fa-solid fa-clipboard';
        } else if (caps.includes('notifications') || permission === 'notifications') {
            readableCap = 'desktop notifications';
            iconClass = 'fa-solid fa-bell';
        }

        if (domainEl) domainEl.textContent = domain;
        if (msgEl) msgEl.textContent = `wants to access your ${readableCap}`;
        if (iconEl) iconEl.className = `${iconClass} permission-prompt-icon`;

        banner.style.display = 'flex';
    });

    async function handlePromptAction(allow, remember) {
        if (!activePromptRequestId) return;
        const reqId = activePromptRequestId;
        activePromptRequestId = null;
        banner.style.display = 'none';

        if (window.miseAPI && typeof window.miseAPI.resolvePermissionPrompt === 'function') {
            await window.miseAPI.resolvePermissionPrompt(reqId, allow, remember);
            if (remember) {
                renderPermissionsVaultView();
            }
        }
    }

    if (allowOnceBtn) allowOnceBtn.onclick = () => handlePromptAction(true, false);
    if (alwaysAllowBtn) alwaysAllowBtn.onclick = () => handlePromptAction(true, true);
    if (denyOnceBtn) denyOnceBtn.onclick = () => handlePromptAction(false, false);
    if (alwaysDenyBtn) alwaysDenyBtn.onclick = () => handlePromptAction(false, true);
}
