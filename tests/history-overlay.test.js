// tests/history-overlay.test.js
// Automated verification for History overlay keyboard navigation, Escape dismissal, and focus trapping

const assert = require('assert');

console.log('Running Mise History overlay keyboard accessibility regression tests...');

// Mock DOM elements and document structure
class MockElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName;
        this.style = {};
        this.classList = {
            classes: new Set(),
            add: (c) => this.classList.classes.add(c),
            remove: (c) => this.classList.classes.delete(c),
            contains: (c) => this.classList.classes.has(c)
        };
        this.children = [];
        this.innerHTML = '';
        this.value = '';
        this._listeners = {};
    }
    addEventListener(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    }
    removeEventListener(event, fn) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(cb => cb !== fn);
    }
    focus() {
        global.document.activeElement = this;
    }
    scrollIntoView() {}
    setAttribute() {}
    getAttribute() { return null; }
    appendChild(child) { this.children.push(child); }
    querySelectorAll() { return this.children; }
    querySelector() { return null; }
}

const historyOverlay = new MockElement('HistoryOverlay');
const historySearchInput = new MockElement('HistorySearchInput', 'input');
const purgeHistoryBtn = new MockElement('PurgeHistoryBtn', 'button');
const closeHistoryBtn = new MockElement('CloseHistoryBtn', 'button');
const historyResultsList = new MockElement('HistoryResultsList');

const elements = {
    'HistoryOverlay': historyOverlay,
    'HistorySearchInput': historySearchInput,
    'PurgeHistoryBtn': purgeHistoryBtn,
    'CloseHistoryBtn': closeHistoryBtn,
    'HistoryResultsList': historyResultsList,
    'WorkspaceLabel': new MockElement('WorkspaceLabel'),
    'WorkspaceBadge': new MockElement('WorkspaceBadge'),
    'WorkspaceHeader': new MockElement('WorkspaceHeader'),
    'TabList': new MockElement('TabList'),
    'webview-container': new MockElement('webview-container')
};

global.document = {
    readyState: 'complete',
    getElementById: (id) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => new MockElement('', tag),
    addEventListener: () => {},
    removeEventListener: () => {},
    activeElement: historySearchInput
};

global.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    miseAPI: {
        searchHistory: async () => [],
        saveSession: () => {},
        getWebviewPreloadPath: () => '/fake/preload.js'
    }
};

const historyModule = require('../modules/overlays/history.js');
const { state } = require('../modules/state.js');

// 1. Verify instant Escape dismissal when overlay is active
{
    state.historyActive = true;
    historyOverlay.style.display = 'flex';

    let defaultPrevented = false;
    let propagationStopped = false;
    const escapeEvent = {
        key: 'Escape',
        preventDefault: () => { defaultPrevented = true; },
        stopPropagation: () => { propagationStopped = true; }
    };

    historyModule.handleHistoryKeyDown(escapeEvent);
    assert.strictEqual(defaultPrevented, true, 'Escape must invoke preventDefault');
    assert.strictEqual(propagationStopped, true, 'Escape must invoke stopPropagation');
    assert.strictEqual(state.historyActive, false, 'Escape must toggle historyActive to false');
    assert.strictEqual(historyOverlay.style.display, 'none', 'Escape must hide HistoryOverlay');

    console.log('✓ Instant Escape dismissal closes History overlay cleanly');
}

// 2. Verify Escape key ignored when overlay is inactive
{
    state.historyActive = false;
    let defaultPrevented = false;
    let propagationStopped = false;
    const escapeEvent = {
        key: 'Escape',
        preventDefault: () => { defaultPrevented = true; },
        stopPropagation: () => { propagationStopped = true; }
    };

    historyModule.handleHistoryKeyDown(escapeEvent);
    assert.strictEqual(defaultPrevented, false, 'Inactive overlay must not preventDefault on Escape');
    assert.strictEqual(propagationStopped, false, 'Inactive overlay must not stopPropagation on Escape');
    assert.strictEqual(state.historyActive, false, 'historyActive must remain false');

    console.log('✓ Escape key gracefully ignored when History overlay is inactive');
}

