// tests/notes-keyboard-navigation.test.js
// Verification for Notes overlay keyboard navigation, focus trap, and webview isolation

const assert = require('assert');

console.log('Running Mise Notes overlay keyboard navigation regression tests...');

class MockElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
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
        this.scrolledBy = [];
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
    contains() { return false; }
    scrollBy(options) {
        this.scrolledBy.push(options);
    }
    setSelectionRange() {}
    scrollTo() {}
    setAttribute() {}
    getAttribute() { return null; }
    appendChild(child) { this.children.push(child); }
    querySelectorAll(selector) {
        if (selector === 'webview') return this.children;
        if (selector === 'a') return this.children.filter(c => c.tagName === 'A');
        return [];
    }
    querySelector() { return null; }
}

const notesOverlay = new MockElement('NotesOverlay');
const notesTextArea = new MockElement('NotesTextArea', 'textarea');
const notesMarkdownView = new MockElement('NotesMarkdownView');
const toggleEditNotesBtn = new MockElement('ToggleEditNotesBtn', 'button');
const toggleExpandNotesBtn = new MockElement('ToggleExpandNotesBtn', 'button');
const openExternalNotesBtn = new MockElement('OpenExternalNotesBtn', 'button');
const closeNotesBtn = new MockElement('CloseNotesBtn', 'button');
const webviewContainer = new MockElement('webview-container');
const webview1 = new MockElement('wv1', 'webview');
const webview2 = new MockElement('wv2', 'webview');
webviewContainer.children = [webview1, webview2];

const elements = {
    'NotesOverlay': notesOverlay,
    'NotesTextArea': notesTextArea,
    'NotesMarkdownView': notesMarkdownView,
    'ToggleEditNotesBtn': toggleEditNotesBtn,
    'ToggleExpandNotesBtn': toggleExpandNotesBtn,
    'OpenExternalNotesBtn': openExternalNotesBtn,
    'CloseNotesBtn': closeNotesBtn,
    'NotesWordCount': new MockElement('NotesWordCount', 'span'),
    'NotesContent': new MockElement('NotesContent'),
    'webview-container': webviewContainer,
    'TabList': new MockElement('TabList'),
    'Sidebar': new MockElement('Sidebar'),
    'WideAddressBar': new MockElement('WideAddressBar')
};

global.document = {
    activeElement: null,
    createElement: (tag) => new MockElement('', tag),
    getElementById: (id) => elements[id] || null,
    querySelector: (sel) => {
        if (sel === '#TabList li.selected') return new MockElement('selected-tab', 'li');
        return null;
    },
    querySelectorAll: (sel) => {
        if (sel === '#TabList li') return [new MockElement('tab-0', 'li')];
        return [];
    }
};

global.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    miseAPI: {
        readNotes: async () => '# Test Notes\nHello world',
        saveNotes: async () => {},
        saveSession: () => {},
        getWebviewPreloadPath: () => '/fake/preload.js'
    }
};

const { state } = require('../modules/state.js');
const {
    toggleNotesOverlay,
    handleNotesGlobalKeyDown,
    renderNotesView
} = require('../modules/overlays/notes.js');

// 1. Verify webviews are hidden and overlay is displayed on open
{
    webview1.style.display = 'flex';
    webview2.style.display = 'flex';
    state.notesActive = false;
    state.isEditingNotes = false;

    toggleNotesOverlay();

    assert.strictEqual(state.notesActive, true, 'notesActive must be true after toggle');
    assert.strictEqual(notesOverlay.style.display, 'flex', 'NotesOverlay display must be flex immediately');
    assert.strictEqual(webview1.style.display, 'none', 'Underlying webview1 must be hidden');
    assert.strictEqual(webview2.style.display, 'none', 'Underlying webview2 must be hidden');
    assert.strictEqual(global.document.activeElement, notesMarkdownView, 'Markdown view must be focused on open in preview mode');

    console.log('✓ Webviews safely hidden and Notes overlay focused on open');
}

