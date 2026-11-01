// tests/command-palette-navigation.test.js
// Regression tests for Command Palette keyboard navigation, focus trap, and arrow selection

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('Running Mise Command Palette navigation & focus trap regression tests...');

// 1. Verify index.html markup for category chips and list tabindex
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

assert.ok(
    html.includes('id="CommandPaletteOverlay" tabindex="0"'),
    'CommandPaletteOverlay must have tabindex="0"'
);

assert.ok(
    html.includes('id="PaletteList" tabindex="0"'),
    'PaletteList must have tabindex="0"'
);

// Verify active chip has tabindex="0" and inactive chips have tabindex="-1" (roving tabindex)
const activeChipMatches = html.match(/class="palette-filter-chip active"[^>]*tabindex="0"/g) || [];
assert.equal(
    activeChipMatches.length,
    1,
    'Active palette category filter chip must have tabindex="0"'
);

const inactiveChipMatches = html.match(/class="palette-filter-chip"[^>]*tabindex="-1"/g) || [];
assert.equal(
    inactiveChipMatches.length,
    7,
    'All 7 inactive palette category filter chips must have tabindex="-1"'
);

console.log('✓ HTML markup for Command Palette overlay, list, and roving filter chips verified');

// 2. Set up mock DOM environment
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
        this.attributes = new Map();
        this.value = '';
        this.focused = false;
        this.offsetParent = {};
        this.listeners = {};
        this.children = [];
        this.innerHTML = '';
        this.scrollIntoViewCalled = false;
    }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.get(k) || null; }
    hasAttribute(k) { return this.attributes.has(k); }
    focus() {
        this.focused = true;
        mockDocument.activeElement = this;
    }
    contains(el) {
        return el !== null && el !== undefined;
    }
    addEventListener(name, fn) {
        if (!this.listeners[name]) this.listeners[name] = [];
        this.listeners[name].push(fn);
    }
    dispatchEvent(event) {
        const handlers = this.listeners[event.type] || [];
        for (const h of handlers) h(event);
    }
    scrollIntoView() {
        this.scrollIntoViewCalled = true;
    }
    querySelector() { return null; }
    querySelectorAll() { return []; }
}

const overlay = new MockElement('CommandPaletteOverlay', 'div');
const input = new MockElement('PaletteInput', 'input');
const list = new MockElement('PaletteList', 'ul');
const execBtn = new MockElement('PaletteInspectorExecuteBtn', 'button');
const closeBtn = new MockElement('ClosePaletteBtn', 'button');
const countBadge = new MockElement('PaletteMatchesCount', 'span');
const inspectorCard = new MockElement('PaletteInspectorCard', 'div');
const filterContainer = new MockElement('PaletteCategoryFilters', 'div');

const chipCategories = ['all', 'Tabs & Navigation', 'Workspaces & Dashboard', 'Split View', 'Performance & Memory', 'Tools & Notes', 'User Scripts & Styles', 'Preferences & System'];
const chips = chipCategories.map((cat, idx) => {
    const chip = new MockElement(`chip-${idx}`, 'button', { category: cat });
    if (idx === 0) chip.classList.add('active');
    return chip;
});

filterContainer.querySelectorAll = (sel) => {
    if (sel.includes('.palette-filter-chip')) return chips;
    return [];
};
filterContainer.querySelector = (sel) => {
    if (sel.includes('.palette-filter-chip.active')) return chips.find(c => c.classList.contains('active')) || null;
    return null;
};

const domElements = {
    CommandPaletteOverlay: overlay,
    PaletteInput: input,
    PaletteList: list,
    PaletteInspectorExecuteBtn: execBtn,
    ClosePaletteBtn: closeBtn,
    PaletteMatchesCount: countBadge,
    PaletteInspectorCard: inspectorCard,
    PaletteCategoryFilters: filterContainer
};

const mockDocument = {
    activeElement: input,
    getElementById: (id) => domElements[id] || null,
    querySelector: (sel) => {
        if (sel.includes('#PaletteCategoryFilters .palette-filter-chip.active')) {
            return chips.find(c => c.classList.contains('active')) || null;
        }
        return null;
    },
    querySelectorAll: (sel) => {
        if (sel.includes('.palette-filter-chip')) return chips;
        if (sel.includes('#PaletteList .palette-item')) return [];
        return [];
    },
    createElement: (tag) => new MockElement('', tag),
    readyState: 'complete',
    addEventListener: () => {}
};

// 3. Extract Command Palette functions from source
const jsSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/commandPalette.js'), 'utf8');

const focusablesFnStart = jsSource.indexOf('export function getCommandPaletteFocusableElements()');
const setupFnEnd = jsSource.indexOf('if (document.readyState ===', focusablesFnStart);
assert.ok(focusablesFnStart !== -1 && setupFnEnd !== -1, 'Command Palette functions must exist in commandPalette.js');

