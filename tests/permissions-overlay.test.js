// tests/permissions-overlay.test.js
// Automated verification for Permissions Vault Preferences overlay and interactive prompt banner

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { escapeHtml } = require('../modules/utils.js');

console.log('Running Mise Permissions Vault overlay regression tests...');

// 1. Verify index.html contains tab button, panel, and prompt banner
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

assert.match(
    html,
    /id="tab-btn-permissions"[^>]*data-tab="tab-permissions"/,
    '#tab-btn-permissions must exist with data-tab="tab-permissions"'
);
assert.match(
    html,
    /<section[^>]*id="tab-permissions"[^>]*role="tabpanel"/,
    '#tab-permissions section must exist with role="tabpanel"'
);
assert.match(
    html,
    /id="permissions-search-input"/,
    '#permissions-search-input must exist in index.html'
);
assert.match(
    html,
    /data-perm-filter="all"/,
    'Permissions filter chips must exist in index.html'
);
assert.match(
    html,
    /id="permissions-clear-all-btn"/,
    '#permissions-clear-all-btn must exist in index.html'
);
assert.match(
    html,
    /id="PermissionPromptBanner"/,
    '#PermissionPromptBanner must exist in index.html'
);
assert.match(
    html,
    /id="PermissionPromptAlwaysAllowBtn"/,
    '#PermissionPromptAlwaysAllowBtn must exist in index.html'
);

console.log('✓ HTML markup for Permissions Vault panel, toolbar, and prompt banner verified');

// 2. Mock DOM environment for permissions.js controller
class MockClassList {
    constructor() { this.classes = new Set(); }
    add(c) { this.classes.add(c); }
    remove(c) { this.classes.delete(c); }
    toggle(c, force) { if (force) this.classes.add(c); else this.classes.delete(c); }
    contains(c) { return this.classes.has(c); }
}

class MockElement {
    constructor(id, tag = 'div', dataset = {}) {
        this.id = id;
        this.tagName = tag.toUpperCase();
        this.dataset = dataset;
        this.style = {};
        this.classList = new MockClassList();
        this.listeners = {};
        this.children = [];
        this._html = '';
        this.value = '';
        this.textContent = '';
    }
    get innerHTML() { return this._html; }
    set innerHTML(val) { this._html = val; }
    addEventListener(name, fn) {
        if (!this.listeners[name]) this.listeners[name] = [];
        this.listeners[name].push(fn);
    }
    dispatchEvent(event) {
        const handlers = this.listeners[event.type] || [];
        for (const h of handlers) h(event);
    }
    closest(selector) {
        if (selector.includes('data-perm-filter') && this.dataset && this.dataset.permFilter) {
            return this;
        }
        if (selector.includes('data-domain') && this.dataset && this.dataset.domain) {
            return this;
        }
        return null;
    }
    querySelectorAll() {
        return [];
    }
}

const searchInputEl = new MockElement('permissions-search-input', 'input');
const listEl = new MockElement('permissions-vault-list', 'div');
const clearAllBtnEl = new MockElement('permissions-clear-all-btn', 'button');

const promptBannerEl = new MockElement('PermissionPromptBanner', 'div');
const promptDomainEl = new MockElement('PermissionPromptDomain', 'strong');
const promptMsgEl = new MockElement('PermissionPromptMessage', 'span');
const promptIconEl = new MockElement('PermissionPromptIcon', 'i');

const allowOnceBtn = new MockElement('PermissionPromptAllowOnceBtn', 'button');
const alwaysAllowBtn = new MockElement('PermissionPromptAlwaysAllowBtn', 'button');
const denyOnceBtn = new MockElement('PermissionPromptDenyOnceBtn', 'button');
const alwaysDenyBtn = new MockElement('PermissionPromptAlwaysDenyBtn', 'button');

const filterAllBtn = new MockElement('chip-all', 'button', { permFilter: 'all' });
const filterMicBtn = new MockElement('chip-mic', 'button', { permFilter: 'media:audio' });

const filterContainer = new MockElement('filter-container', 'div');
filterContainer.querySelectorAll = () => [filterAllBtn, filterMicBtn];