// 3. Verify ArrowDown and ArrowUp keyboard navigation with cyclic wrapping
{
    const item0 = new MockElement();
    const item1 = new MockElement();
    const item2 = new MockElement();
    historyResultsList.children = [item0, item1, item2];

    state.historyActive = true;
    state.historyResults = [
        { title: 'Alpha Documentation', url: 'https://alpha.example.org' },
        { title: 'Beta Portal', url: 'https://beta.example.org' },
        { title: 'Gamma Repository', url: 'https://gamma.example.org' }
    ];
    state.historySelectionIdx = 0;
    historyModule.updateHistoryVisualSelection();
    assert.strictEqual(item0.classList.contains('selected'), true, 'Initial item must be marked selected');

    // ArrowDown step 1
    const downEvent1 = { key: 'ArrowDown', preventDefault: () => {}, stopPropagation: () => {} };
    historyModule.handleHistoryKeyDown(downEvent1);
    assert.strictEqual(state.historySelectionIdx, 1, 'ArrowDown must advance selection to index 1');
    assert.strictEqual(item1.classList.contains('selected'), true, 'Second item must be marked selected');
    assert.strictEqual(item0.classList.contains('selected'), false, 'First item must lose selected state');

    // ArrowDown step 2
    const downEvent2 = { key: 'ArrowDown', preventDefault: () => {}, stopPropagation: () => {} };
    historyModule.handleHistoryKeyDown(downEvent2);
    assert.strictEqual(state.historySelectionIdx, 2, 'ArrowDown must advance selection to index 2');
    assert.strictEqual(item2.classList.contains('selected'), true, 'Third item must be marked selected');

    // ArrowDown step 3 (cyclic wrap to start)
    const downEvent3 = { key: 'ArrowDown', preventDefault: () => {}, stopPropagation: () => {} };
    historyModule.handleHistoryKeyDown(downEvent3);
    assert.strictEqual(state.historySelectionIdx, 0, 'ArrowDown past list boundary must wrap to index 0');
    assert.strictEqual(item0.classList.contains('selected'), true, 'First item must regain selected state');

    // ArrowUp step 1 (cyclic wrap to end)
    const upEvent1 = { key: 'ArrowUp', preventDefault: () => {}, stopPropagation: () => {} };
    historyModule.handleHistoryKeyDown(upEvent1);
    assert.strictEqual(state.historySelectionIdx, 2, 'ArrowUp at beginning must wrap to index 2');
    assert.strictEqual(item2.classList.contains('selected'), true, 'Third item must be marked selected');

    // ArrowUp step 2
    const upEvent2 = { key: 'ArrowUp', preventDefault: () => {}, stopPropagation: () => {} };
    historyModule.handleHistoryKeyDown(upEvent2);
    assert.strictEqual(state.historySelectionIdx, 1, 'ArrowUp must move selection up to index 1');
    assert.strictEqual(item1.classList.contains('selected'), true, 'Second item must be marked selected');

    console.log('✓ ArrowDown and ArrowUp navigation with boundary wrap verified');
}