const codeToRun = jsSource.slice(focusablesFnStart, setupFnEnd).replace(/export /g, '');

const mockState = {
    paletteActive: true,
    paletteMatches: [
        { id: 'cmd-1', title: 'Command 1', desc: 'First command', category: 'Tabs & Navigation', icon: 'fa-plus' },
        { id: 'cmd-2', title: 'Command 2', desc: 'Second command', category: 'Tabs & Navigation', icon: 'fa-compass' },
        { id: 'cmd-3', title: 'Command 3', desc: 'Third command', category: 'Performance & Memory', icon: 'fa-bolt' }
    ],
    paletteSelectionIdx: 0
};

let executedAction = null;
let closedPaletteCalled = false;

const context = {
    document: mockDocument,
    window: {},
    state: mockState,
    isVisibleControl: (el) => Boolean(el && el.style?.display !== 'none'),
    updatePaletteVisualSelection: () => {},
    filterPaletteCommands: (txt) => { input.value = txt; },
    closeCommandPalette: () => { closedPaletteCalled = true; },
    recordRecentCommand: () => {},
    returnFocusToWebview: () => {},
    executeTerminalFallback: () => {},
    commandRegistry: {},
    Array
};

vm.createContext(context);
vm.runInContext(codeToRun, context);

// 4. Verify getCommandPaletteFocusableElements includes roving active chip
const focusables = context.getCommandPaletteFocusableElements();
assert.equal(focusables.length, 5, 'Focusables must contain input, activeChip, list, execBtn, closeBtn');
assert.equal(focusables[0], input, 'First focusable must be PaletteInput');
assert.equal(focusables[1], chips[0], 'Second focusable must be active category chip');
assert.equal(focusables[2], list, 'Third focusable must be PaletteList');
assert.equal(focusables[3], execBtn, 'Fourth focusable must be PaletteInspectorExecuteBtn');
assert.equal(focusables[4], closeBtn, 'Fifth focusable must be ClosePaletteBtn');

console.log('✓ getCommandPaletteFocusableElements includes roving active chip and interactive controls');

// 5. Verify Tab moves from PaletteInput to active category chip, then directly to list
mockDocument.activeElement = input;
const eventTabFromInput = {
    key: 'Tab',
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
};

context.handlePaletteInputNavigation(eventTabFromInput);
assert.equal(eventTabFromInput.defaultPrevented, true, 'Tab from PaletteInput must be handled');
assert.equal(mockDocument.activeElement, chips[0], 'Tab from input must land on the active category chip');

const eventTabFromChip = {
    key: 'Tab',
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
};
context.handlePaletteInputNavigation(eventTabFromChip);
assert.equal(eventTabFromChip.defaultPrevented, true, 'Tab from active chip must be handled');
assert.equal(mockDocument.activeElement, list, 'Tab from active chip must land directly on PaletteList');

console.log('✓ Tab key moves from input to active chip, then straight to PaletteList');

// 6. Verify focus trap continuous cycling back to top (Bug 2 fixed)
mockDocument.activeElement = list;
const eventTabFromList = {
    key: 'Tab',
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
};
context.handlePaletteInputNavigation(eventTabFromList);
assert.equal(mockDocument.activeElement, execBtn, 'Tab from list must move to PaletteInspectorExecuteBtn');

mockDocument.activeElement = execBtn;
const eventTabFromExec = {
    key: 'Tab',
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
};
context.handlePaletteInputNavigation(eventTabFromExec);
assert.equal(mockDocument.activeElement, closeBtn, 'Tab from execBtn must move to ClosePaletteBtn');

// Tab on Close button must cycle back to top (PaletteInput)
mockDocument.activeElement = closeBtn;
const eventTabFromClose = {
    key: 'Tab',
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
};
context.handlePaletteInputNavigation(eventTabFromClose);
assert.equal(mockDocument.activeElement, input, 'Tab on last element must cycle back to PaletteInput');

// Shift+Tab backwards cycling
mockDocument.activeElement = input;
const eventShiftTabFromInput = {
    key: 'Tab',
    shiftKey: true,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
};
context.handlePaletteInputNavigation(eventShiftTabFromInput);
assert.equal(mockDocument.activeElement, closeBtn, 'Shift+Tab from PaletteInput must cycle to ClosePaletteBtn');

mockDocument.activeElement = closeBtn;
const eventShiftTabFromClose = {
    key: 'Tab',
    shiftKey: true,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
};
context.handlePaletteInputNavigation(eventShiftTabFromClose);
assert.equal(mockDocument.activeElement, execBtn, 'Shift+Tab from ClosePaletteBtn must move to PaletteInspectorExecuteBtn');

console.log('✓ Tab navigation cycles continuously inside overlay without escaping to outer window');

// 7. Verify ArrowDown & ArrowUp work regardless of where Tab lands (Bug 3 fixed)
const testTargets = [
    { name: 'PaletteInput', el: input },
    { name: 'PaletteList', el: list },
    { name: 'PaletteInspectorExecuteBtn', el: execBtn },
    { name: 'ClosePaletteBtn', el: closeBtn },
    { name: 'CommandPaletteOverlay', el: overlay }
];

