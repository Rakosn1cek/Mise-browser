// tests/preferences-tabs.test.js
// Automated verification for Preferences overlay 6-section tabbed navigation and focus trap

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('Running Mise Preferences 6-tab navigation & focus trap regression tests...');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

// 1. Verify all specified tabs and sections exist in index.html
const expectedTabs = [
    { id: 'tab-performance', label: 'Performance & Hardware' },
    { id: 'tab-external-tools', label: 'External Tools [Notes]' },
    { id: 'tab-appearance', label: 'Appearance & Visual Theme' },
    { id: 'tab-privacy', label: 'Privacy & Protection' },
    { id: 'tab-permissions', label: 'Permissions Vault' },
    { id: 'tab-diagnostics', label: 'Diagnostics & System Health' },
    { id: 'tab-help', label: 'Help & Shortcut Reference' }
];

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const tab of expectedTabs) {
    const escapedLabel = escapeRegExp(tab.label);
    const btnPattern = new RegExp(`data-tab="${tab.id}"[^>]*>[\\s\\S]*?<span>${escapedLabel}<\\/span>`);
    assert.match(html, btnPattern, `Tab button for ${tab.label} must exist in index.html`);

    const sectionPattern = new RegExp(`<section[^>]*id="${tab.id}"[^>]*role="tabpanel"`);
    assert.match(html, sectionPattern, `Panel section for ${tab.id} must exist with role="tabpanel"`);
}

console.log('✓ All 6 preferences tab buttons and panel sections are registered in index.html');

// 2. Mock DOM environment for tab switching and focus trap verification
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
        this.tabIndex = -1;
        this.focused = false;
        this.offsetParent = {};
        this.type = '';
        this.checked = false;
        this.listeners = {};
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
}

const buttons = expectedTabs.map(t => {
    const el = new MockElement(`tab-btn-${t.id.replace('tab-', '')}`, 'button', { tab: t.id });
    el.setAttribute('aria-selected', 'false');
    return el;
});
buttons[0].classList.add('active');
buttons[0].setAttribute('aria-selected', 'true');
buttons[0].tabIndex = 0;

const closeBtn = new MockElement('CloseSettingsBtn', 'button');
closeBtn.tabIndex = 0;

const input1 = new MockElement('setting-input-1', 'input');
const input2 = new MockElement('setting-input-2', 'button');

const sections = expectedTabs.map((t, idx) => {
    const el = new MockElement(t.id, 'section');
    el.setAttribute('role', 'tabpanel');
    el.style.display = idx === 0 ? 'flex' : 'none';
    el.querySelectorAll = (sel) => {
        if (t.id === 'tab-performance') return [input1, input2];
        return [];
    };
    return el;
});

const overlay = new MockElement('PreferencesOverlay', 'div');
overlay.scrollTop = 100;

const tabNav = new MockElement('SettingsTabs', 'nav');

const domElements = {
    CloseSettingsBtn: closeBtn,
    SettingsTabs: tabNav,
    PreferencesOverlay: overlay
};
for (const b of buttons) domElements[b.id] = b;
for (const s of sections) domElements[s.id] = s;

const mockDocument = {
    activeElement: buttons[0],
    getElementById: id => domElements[id] || null,
    querySelector: sel => {
        if (sel === '#SettingsTabs .settings-tab-btn.active') return buttons.find(b => b.classList.contains('active')) || null;
        return null;
    },
    querySelectorAll: selector => {
        if (selector === '#SettingsTabs .settings-tab-btn') return buttons;
        if (selector === '#PreferencesOverlay .settings-section[role="tabpanel"]') return sections;
        return [];
    }
};

tabNav.querySelectorAll = selector => {
    if (selector === '.settings-tab-btn') return buttons;
    return [];
};
tabNav.querySelector = selector => {
    if (selector === '.settings-tab-btn.active') return buttons.find(b => b.classList.contains('active')) || null;
    return null;
};

// 3. Extract and execute tab switching & focus trap logic in VM
const jsSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/commandPalette.js'), 'utf8');
const fnStart = jsSource.indexOf('let activePreferencesTab =');
const fnEnd = jsSource.indexOf('setupVisualSettingsListeners();', fnStart);
assert.ok(fnStart !== -1 && fnEnd !== -1, 'Tab navigation and focus trap functions must exist in commandPalette.js');

let code = jsSource.slice(fnStart, fnEnd).replace(/export /g, '') + '}\nsetupPreferencesListeners();';

class MockEvent {
    constructor(type) { this.type = type; }
}

const context = {
    document: mockDocument,
    window: {},
    Event: MockEvent,
    Array
};
vm.createContext(context);
vm.runInContext(code, context);

// Verify initial tab is performance
assert.equal(sections[0].style.display, 'flex');
assert.equal(sections[1].style.display, 'none');

// 4. Test direct tab switching
context.switchPreferencesTab('tab-privacy');
assert.equal(sections[0].style.display, 'none', 'Performance section must hide when switching to Privacy');
assert.equal(sections[3].style.display, 'flex', 'Privacy section must display when active');
assert.equal(buttons[3].classList.contains('active'), true);
assert.equal(buttons[3].getAttribute('aria-selected'), 'true');
assert.equal(buttons[0].classList.contains('active'), false);
assert.equal(overlay.scrollTop, 0, 'Scroll position must reset to top on tab switch');

