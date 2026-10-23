// tests/status-bar.test.js
// Automated verification for status bar DOM dirty-checking, accessibility, and per-view keyboard modes

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { escapeHtml } = require('../modules/utils.js');

console.log('Running Mise status bar throttling and accessibility regression tests...');

let htmlWrites = { security: 0, partition: 0 };
const elements = {
    StatusBar: { style: {} },
    StatusBarMode: { style: {}, classList: { add() {}, remove() {} }, addEventListener() {} },
    StatusBarUrl: { style: {} },
    WideAddressBar: { value: '', style: {} },
    StatusBarSecurity: {
        style: {},
        get innerHTML() { return this._html || ''; },
        set innerHTML(val) { this._html = val; htmlWrites.security += 1; }
    },
    StatusBarPartition: {
        style: {},
        addEventListener() {},
        get innerHTML() { return this._html || ''; },
        set innerHTML(val) { this._html = val; htmlWrites.partition += 1; }
    }
};

const mockState = {
    globalPrivateModeActive: false,
    sessionState: {
        current_workspace: 'Workspace 1',
        workspaces: { 'Workspace 1': ['https://example.org'] }
    },
    activeViewsCache: { 'Workspace 1': [{}] }
};

const context = {
    URL,
    escapeHtml,
    document: {
        getElementById: id => elements[id],
        querySelector: () => null,
        querySelectorAll: () => []
    },
    window: {
        addEventListener() {}
    },
    state: mockState,
    getWorkspacePartition: ws => `persist:workspace_${ws}`,
    isSplitActive: () => false,
    getSplitState: () => ({}),
    updateDarkReaderButtonUI() {},
    isWebviewDarkReaderActive: () => false,
    updateReaderViewButtonUI() {},
    setTimeout() {},
    clearTimeout() {}
};

vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, '../modules/statusBar.js'), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/export /g, '');

vm.runInContext(source, context);

// 1. Initial status update populates badges
context.updateSecurityStatus('https://example.org');
assert.equal(htmlWrites.security, 1, 'Initial security status call must set innerHTML');
assert.match(elements.StatusBarSecurity.innerHTML, /HTTPS/);

// 2. Duplicate URL call must be throttled by dirty checking
context.updateSecurityStatus('https://example.org');
assert.equal(htmlWrites.security, 1, 'Duplicate security status URL must not perform redundant DOM writes');

// 3. Changing URL triggers update
context.updateSecurityStatus('http://insecure.org');
assert.equal(htmlWrites.security, 2, 'New security URL triggers DOM update');
assert.match(elements.StatusBarSecurity.innerHTML, /HTTP<\/span>/);

// 4. Partition badge dirty checking
context.updatePartitionBadge('Workspace 1', false);
assert.equal(htmlWrites.partition, 1, 'Initial partition badge call sets innerHTML');

context.updatePartitionBadge('Workspace 1', false);
assert.equal(htmlWrites.partition, 1, 'Identical partition badge call is throttled without DOM rewrites');

context.updatePartitionBadge('Workspace 2', false);
assert.equal(htmlWrites.partition, 2, 'Workspace change updates partition badge');

// 5. Partition badge private mode transition
context.updatePartitionBadge('Workspace 2', true);
assert.equal(htmlWrites.partition, 3, 'Switching to private profile updates partition badge');
assert.match(elements.StatusBarPartition.innerHTML, /Private Profile/);

// 6. Partition badge duplicate private mode call is throttled
context.updatePartitionBadge('Workspace 2', true);
assert.equal(htmlWrites.partition, 3, 'Repeated private partition call is throttled');

// 7. Partition badge HTML escaping guard
context.updatePartitionBadge('Workspace <img src=x onerror=alert(1)>', false);
assert.match(elements.StatusBarPartition.innerHTML, /Workspace &lt;img src=x onerror=alert\(1\)&gt;/);
assert.doesNotMatch(elements.StatusBarPartition.innerHTML, /<img/);

console.log('✓ Security and partition badge updates suppress redundant DOM operations');
console.log('✓ Status bar badges safely escape special HTML characters');

// 8. Stacking order verification: auto-collapsed and extended sidebar sits above status bar
{
    const cssContent = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');

    const sidebarMatch = cssContent.match(/body\.sidebar-auto-collapse\s+#Sidebar\s*\{[^}]*?z-index:\s*(\d+)/);
    assert(sidebarMatch, 'body.sidebar-auto-collapse #Sidebar must define a numeric z-index');
    const sidebarZIndex = parseInt(sidebarMatch[1], 10);

    const statusBarMatch = cssContent.match(/\.status-bar\s*\{[^}]*?z-index:\s*(\d+)/);
    assert(statusBarMatch, '.status-bar must define a numeric z-index');
    const statusBarZIndex = parseInt(statusBarMatch[1], 10);

    assert(sidebarZIndex > statusBarZIndex, `Auto-collapse sidebar z-index (${sidebarZIndex}) must be higher than status-bar z-index (${statusBarZIndex}) to prevent covering bottom controls`);

    console.log('✓ Sidebar stacking order over status bar verified');
}

console.log('All status bar throttling regression tests passed successfully!');