for (const target of testTargets) {
    mockDocument.activeElement = target.el;
    mockState.paletteSelectionIdx = 0;

    const eventDown = {
        key: 'ArrowDown',
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }
    };
    context.handlePaletteInputNavigation(eventDown);
    assert.equal(eventDown.defaultPrevented, true, `ArrowDown on ${target.name} must be handled`);
    assert.equal(mockState.paletteSelectionIdx, 1, `ArrowDown on ${target.name} must advance selection`);

    const eventUp = {
        key: 'ArrowUp',
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }
    };
    context.handlePaletteInputNavigation(eventUp);
    assert.equal(eventUp.defaultPrevented, true, `ArrowUp on ${target.name} must be handled`);
    assert.equal(mockState.paletteSelectionIdx, 0, `ArrowUp on ${target.name} must decrement selection`);
}

console.log('✓ Arrow keys navigate commands correctly regardless of focus position');

// 8. Verify category cycling with ArrowLeft and ArrowRight from PaletteList
mockDocument.activeElement = list;
const eventArrowRight = {
    key: 'ArrowRight',
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
};
context.handlePaletteInputNavigation(eventArrowRight);
assert.equal(eventArrowRight.defaultPrevented, true);
assert.equal(chips[1].classList.contains('active'), true, 'ArrowRight must advance active category chip');

const eventArrowLeft = {
    key: 'ArrowLeft',
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
};
context.handlePaletteInputNavigation(eventArrowLeft);
assert.equal(eventArrowLeft.defaultPrevented, true);
assert.equal(chips[0].classList.contains('active'), true, 'ArrowLeft must cycle back to initial category chip');

console.log('✓ Left and Right arrow keys cycle category filters when focusing PaletteList');

// 9. Verify Enter execution and Escape dismissal
mockDocument.activeElement = list;
mockState.paletteSelectionIdx = 0;
let actionExecuted = false;
mockState.paletteMatches[0].action = () => { actionExecuted = true; };
const eventEnter = {
    key: 'Enter',
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
};
context.handlePaletteInputNavigation(eventEnter);
assert.equal(eventEnter.defaultPrevented, true);
assert.equal(actionExecuted, true, 'Enter key must execute selection');

const eventEscape = {
    key: 'Escape',
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {}
};
context.handlePaletteInputNavigation(eventEscape);
assert.equal(closedPaletteCalled, true, 'Escape key must close command palette');

console.log('✓ Enter execution and Escape dismissal verified');

// 10. Verify command categories are cleanly grouped without duplicate or fragmented headers
const commandDefMatches = jsSource.matchAll(/id:\s*['"]([^'"]+)['"].*?category:\s*['"]([^'"]+)['"]/gs);
const validCategories = new Set([
    'Tabs & Navigation',
    'Workspaces & Dashboard',
    'Split View',
    'Performance & Memory',
    'Tools & Notes',
    'User Scripts & Styles',
    'Preferences & System',
    'Terminal'
]);

const seenCategoriesInOrder = [];
for (const match of commandDefMatches) {
    const [, cmdId, category] = match;
    assert.ok(validCategories.has(category), `Command ${cmdId} has invalid category: ${category}`);
    if (seenCategoriesInOrder.length === 0 || seenCategoriesInOrder[seenCategoriesInOrder.length - 1] !== category) {
        seenCategoriesInOrder.push(category);
    }
}

// Each valid category must appear at most once in the contiguous sequence
const uniqueCategories = new Set(seenCategoriesInOrder);
assert.equal(
    seenCategoriesInOrder.length,
    uniqueCategories.size,
    `Category sequence must not contain split or duplicated category blocks: ${seenCategoriesInOrder.join(', ')}`
);
console.log('✓ Command definitions form cleanly grouped contiguous categories without duplicate headers');

// 11. Verify CSS rules prevent container and column width jitter between category groups
const cpCss = fs.readFileSync(path.join(__dirname, '../styles/overlays/commandPalette.css'), 'utf8');
assert.match(cpCss, /\.palette-page\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*1220px;/, '.palette-page must enforce full width with max-width cap');
assert.match(cpCss, /\.palette-body\s*\{[^}]*width:\s*100%;/, '.palette-body must stretch full width across page container');
assert.match(cpCss, /\.palette-list-column\s*\{[^}]*flex:\s*1 1 0%;/, '.palette-list-column must use zero flex-basis to avoid text width shifts');
assert.match(cpCss, /\.palette-inspector-column\s*\{[^}]*flex:\s*0 0 420px;/, '.palette-inspector-column must maintain stable width across category views');
console.log('✓ CSS layout rules enforce rock-solid width stability across all category groups');

console.log('All Command Palette navigation & focus trap regression tests passed successfully!');