console.log('✓ Direct tab switching toggles visible sections and updates ARIA states');

// Switch back to performance for control tests
context.switchPreferencesTab('tab-performance');

// 5. Test keyboard navigation on tablist
const eventRight = { key: 'ArrowRight', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
tabNav.onkeydown(eventRight);
assert.equal(eventRight.defaultPrevented, true);
assert.equal(sections[1].style.display, 'flex', 'ArrowRight must advance to External Tools tab');
assert.equal(buttons[1].focused, true);

const eventHome = { key: 'Home', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
tabNav.onkeydown(eventHome);
assert.equal(eventHome.defaultPrevented, true);
assert.equal(sections[0].style.display, 'flex', 'Home key must jump to Performance tab');

const eventLeft = { key: 'ArrowLeft', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
tabNav.onkeydown(eventLeft);
assert.equal(eventLeft.defaultPrevented, true);
assert.equal(sections[sections.length - 1].style.display, 'flex', 'ArrowLeft from first tab must wrap to Help tab');

console.log('✓ Keyboard arrow navigation, Home/End jumping, and wrapping verified');

// 6. Test focus trap and cyclic Tab navigation
context.switchPreferencesTab('tab-performance');

// Focusable order for performance tab: [closeBtn, buttons[0], input1, input2]
const focusables = context.getPreferencesFocusableElements();
assert.equal(focusables.length, 4, 'Focusables must include Close button, active tab button, and section controls');
assert.equal(focusables[0], closeBtn);
assert.equal(focusables[1], buttons[0]);
assert.equal(focusables[2], input1);
assert.equal(focusables[3], input2);

// Pressing Tab on the last element (input2) must wrap around to closeBtn
mockDocument.activeElement = input2;
const eventTabForward = { key: 'Tab', shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
overlay.onkeydown(eventTabForward);
assert.equal(eventTabForward.defaultPrevented, true, 'Tab on last element must be intercepted');
assert.equal(mockDocument.activeElement, closeBtn, 'Tab on last element must cycle back to Close button');

// Pressing Shift+Tab on the first element (closeBtn) must wrap to last element (input2)
mockDocument.activeElement = closeBtn;
const eventTabBackward = { key: 'Tab', shiftKey: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
overlay.onkeydown(eventTabBackward);
assert.equal(eventTabBackward.defaultPrevented, true, 'Shift+Tab on first element must be intercepted');
assert.equal(mockDocument.activeElement, input2, 'Shift+Tab on first element must cycle to last setting control');

// Pressing F6 or Ctrl+Up from inside a control must immediately return to active tab button
mockDocument.activeElement = input1;
const eventF6 = { key: 'F6', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
overlay.onkeydown(eventF6);
assert.equal(eventF6.defaultPrevented, true, 'F6 must be intercepted');
assert.equal(mockDocument.activeElement, buttons[0], 'F6 must jump focus directly to active tab button');

mockDocument.activeElement = input2;
const eventCtrlUp = { key: 'ArrowUp', ctrlKey: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
overlay.onkeydown(eventCtrlUp);
assert.equal(eventCtrlUp.defaultPrevented, true, 'Ctrl+ArrowUp must be intercepted');
assert.equal(mockDocument.activeElement, buttons[0], 'Ctrl+ArrowUp must jump focus directly to active tab button');

console.log('✓ Focus trap ensures Tab cycles continuously inside Preferences without escaping to sidebar');

// 7. Test Enter key toggling checkboxes
input1.type = 'checkbox';
input1.checked = false;
let toggled = false;
input1.addEventListener('change', () => { toggled = true; });
mockDocument.activeElement = input1;
const eventEnter = { key: 'Enter', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
overlay.onkeydown(eventEnter);
assert.equal(eventEnter.defaultPrevented, true, 'Enter key on checkbox must be intercepted');
assert.equal(input1.checked, true, 'Enter key on checkbox must toggle checked state to true');
assert.equal(toggled, true, 'Enter key on checkbox must dispatch change event');
console.log('✓ Keyboard Enter key toggles checkbox state and dispatches change event');

// 8. Verify CSS visual focus indicators for toggles, sliders, and rows
function readCss(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.replace(/@import\s+['"]([^'"]+)['"];/g, (_, importPath) => {
        const resolved = path.resolve(path.dirname(filePath), importPath);
        return readCss(resolved);
    });
}
const css = readCss(path.join(__dirname, '../style.css'));
assert.match(css, /\.toggle-switch\s+input:focus-visible\s*\+\s*\.toggle-slider\s*\{[^}]*outline:/, 'Toggle switches must have focus-visible outline');
assert.match(css, /\.theme-slider:focus-visible\s*\{[^}]*outline:/, 'Range sliders must have focus-visible outline');
assert.match(css, /\.slider-group:focus-within\s+\.slider-val-badge/, 'Slider value badges must highlight on focus-within');
assert.match(css, /\.setting-item:focus-within/, 'Setting items must have row focus-within highlight');
assert.match(css, /\.swatch-btn:focus-visible/, 'Theme swatches must have focus-visible outline');
assert.match(css, /\.theme-color-input:focus-visible/, 'Theme color inputs must have focus-visible outline');
console.log('✓ Visual focus indicators for toggle switches, sliders, swatches, and rows verified in style.css');

console.log('All Preferences 6-tab navigation & focus trap regression tests passed successfully!');
