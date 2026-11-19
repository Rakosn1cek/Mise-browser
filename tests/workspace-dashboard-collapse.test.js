// tests/workspace-dashboard-collapse.test.js
// Regression test suite for Milestone 5: Workspace Dashboard Overlay expand/shrink controls

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise Workspace Dashboard collapse/expand regression tests...');

class MockClassList {
    constructor(owner) {
        this.owner = owner;
        this.set = new Set();
    }
    syncFromString(str) {
        this.set = new Set(String(str || '').split(/\s+/).filter(Boolean));
    }
    syncToString() {
        this.owner._className = Array.from(this.set).join(' ');
    }
    add(...names) {
        for (const n of names) {
            if (n) this.set.add(n);
        }
        this.syncToString();
    }
    remove(...names) {
        for (const n of names) {
            this.set.delete(n);
        }
        this.syncToString();
    }
    contains(name) {
        return this.set.has(name);
    }
    toggle(name, force) {
        if (force === true) {
            this.add(name);
            return true;
        }
        if (force === false) {
            this.remove(name);
            return false;
        }
        if (this.set.has(name)) {
            this.remove(name);
            return false;
        }
        this.add(name);
        return true;
    }
}

class MockElement {
    constructor(tagName = 'div', id = '') {
        this.tagName = String(tagName).toUpperCase();
        this.id = id;
        this._className = '';
        this.classList = new MockClassList(this);
        this.style = {};
        this.dataset = {};
        this.attributes = {};
        this.children = [];
        this.listeners = {};
        this.textContent = '';
        this._innerHTML = '';
        this.title = '';
        this.type = '';
        this.value = '';
        this.parentNode = null;
    }

    get className() {
        return this._className;
    }

    set className(val) {
        this._className = String(val || '');
        this.classList.syncFromString(this._className);
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(val) {
        this._innerHTML = String(val || '');
        if (this._innerHTML === '') {
            this.children = [];
        }
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    replaceChild(newChild, oldChild) {
        const idx = this.children.indexOf(oldChild);
        if (idx >= 0) {
            newChild.parentNode = this;
            this.children[idx] = newChild;
        }
        return oldChild;
    }

    setAttribute(name, val) {
        this.attributes[name] = String(val);
    }

    getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name)
            ? this.attributes[name]
            : null;
    }

    addEventListener(event, handler) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(handler);
    }

    dispatchEvent(eventObj) {
        const handlers = this.listeners[eventObj.type] || [];
        for (const handler of handlers) {
            handler(eventObj);
        }
    }

    click() {
        this.dispatchEvent({ type: 'click', stopPropagation: () => {}, preventDefault: () => {} });
    }

    focus() {
        if (global.document) global.document.activeElement = this;
    }

    blur() {
        if (global.document && global.document.activeElement === this) {
            global.document.activeElement = global.document.body;
        }
    }

    scrollIntoView() {}
    select() {}
    remove() {
        if (this.parentNode && Array.isArray(this.parentNode.children)) {
            const idx = this.parentNode.children.indexOf(this);
            if (idx >= 0) this.parentNode.children.splice(idx, 1);
            this.parentNode = null;
        }
    }
    getURL() { return this.attributes.src || ''; }
    getTitle() { return ''; }
    isLoading() { return false; }
    setAudioMuted() {}
    setZoomFactor() {}
    contains(target) {
        if (target === this) return true;
        return this.children.some((c) => c.contains(target));
    }

    findAll(predicate, acc = []) {
        for (const child of this.children) {
            if (predicate(child)) acc.push(child);
            child.findAll(predicate, acc);
        }
        return acc;
    }

    querySelectorAll(selector) {
        if (selector.startsWith('.')) {
            const cls = selector.slice(1);
            return this.findAll((el) => el.classList.contains(cls));
        }
        if (selector.startsWith('#')) {
            const targetId = selector.slice(1);
            return this.findAll((el) => el.id === targetId);
        }
        const upperTag = selector.toUpperCase();
        return this.findAll((el) => el.tagName === upperTag);
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }
}