const domMap = {
    'permissions-search-input': searchInputEl,
    'permissions-vault-list': listEl,
    'permissions-clear-all-btn': clearAllBtnEl,
    'PermissionPromptBanner': promptBannerEl,
    'PermissionPromptDomain': promptDomainEl,
    'PermissionPromptMessage': promptMsgEl,
    'PermissionPromptIcon': promptIconEl,
    'PermissionPromptAllowOnceBtn': allowOnceBtn,
    'PermissionPromptAlwaysAllowBtn': alwaysAllowBtn,
    'PermissionPromptDenyOnceBtn': denyOnceBtn,
    'PermissionPromptAlwaysDenyBtn': alwaysDenyBtn
};

const mockVaultData = {
    version: 1,
    domains: {
        'meet.google.com': {
            'media:audio': 'allow',
            'media:video': 'allow',
            updated_at: 1730190000000
        },
        'maps.google.com': {
            'geolocation': 'deny',
            updated_at: 1730190000000
        }
    }
};

let lastPromptResolver = null;
let promptRequestedCallback = null;
let setPermissionCalls = [];
let revokePermissionCalls = [];
let clearAllCalls = 0;

const mockMiseAPI = {
    getPermissionsVault: async () => JSON.parse(JSON.stringify(mockVaultData)),
    setDomainPermission: async (dom, cap, val) => {
        setPermissionCalls.push({ dom, cap, val });
        return { success: true };
    },
    revokeDomainPermissions: async (dom) => {
        revokePermissionCalls.push(dom);
        return { success: true };
    },
    clearAllPermissions: async () => {
        clearAllCalls++;
        return { success: true };
    },
    resolvePermissionPrompt: async (id, allow, remember) => {
        lastPromptResolver = { id, allow, remember };
        return true;
    },
    onPermissionPromptRequested: (fn) => {
        promptRequestedCallback = fn;
    }
};

const context = {
    escapeHtml,
    document: {
        getElementById: (id) => domMap[id] || null,
        querySelector: (sel) => {
            if (sel === '.permissions-filter-chips') return filterContainer;
            return null;
        }
    },
    window: {
        miseAPI: mockMiseAPI,
        confirm: () => true
    }
};

vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, '../modules/overlays/permissions.js'), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/export /g, '');

vm.runInContext(source, context);

// 3. Initialise overlay and verify prompt callback registration
context.initPermissionsOverlay();
assert(typeof promptRequestedCallback === 'function', 'onPermissionPromptRequested listener must be registered');

// 4. Test renderPermissionsVaultView renders both domains
(async () => {
    await context.renderPermissionsVaultView();
    assert.match(listEl.innerHTML, /meet\.google\.com/, 'meet.google.com card must be rendered');
    assert.match(listEl.innerHTML, /maps\.google\.com/, 'maps.google.com card must be rendered');
    assert.match(listEl.innerHTML, /permissions-vault-card/, 'Vault cards must be generated');

    console.log('✓ renderPermissionsVaultView populates domain cards from vault');

    // 5. Test interactive prompt broker banner
    promptRequestedCallback({
        requestId: 'req_123',
        domain: 'call.element.io',
        permission: 'media',
        capabilities: ['media:audio', 'media:video']
    });

    assert.equal(promptBannerEl.style.display, 'flex', 'Prompt banner must display on request');
    assert.equal(promptDomainEl.textContent, 'call.element.io');
    assert.match(promptMsgEl.textContent, /camera and microphone/);

    // Click "Always Allow"
    alwaysAllowBtn.onclick();
    assert.equal(promptBannerEl.style.display, 'none', 'Prompt banner must close on decision');
    assert.deepEqual(lastPromptResolver, { id: 'req_123', allow: true, remember: true });

    console.log('✓ Interactive prompt broker banner display and resolution verified');

    // 6. Test clear all permissions action
    await clearAllBtnEl.dispatchEvent({ type: 'click' });
    assert.equal(clearAllCalls, 1, 'clearAllPermissions must be called on confirmation');

    console.log('✓ Permissions reset confirmation and API execution verified');
    console.log('All Mise Permissions Vault overlay regression tests passed successfully!');
})();