// 2. Verify cyclic Tab focus trap in preview mode
{
    state.notesActive = true;
    state.isEditingNotes = false;

    // Start at NotesMarkdownView
    global.document.activeElement = notesMarkdownView;
    const tabEvent = {
        key: 'Tab',
        shiftKey: false,
        preventDefault: () => {},
        stopPropagation: () => {}
    };

    handleNotesGlobalKeyDown(tabEvent);
    assert.strictEqual(global.document.activeElement, toggleEditNotesBtn, 'Tab from markdown view must focus Edit button');

    handleNotesGlobalKeyDown(tabEvent);
    assert.strictEqual(global.document.activeElement, toggleExpandNotesBtn, 'Tab from Edit button must focus Expand button');

    handleNotesGlobalKeyDown(tabEvent);
    assert.strictEqual(global.document.activeElement, openExternalNotesBtn, 'Tab from Expand button must focus External button');

    handleNotesGlobalKeyDown(tabEvent);
    assert.strictEqual(global.document.activeElement, closeNotesBtn, 'Tab from External button must focus Close button');

    handleNotesGlobalKeyDown(tabEvent);
    assert.strictEqual(global.document.activeElement, notesMarkdownView, 'Tab from Close button must wrap back to Markdown view');

    console.log('✓ Forward Tab focus trap cycles through all controls without leaking focus');
}

// 3. Verify cyclic Shift+Tab focus trap
{
    state.notesActive = true;
    state.isEditingNotes = false;

    global.document.activeElement = notesMarkdownView;
    const shiftTabEvent = {
        key: 'Tab',
        shiftKey: true,
        preventDefault: () => {},
        stopPropagation: () => {}
    };

    handleNotesGlobalKeyDown(shiftTabEvent);
    assert.strictEqual(global.document.activeElement, closeNotesBtn, 'Shift+Tab from markdown view must wrap to Close button');

    handleNotesGlobalKeyDown(shiftTabEvent);
    assert.strictEqual(global.document.activeElement, openExternalNotesBtn, 'Shift+Tab from Close button must focus External button');

    console.log('✓ Shift+Tab backward focus trap cycles smoothly');
}

// 4. Verify Enter key behaviour on buttons vs content pane
{
    state.notesActive = true;
    state.isEditingNotes = false;

    // When focus is on a button, Enter should not force edit mode
    global.document.activeElement = toggleExpandNotesBtn;
    let enterDefaultPrevented = false;
    const enterOnButton = {
        key: 'Enter',
        preventDefault: () => { enterDefaultPrevented = true; },
        stopPropagation: () => {}
    };

    handleNotesGlobalKeyDown(enterOnButton);
    assert.strictEqual(enterDefaultPrevented, false, 'Enter on button must not be prevented');
    assert.strictEqual(state.isEditingNotes, false, 'Enter on button must not switch to edit mode');

    // When focus is on markdown view, Enter should switch to edit mode
    global.document.activeElement = notesMarkdownView;
    const enterOnView = {
        key: 'Enter',
        preventDefault: () => {},
        stopPropagation: () => {}
    };

    handleNotesGlobalKeyDown(enterOnView);
    assert.strictEqual(state.isEditingNotes, true, 'Enter on markdown view must enter edit mode');

    console.log('✓ Enter key preserves native button activation and switches edit mode on content');
}

// 5. Verify Escape dismissal and tab restoration
{
    state.notesActive = true;
    const escapeEvent = {
        key: 'Escape',
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {}
    };

    handleNotesGlobalKeyDown(escapeEvent);
    assert.strictEqual(state.notesActive, false, 'Escape must toggle notesActive to false');
    assert.strictEqual(notesOverlay.style.display, 'none', 'Notes overlay must be hidden on Escape');

    console.log('✓ Escape dismissal safely restores overlay state');
}

console.log('All Notes overlay keyboard navigation regression tests passed successfully!');