(async () => {
    const elementsById = new Map();
    const createManagedEl = (tag, id) => {
        const el = new MockElement(tag, id);
        if (id) elementsById.set(id, el);
        return el;
    };

    const bodyEl = createManagedEl('body', '');
    const sidebarEl = createManagedEl('aside', 'Sidebar');
    const dashboardOverlay = createManagedEl('div', 'DashboardOverlay');
    const treeContainer = createManagedEl('div', 'DashboardTreeContainer');
    const webviewContainer = createManagedEl('div', 'webview-container');
    const tabListEl = createManagedEl('ul', 'TabList');
    const workspaceBadge = createManagedEl('div', 'WorkspaceBadge');
    const statusPartition = createManagedEl('div', 'StatusBarPartition');

    dashboardOverlay.appendChild(treeContainer);
    bodyEl.appendChild(sidebarEl);
    bodyEl.appendChild(dashboardOverlay);
    bodyEl.appendChild(webviewContainer);
    sidebarEl.appendChild(tabListEl);
    bodyEl.appendChild(workspaceBadge);
    bodyEl.appendChild(statusPartition);

    global.document = {
        body: bodyEl,
        activeElement: bodyEl,
        getElementById: (id) => elementsById.get(id) || null,
        createElement: (tag) => new MockElement(tag),
        querySelector: (selector) => {
            if (selector === '#TabList li.selected') {
                return tabListEl.children.find((el) => el.tagName === 'LI' && el.classList.contains('selected')) || null;
            }
            return bodyEl.querySelector(selector);
        },
        querySelectorAll: (selector) => {
            if (selector === '#TabList li') {
                return tabListEl.children.filter((el) => el.tagName === 'LI');
            }
            return bodyEl.querySelectorAll(selector);
        }
    };

    let savedSessionsCount = 0;
    global.window = {
        miseAPI: {
            saveSession: () => { savedSessionsCount++; },
            getWorkspaceCookieCounts: async () => ({}),
            clearWorkspaceCookies: async () => true,
            getWebviewPreloadPath: () => '/tmp/webview-preload.js',
            getBrowserSettings: async () => ({ trusted_domains: [] })
        },
        confirm: () => true
    };

    const { state } = await import('../modules/state.js');
    const dashboard = await import('../modules/overlays/dashboard.js');
    const workspaceController = await import('../modules/renderer/workspaceController.js');

    const {
        buildDashboardTree,
        isWorkspaceExpanded,
        setWorkspaceExpanded,
        toggleWorkspaceExpansion,
        renameWorkspace,
        deleteWorkspace,
        toggleDashboardView
    } = dashboard;

    // 1. Default expansion state: active workspace expanded, inactive collapsed
    {
        state.sessionState = {
            current_workspace: 'Work',
            workspaces: {
                'Private': ['https://private.example.org'],
                'Work': ['https://github.com', 'https://archlinux.org', 'https://mise.dev'],
                'Personal': ['https://news.ycombinator.com'],
                'EmptyWS': []
            },
            active_tabs: { 'Work': 0, 'Personal': 0, 'EmptyWS': 0 },
            workspace_visuals: {}
        };
        state.activeTitlesCache = {
            'Work': ['GitHub', 'Arch Linux', 'Mise'],
            'Personal': ['Hacker News'],
            'Private': ['Private Page']
        };
        state.dashboardExpandedWorkspaces = {};
        state.dashboardActive = true;

        assert.strictEqual(isWorkspaceExpanded('Work'), true, 'Active workspace must default to expanded');
        assert.strictEqual(isWorkspaceExpanded('Personal'), false, 'Inactive workspace must default to collapsed');
        assert.strictEqual(isWorkspaceExpanded('Private'), false, 'Inactive Private workspace must default to collapsed');
        assert.strictEqual(isWorkspaceExpanded('EmptyWS'), false, 'Inactive empty workspace must default to collapsed');

        buildDashboardTree();

        const nodes = treeContainer.querySelectorAll('.workspace-tree-node');
        assert.strictEqual(nodes.length, 4, 'All 4 workspace nodes must render');

        const findNode = (ws) => nodes.find((n) => n.dataset.ws === ws);
        const privateNode = findNode('Private');
        const workNode = findNode('Work');
        const personalNode = findNode('Personal');
        const emptyNode = findNode('EmptyWS');

        assert.ok(privateNode.classList.contains('collapsed'), 'Inactive Private node must carry collapsed class');
        assert.ok(!workNode.classList.contains('collapsed'), 'Active Work node must not carry collapsed class');
        assert.ok(personalNode.classList.contains('collapsed'), 'Inactive Personal node must carry collapsed class');
        assert.ok(emptyNode.classList.contains('collapsed'), 'Inactive EmptyWS node must carry collapsed class');

        // Verify visible tab rows only exist for expanded Work workspace
        assert.strictEqual(privateNode.querySelectorAll('.dashboard-tab-item').length, 0, 'Collapsed Private node must hide tab rows');
        assert.strictEqual(workNode.querySelectorAll('.dashboard-tab-item').length, 3, 'Expanded Work node must render 3 tab rows');
        assert.strictEqual(personalNode.querySelectorAll('.dashboard-tab-item').length, 0, 'Collapsed Personal node must hide tab rows');
        assert.strictEqual(emptyNode.querySelectorAll('.dashboard-tab-item').length, 0, 'Collapsed EmptyWS node must hide tab rows');

        // Verify dashboardItems excludes collapsed tabs (4 headers + 3 Work tabs = 7 items)
        assert.strictEqual(state.dashboardItems.length, 7, 'dashboardItems must include 4 headers and 3 expanded Work tabs');

        // Verify tab count badges across singular, plural, and zero counts
        assert.strictEqual(privateNode.querySelector('.workspace-tab-count-tag').textContent, '1 tab');
        assert.strictEqual(workNode.querySelector('.workspace-tab-count-tag').textContent, '3 tabs');
        assert.strictEqual(personalNode.querySelector('.workspace-tab-count-tag').textContent, '1 tab');
        assert.strictEqual(emptyNode.querySelector('.workspace-tab-count-tag').textContent, '0 tabs');

        // Verify toggle buttons on every workspace including Private
        const workBtn = workNode.querySelector('.workspace-toggle-btn');
        const personalBtn = personalNode.querySelector('.workspace-toggle-btn');
        const privateBtn = privateNode.querySelector('.workspace-toggle-btn');
        assert.ok(workBtn && personalBtn && privateBtn, 'Every workspace header including Private must render a toggle button');
        assert.strictEqual(workBtn.getAttribute('aria-expanded'), 'true');
        assert.ok(workBtn.innerHTML.includes('fa-chevron-up'), 'Expanded toggle button must render fa-chevron-up');
        assert.strictEqual(personalBtn.getAttribute('aria-expanded'), 'false');
        assert.ok(personalBtn.innerHTML.includes('fa-chevron-down'), 'Collapsed toggle button must render fa-chevron-down');
        assert.strictEqual(privateBtn.getAttribute('aria-expanded'), 'false');

        // Also check when Private is current_workspace
        state.sessionState.current_workspace = 'Private';
        state.dashboardExpandedWorkspaces = {};
        assert.strictEqual(isWorkspaceExpanded('Private'), true, 'Active Private workspace must default to expanded');
        assert.strictEqual(isWorkspaceExpanded('Work'), false, 'Inactive Work workspace must default to collapsed when Private is active');

        state.sessionState.current_workspace = 'Work';
        state.dashboardExpandedWorkspaces = {};
        console.log('✓ Default expansion state, collapsed tab hiding, tab count badges, and toggle buttons verified');
    }

    // 2. Manual toggles persist in state.dashboardExpandedWorkspaces across rebuilds and anchor selection
    {
        buildDashboardTree();
        const personalBtn = treeContainer
            .querySelectorAll('.workspace-tree-node')
            .find((n) => n.dataset.ws === 'Personal')
            .querySelector('.workspace-toggle-btn');

        personalBtn.click();

        assert.strictEqual(state.dashboardExpandedWorkspaces['Personal'], true, 'Clicking toggle must persist Personal expanded state');
        assert.strictEqual(isWorkspaceExpanded('Personal'), true);

        const personalNode = treeContainer.querySelectorAll('.workspace-tree-node').find((n) => n.dataset.ws === 'Personal');
        assert.strictEqual(personalNode.querySelectorAll('.dashboard-tab-item').length, 1, 'Expanded Personal node must show its tab row');
        assert.strictEqual(state.dashboardItems[state.dashboardSelectionIdx].payload[1], 'Personal', 'Toggling Personal must anchor selection on Personal');

        // Rebuilding tree (e.g. closing and reopening Dashboard in same session) preserves manual state
        buildDashboardTree();
        const rebuiltPersonal = treeContainer.querySelectorAll('.workspace-tree-node').find((n) => n.dataset.ws === 'Personal');
        assert.strictEqual(rebuiltPersonal.querySelectorAll('.dashboard-tab-item').length, 1, 'Session expansion state must survive buildDashboardTree() rebuilds');

        // Collapse active Work workspace manually
        const nextWorkState = toggleWorkspaceExpansion('Work');
        assert.strictEqual(nextWorkState, false);
        assert.strictEqual(state.dashboardExpandedWorkspaces['Work'], false);
        const rebuiltWork = treeContainer.querySelectorAll('.workspace-tree-node').find((n) => n.dataset.ws === 'Work');
        assert.strictEqual(rebuiltWork.querySelectorAll('.dashboard-tab-item').length, 0, 'Manually collapsed Work workspace must hide tab rows');
        assert.strictEqual(state.dashboardItems[state.dashboardSelectionIdx].payload[1], 'Work', 'Toggling Work must anchor selection on Work');

        console.log('✓ Manual session-scoped expand/shrink persistence and anchoring verified');
    }

    // 3. Rename migrates expansion state and deletion removes it
    {
        setWorkspaceExpanded('Personal', true);
        renameWorkspace('Personal', 'Hobby');
        assert.strictEqual(state.dashboardExpandedWorkspaces['Personal'], undefined, 'Old workspace key must be removed on rename');
        assert.strictEqual(state.dashboardExpandedWorkspaces['Hobby'], true, 'Expansion state must migrate to renamed workspace');

        setWorkspaceExpanded('EmptyWS', true);
        deleteWorkspace('EmptyWS');
        assert.strictEqual(state.dashboardExpandedWorkspaces['EmptyWS'], undefined, 'Deleted workspace key must be removed from dashboardExpandedWorkspaces');
        assert.ok(savedSessionsCount > 0, 'Session save hooks must be invoked during rename and delete');

        console.log('✓ Workspace rename migration and deletion cleanup of expansion state verified');
    }

    // 4. Keyboard shortcuts (Space, ArrowRight, ArrowLeft) and button activation in workspaceController.js
    {
        state.dashboardExpandedWorkspaces = {};
        state.sessionState.current_workspace = 'Work';
        state.dashboardActive = true;
        workspaceController.setupWorkspaceListeners();
        buildDashboardTree('Hobby');

        const makeKeyEvent = (key) => {
            let prevented = false;
            return {
                type: 'keydown',
                key,
                preventDefault: () => { prevented = true; },
                stopPropagation: () => {},
                get prevented() { return prevented; }
            };
        };

        // Ensure Hobby starts collapsed and selected
        assert.strictEqual(isWorkspaceExpanded('Hobby'), false);
        assert.strictEqual(state.dashboardItems[state.dashboardSelectionIdx].payload[0], 'workspace');
        assert.strictEqual(state.dashboardItems[state.dashboardSelectionIdx].payload[1], 'Hobby');

        // ArrowRight expands selected collapsed workspace
        const rightEv = makeKeyEvent('ArrowRight');
        dashboardOverlay.dispatchEvent(rightEv);
        assert.strictEqual(rightEv.prevented, true, 'ArrowRight must preventDefault when expanding workspace');
        assert.strictEqual(isWorkspaceExpanded('Hobby'), true, 'ArrowRight must expand collapsed workspace');
        assert.strictEqual(state.dashboardItems[state.dashboardSelectionIdx].payload[1], 'Hobby', 'Selection remains anchored on Hobby');

        // ArrowLeft collapses expanded workspace
        const leftEv = makeKeyEvent('ArrowLeft');
        dashboardOverlay.dispatchEvent(leftEv);
        assert.strictEqual(leftEv.prevented, true, 'ArrowLeft must preventDefault when collapsing workspace');
        assert.strictEqual(isWorkspaceExpanded('Hobby'), false, 'ArrowLeft must collapse expanded workspace');

        // Space toggles selected workspace header
        const spaceExpandEv = makeKeyEvent(' ');
        dashboardOverlay.dispatchEvent(spaceExpandEv);
        assert.strictEqual(spaceExpandEv.prevented, true, 'Space must preventDefault on workspace header');
        assert.strictEqual(isWorkspaceExpanded('Hobby'), true, 'First Space press must expand Hobby');

        // Move down to tab row inside Hobby and press ArrowLeft to collapse parent workspace
        const downEv = makeKeyEvent('ArrowDown');
        dashboardOverlay.dispatchEvent(downEv);
        assert.strictEqual(state.dashboardItems[state.dashboardSelectionIdx].payload[0], 'tab', 'ArrowDown must move to Hobby tab item');
        assert.strictEqual(state.dashboardItems[state.dashboardSelectionIdx].payload[1], 'Hobby');

        const collapseFromTabEv = makeKeyEvent('ArrowLeft');
        dashboardOverlay.dispatchEvent(collapseFromTabEv);
        assert.strictEqual(collapseFromTabEv.prevented, true);
        assert.strictEqual(isWorkspaceExpanded('Hobby'), false, 'ArrowLeft on a tab item must collapse its parent workspace');
        assert.strictEqual(state.dashboardItems[state.dashboardSelectionIdx].payload[0], 'workspace', 'Selection must return to collapsed parent workspace header');
        assert.strictEqual(state.dashboardItems[state.dashboardSelectionIdx].payload[1], 'Hobby');

        // Space on focused button clicks that button rather than virtual tree cursor
        const hobbyBtn = treeContainer
            .querySelectorAll('.workspace-tree-node')
            .find((n) => n.dataset.ws === 'Hobby')
            .querySelector('.workspace-toggle-btn');
        hobbyBtn.focus();
        const spaceBtnEv = makeKeyEvent(' ');
        dashboardOverlay.dispatchEvent(spaceBtnEv);
        assert.strictEqual(spaceBtnEv.prevented, true);
        assert.strictEqual(isWorkspaceExpanded('Hobby'), true, 'Space on focused toggle button must click button');

        // Enter on workspace header still switches workspace and closes Dashboard
        document.activeElement = dashboardOverlay;
        buildDashboardTree('Hobby');
        const enterEv = makeKeyEvent('Enter');
        dashboardOverlay.dispatchEvent(enterEv);
        assert.strictEqual(state.sessionState.current_workspace, 'Hobby', 'Enter on workspace header must activate workspace');
        assert.strictEqual(state.dashboardActive, false, 'Enter activation must close Dashboard');

        // Avoid unused import warning while confirming toggleDashboardView exists
        assert.strictEqual(typeof toggleDashboardView, 'function');

        console.log('✓ Keyboard Space, ArrowRight, ArrowLeft, and Enter controls verified');
    }

    // 5. CSS rules and line budgets check
    {
        const cssSource = fs.readFileSync(path.join(__dirname, '../styles/overlays/dashboard.css'), 'utf8');
        assert.ok(cssSource.includes('.workspace-tab-count-tag'), 'dashboard.css must style .workspace-tab-count-tag');
        assert.ok(cssSource.includes('.workspace-tree-node.collapsed .workspace-tab-count-tag'), 'dashboard.css must style collapsed tab count badge');
        assert.ok(cssSource.includes('.workspace-toggle-btn:hover'), 'dashboard.css must style .workspace-toggle-btn:hover');

        const budgetTargets = [
            { file: '../modules/renderer/workspaceController.js', limit: 250 },
            { file: '../renderer.js', limit: 250 },
            { file: '../index.html', limit: 260 },
            { file: '../main.js', limit: 550 }
        ];
        for (const target of budgetTargets) {
            const lines = fs.readFileSync(path.join(__dirname, target.file), 'utf8').split('\n').length;
            assert.ok(lines < target.limit, `${target.file} must stay under ${target.limit} lines (currently ${lines})`);
        }
        console.log('✓ CSS styling rules and strict file line budgets verified');
    }

    console.log('All Workspace Dashboard collapse/expand regression tests passed successfully!');
})().catch((err) => {
    console.error('Workspace Dashboard collapse test failed:', err);
    process.exit(1);
});
