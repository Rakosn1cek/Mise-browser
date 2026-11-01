// tests/address-bar-navigation.test.js
// Verification for Address Bar keyboard navigation, suggestion selection, focus restoration, and blur handling

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise address bar navigation and keyboard interaction regression tests...');

const navSource = fs.readFileSync(path.join(__dirname, '../modules/navigation.js'), 'utf8');

// 1. Static code analysis of modules/navigation.js
{
    assert.ok(
        navSource.includes("addressBar.addEventListener('keydown'"),
        'modules/navigation.js must register keydown listener on WideAddressBar'
    );
    assert.ok(
        navSource.includes("if (e.key === 'Enter')"),
        'WideAddressBar keydown listener must handle Enter key'
    );
    assert.ok(
        navSource.includes("if (e.key === 'Escape')"),
        'WideAddressBar keydown listener must handle Escape key'
    );
    assert.ok(
        navSource.includes("addressBar.addEventListener('focus'"),
        'modules/navigation.js must register focus listener on WideAddressBar'
    );
    assert.ok(
        navSource.includes("addressBar.addEventListener('blur'"),
        'modules/navigation.js must register blur listener on WideAddressBar'
    );
    assert.ok(
        navSource.includes("addressBar.addEventListener('mouseup'"),
        'modules/navigation.js must register mouseup listener on WideAddressBar'
    );

    console.log('✓ modules/navigation.js address bar event listener registrations verified');
}

// 2. Functional testing of WideAddressBar keydown and lifecycle interactions
async function runFunctionalTests() {
    let focusedWebview = false;
    let selectedText = false;
    let updatedStatusBar = false;

    const listeners = {};
    const mockAddressBar = {
        value: '',
        selectionStart: 0,
        selectionEnd: 0,
        style: { display: 'inline-block' },
        blur() {},
        focus() {},
        select() {
            selectedText = true;
        },
        addEventListener(event, handler) {
            listeners[event] = handler;
        }
    };

    const mockSuggestionsList = {
        style: { display: 'none' },
        innerHTML: ''
    };

    const activeTab = { id: 'tab-0' };
    const mockState = {
        addressSelectionIdx: -1,
        addressSuggestions: [],
        sessionState: {
            current_workspace: 'Workspace 1',
            workspaces: { 'Workspace 1': ['https://example.com'] }
        },
        activeViewsCache: {
            'Workspace 1': [{ setAttribute: () => {} }]
        }
    };

    const mockDoc = {
        getElementById(id) {
            if (id === 'WideAddressBar') return mockAddressBar;
            if (id === 'AddressSuggestions') return mockSuggestionsList;
            if (id === 'StatusBar') return { style: { display: 'flex' } };
            return null;
        },
        querySelector(sel) {
            if (sel === '#TabList li.selected') return activeTab;
            return null;
        },
        querySelectorAll(sel) {
            if (sel === '#TabList li') return [activeTab];
            return [];
        },
        activeElement: mockAddressBar
    };

    const strippedNav = navSource
        .replace(/import\s+[^;]+;\s*/g, '')
        .replace('export const POPULAR_BANGS', 'const POPULAR_BANGS')
        .replace('export function dismissAddressBar', 'function dismissAddressBar')
        .replace('export function extractDdgBang', 'function extractDdgBang')
        .replace('export function displayAddressOverlay', 'function displayAddressOverlay')
        .replace('export async function handleNavigation', 'async function handleNavigation')
        .replace('export function setupAddressBarAutocomplete', 'function setupAddressBarAutocomplete')
        .replace('export function renderSuggestions', 'function renderSuggestions')
        .replace('export function updateSuggestionHighlight', 'function updateSuggestionHighlight')
        .replace('export async function selectSuggestion', 'async function selectSuggestion')
        .replace('export function hideSuggestions', 'function hideSuggestions');

    const factory = new Function(
        'state', 'document', 'window', 'isPdfUrl', 'getPdfViewerUrl', 'setTargetUrl',
        'updateStatusBarFromActiveView', 'formatSearchUrl', 'resolveSearchAliasUrl',
        'evaluateMathExpression', 'extractDdgBang', 'focusActiveWebview', 'wakeTab',
        'renderWorkspaceUI', 'spawnTabWithUrl', 'requestAnimationFrame', 'setTimeout',
        `${strippedNav}\nreturn { setupAddressBarAutocomplete, handleNavigation, selectSuggestion };`
    );

    const scope = factory(
        mockState,
        mockDoc,
        { miseAPI: { saveSession: () => {} } },
        () => false,
        () => '',
        () => {},
        () => { updatedStatusBar = true; },
        (q, s) => s.replace('%s', encodeURIComponent(q)),
        () => null,
        () => null,
        () => null,
        () => { focusedWebview = true; },
        () => {},
        () => {},
        () => {},
        (fn) => fn(),
        (fn) => fn()
    );

    // Initialise address bar listeners
    scope.setupAddressBarAutocomplete();

    assert.equal(typeof listeners.keydown, 'function', 'keydown listener must be bound');
    assert.equal(typeof listeners.focus, 'function', 'focus listener must be bound');
    assert.equal(typeof listeners.blur, 'function', 'blur listener must be bound');
    assert.equal(typeof listeners.mouseup, 'function', 'mouseup listener must be bound');

    // Test A: Enter key triggers navigation when typing a URL
    mockAddressBar.value = 'https://archlinux.org';
    mockState.addressSelectionIdx = -1;
    let preventedDefault = false;
    await listeners.keydown({
        key: 'Enter',
        preventDefault: () => { preventedDefault = true; }
    });

    assert.equal(preventedDefault, true, 'Enter key must prevent default');
    assert.equal(focusedWebview, true, 'Navigation via Enter must refocus active webview');
    assert.equal(mockState.sessionState.workspaces['Workspace 1'][0], 'https://archlinux.org', 'Workspaces session must update with navigated URL');

    // Test B: Enter key selects active suggestion when suggestion index is active
    mockState.addressSelectionIdx = 0;
    mockState.addressSuggestions = [{ title: 'Mise Docs', value: 'https://mise.org', type: 'History' }];
    await listeners.keydown({
        key: 'Enter',
        preventDefault: () => {}
    });
    assert.equal(mockState.sessionState.workspaces['Workspace 1'][0], 'https://mise.org', 'Selecting suggestion must navigate to suggestion value');

    // Test C: Escape key dismisses address bar and restores focus
    focusedWebview = false;
    updatedStatusBar = false;
    let escapePrevented = false;
    await listeners.keydown({
        key: 'Escape',
        preventDefault: () => { escapePrevented = true; }
    });
    assert.equal(escapePrevented, true, 'Escape key must prevent default');
    assert.equal(focusedWebview, true, 'Escape key must refocus active webview');
    assert.equal(updatedStatusBar, true, 'Escape key must trigger status bar update');

    // Test D: Focus listener triggers text selection
    selectedText = false;
    listeners.focus();
    assert.equal(selectedText, true, 'Focusing address bar must select text');

    // Test E: Mouseup prevents deselecting text on initial focus click
    mockAddressBar.selectionStart = 0;
    mockAddressBar.selectionEnd = 10;
    let mouseupPrevented = false;
    listeners.mouseup({
        preventDefault: () => { mouseupPrevented = true; }
    });
    assert.equal(mouseupPrevented, true, 'Mouseup with existing selection must preserve highlight');

    console.log('✓ Functional WideAddressBar keydown, focus, blur, and navigation interactions verified');
}

runFunctionalTests().then(() => {
    console.log('All address bar navigation regression tests passed successfully!');
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