// 4. Verify Enter key activates selected item and spawns tab
{
    state.historyActive = true;
    historyOverlay.style.display = 'flex';
    state.historyResults = [
        { title: 'Alpha Documentation', url: 'https://alpha.example.org' },
        { title: 'Beta Portal', url: 'https://beta.example.org' }
    ];
    state.historySelectionIdx = 1;

    let defaultPrevented = false;
    let propagationStopped = false;
    const enterEvent = {
        key: 'Enter',
        preventDefault: () => { defaultPrevented = true; },
        stopPropagation: () => { propagationStopped = true; }
    };

    historyModule.handleHistoryKeyDown(enterEvent);
    assert.strictEqual(defaultPrevented, true, 'Enter must call preventDefault');
    assert.strictEqual(propagationStopped, true, 'Enter must call stopPropagation');
    assert.strictEqual(state.historyActive, false, 'Enter must close History overlay');
    assert.strictEqual(historyOverlay.style.display, 'none', 'HistoryOverlay display must be set to none');

    const currentWS = state.sessionState.current_workspace;
    const workspaceTabs = state.sessionState.workspaces[currentWS];
    assert.strictEqual(
        workspaceTabs[workspaceTabs.length - 1],
        'https://beta.example.org',
        'Selected history URL must be appended to current workspace tabs'
    );

    console.log('✓ Enter key activates selected history entry and dismisses overlay');
}

// 5. Verify Tab key focus trap cycling between interactive controls
{
    state.historyActive = true;

    // Focus on CloseHistoryBtn (the final focusable element in header)
    global.document.activeElement = closeHistoryBtn;
    let tabPrevented = false;
    const tabForwardEvent = {
        key: 'Tab',
        shiftKey: false,
        preventDefault: () => { tabPrevented = true; }
    };

    historyModule.handleHistoryKeyDown(tabForwardEvent);
    assert.strictEqual(tabPrevented, true, 'Forward Tab from final control must prevent default');
    assert.strictEqual(
        global.document.activeElement,
        historySearchInput,
        'Forward Tab from final control must cycle focus to search input'
    );

    // Focus on HistorySearchInput (the first focusable element)
    global.document.activeElement = historySearchInput;
    let shiftTabPrevented = false;
    const tabBackwardEvent = {
        key: 'Tab',
        shiftKey: true,
        preventDefault: () => { shiftTabPrevented = true; }
    };

    historyModule.handleHistoryKeyDown(tabBackwardEvent);
    assert.strictEqual(shiftTabPrevented, true, 'Shift+Tab from first control must prevent default');
    assert.strictEqual(
        global.document.activeElement,
        closeHistoryBtn,
        'Shift+Tab from first control must cycle focus to close button'
    );

    console.log('✓ Tab and Shift+Tab focus trap between controls verified');
}

// 6. Verify mutual exclusivity on toggleHistoryOverlay
{
    let paletteToggled = false;
    let bookmarksToggled = false;
    let notesToggled = false;
    let preferencesToggled = false;
    let dashboardToggled = false;

    global.window.toggleCommandPaletteView = () => { paletteToggled = true; };
    global.window.toggleBookmarksOverlay = () => { bookmarksToggled = true; };
    global.window.toggleNotesOverlay = () => { notesToggled = true; };
    global.window.togglePreferencesView = () => { preferencesToggled = true; };
    global.window.toggleDashboardView = () => { dashboardToggled = true; };

    state.paletteActive = true;
    state.bookmarksActive = true;
    state.notesActive = true;
    state.preferencesActive = true;
    state.dashboardActive = true;
    state.historyActive = false;

    historyModule.toggleHistoryOverlay();

    assert.strictEqual(state.historyActive, true, 'History overlay must be active');
    assert.strictEqual(paletteToggled, true, 'Command palette must be closed');
    assert.strictEqual(bookmarksToggled, true, 'Bookmarks overlay must be closed');
    assert.strictEqual(notesToggled, true, 'Notes overlay must be closed');
    assert.strictEqual(preferencesToggled, true, 'Preferences view must be closed');
    assert.strictEqual(dashboardToggled, true, 'Dashboard view must be closed');
    assert.strictEqual(state.historySelectionIdx, 0, 'Selection index must reset to 0');

    // Clean up
    historyModule.toggleHistoryOverlay();
    assert.strictEqual(state.historyActive, false, 'History overlay must toggle off');

    console.log('✓ Mutual exclusivity and overlay initialisation verified');
}

console.log('\nAll History overlay keyboard accessibility tests passed successfully!');
