// tests/link-hints.test.js
// Regression tests for the 'f' link-hints pipeline: engine installation, hint code
// generation, keystroke filtering, and the HINTS mode indicator wiring.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('Running Mise link hints (f) regression tests...');

// ---------------------------------------------------------------------------
// Minimal DOM implementation: enough of the platform for hinter.js to run
// ---------------------------------------------------------------------------

function matchesSimple(el, selector) {
    const cleaned = selector.replace(/:not\([^)]*\)/g, '').trim();
    const parsed = cleaned.match(/^([a-zA-Z0-9-]+)?((?:\[[^\]]*\])*)$/);
    if (!parsed) return false;
    const tag = parsed[1];
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    const attrChunks = parsed[2] ? parsed[2].match(/\[[^\]]*\]/g) || [] : [];
    for (const chunk of attrChunks) {
        const body = chunk.slice(1, -1);
        const kv = body.match(/^([a-zA-Z0-9_:-]+)(?:=["']?([^"']*)["']?)?$/);
        if (!kv) return false;
        const name = kv[1];
        const value = kv[2];
        if (!Object.prototype.hasOwnProperty.call(el.attrs, name)) return false;
        if (value !== undefined && el.attrs[name] !== value) return false;
    }
    return true;
}

class FakeElement {
    constructor(tag) {
        this.nodeType = 1;
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.attrs = {};
        this.dataset = {};
        this.style = {};
        this.textContent = '';
        this.href = '';
        this.clickCount = 0;
        this.focusCount = 0;
        this.classList = { add() {}, remove() {}, contains: () => false };
        this.rect = { left: 10, top: 10, width: 20, height: 20, right: 30, bottom: 30 };
        this.shadowRoot = null;
    }

    get firstElementChild() {
        return this.children.length ? this.children[0] : null;
    }

    get nextElementSibling() {
        if (!this.parentNode) return null;
        const siblings = this.parentNode.children;
        const idx = siblings.indexOf(this);
        return idx >= 0 ? siblings[idx + 1] || null : null;
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    remove() {
        if (!this.parentNode) return;
        const idx = this.parentNode.children.indexOf(this);
        if (idx >= 0) this.parentNode.children.splice(idx, 1);
        this.parentNode = null;
    }

    setAttribute(name, value) {
        this.attrs[name] = String(value);
    }

    getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    }

    matches(selector) {
        return String(selector).split(',').some((part) => matchesSimple(this, part.trim()));
    }

    closest(selector) {
        let node = this;
        while (node && node.nodeType === 1) {
            if (node.matches(selector)) return node;
            node = node.parentNode;
        }
        return null;
    }

    getBoundingClientRect() {
        return this.rect;
    }

    click() {
        this.clickCount += 1;
    }

    focus() {
        this.focusCount += 1;
    }

    dispatchEvent() {
        return true;
    }
}

function createFakeDom() {
    const documentListeners = { keydown: [] };
    const windowListeners = { resize: [], scroll: [] };
    const dispatched = [];

    const documentElement = new FakeElement('html');
    const body = new FakeElement('body');
    documentElement.appendChild(body);

    function findById(node, id) {
        if (node.nodeType === 1) {
            if (node.attrs.id === id || node.id === id) return node;
            if (node.shadowRoot) {
                const hit = findById(node.shadowRoot, id);
                if (hit) return hit;
            }
        }
        for (const child of node.children || []) {
            const hit = findById(child, id);
            if (hit) return hit;
        }
        return null;
    }

    const document = {
        nodeType: 9,
        documentElement,
        body,
        activeElement: null,
        get firstElementChild() {
            return documentElement;
        },
        createElement: (tag) => new FakeElement(tag),
        getElementById: (id) => findById(documentElement, id),
        addEventListener(type, fn) {
            (documentListeners[type] = documentListeners[type] || []).push(fn);
        },
        removeEventListener(type, fn) {
            const list = documentListeners[type] || [];
            const idx = list.indexOf(fn);
            if (idx >= 0) list.splice(idx, 1);
        }
    };

    const window = {
        innerWidth: 1200,
        innerHeight: 800,
        document,
        getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }),
        getSelection: () => null,
        addEventListener(type, fn) {
            (windowListeners[type] = windowListeners[type] || []).push(fn);
        },
        removeEventListener(type, fn) {
            const list = windowListeners[type] || [];
            const idx = list.indexOf(fn);
            if (idx >= 0) list.splice(idx, 1);
        },
        dispatchEvent(event) {
            dispatched.push(event);
            return true;
        }
    };

    class FakeCustomEvent {
        constructor(type, init) {
            this.type = type;
            this.detail = init && init.detail;
        }
    }

    class FakeMouseEvent {
        constructor(type, init) {
            this.type = type;
            this.detail = init;
        }
    }

    const context = {
        document,
        window,
        CustomEvent: FakeCustomEvent,
        MouseEvent: FakeMouseEvent,
        navigator: { clipboard: { writeText: () => Promise.resolve() } },
        console
    };
    window.window = window;
    context.globalThis = context;

    function pressKey(key) {
        const event = {
            key,
            prevented: false,
            stopped: false,
            preventDefault() { this.prevented = true; },
            stopPropagation() { this.stopped = true; },
            stopImmediatePropagation() { this.stopped = true; }
        };
        for (const fn of [...documentListeners.keydown]) fn(event);
        return event;
    }

    function makeTarget({ left = 10, top = 10, width = 20, height = 20, tag = 'a', href = '' } = {}) {
        const el = new FakeElement(tag);
        el.rect = { left, top, width, height, right: left + width, bottom: top + height };
        el.href = href;
        el.attrs.href = href;
        return el;
    }

    return { document, window, context, dispatched, pressKey, makeTarget, documentListeners };
}

function loadHinter(dom) {
    const source = fs.readFileSync(path.join(__dirname, '../hinter.js'), 'utf8');
    vm.runInNewContext(source, dom.context, { filename: 'hinter.js' });
    return dom.window.toggleHints;
}

// ---------------------------------------------------------------------------
// 1. hinter.js behaviour: return codes, codes, filtering, dismissal
// ---------------------------------------------------------------------------
{
    const dom = createFakeDom();
    const toggleHints = loadHinter(dom);

    assert.equal(typeof toggleHints, 'function', 'hinter.js must expose window.toggleHints');

    // No interactive targets at all: nothing is painted, and the caller is told so.
    assert.equal(toggleHints(), 0, 'toggleHints must return 0 when the page has no targets');
    assert.equal(dom.document.getElementById('mise-hint-layer'), null, 'no overlay may be mounted without targets');

    // Three targets: single-letter codes from the left-hand cluster.
    const targets = [dom.makeTarget({ left: 10 }), dom.makeTarget({ left: 60 }), dom.makeTarget({ left: 110 })];
    targets.forEach((el) => dom.document.body.appendChild(el));

    assert.equal(toggleHints(), 3, 'toggleHints must return the number of painted hints');
    const layer = dom.document.getElementById('mise-hint-layer');
    assert.ok(layer, 'hint layer must be mounted on documentElement');
    assert.equal(layer.dataset.mode, 'click', 'default hint mode must be click');
    assert.equal(layer.children.length, 3, 'one badge per visible target');
    assert.deepEqual(
        layer.children.map((b) => b.dataset.code),
        ['q', 'w', 'e'],
        'single-letter hints must follow the documented left-hand cluster'
    );

    // 'f' is part of the hint alphabet but not a code here: it must be swallowed
    // (never leak to the page) and must not click anything.
    const fEvent = dom.pressKey('f');
    assert.equal(targets[0].clickCount + targets[1].clickCount + targets[2].clickCount, 0, 'unmatched hint key must not click');
    assert.equal(fEvent.stopped, true, 'unmatched hint key must not leak to the underlying page');

    // The matching code clicks the target and tears the overlay down.
    dom.pressKey('q');
    assert.equal(targets[0].clickCount, 1, 'typed hint code must click its target');
    assert.equal(dom.document.getElementById('mise-hint-layer'), null, 'overlay must be removed after a hint fires');

    // Re-opening and pressing the toggle again dismisses (-1) instead of re-painting.
    assert.equal(toggleHints(), 3, 're-opening must repaint every target');
    assert.equal(toggleHints(), -1, 'same-mode toggle must report dismissal with -1');
    assert.equal(dom.document.getElementById('mise-hint-layer'), null, 'dismissal must unmount the overlay');

    console.log('✓ hinter.js paints, filters, clicks, and dismisses with accurate return codes');
}

// ---------------------------------------------------------------------------
// 2. Dense pages: 2-letter codes, 'f' as a first stroke, uniqueness
// ---------------------------------------------------------------------------
{
    const dom = createFakeDom();
    const toggleHints = loadHinter(dom);

    const targets = [];
    for (let i = 0; i < 140; i++) {
        const el = dom.makeTarget({ left: 10 + (i % 20) * 30, top: 10 + Math.floor(i / 20) * 30 });
        targets.push(el);
        dom.document.body.appendChild(el);
    }

    assert.equal(toggleHints(), 140, 'all 140 visible targets must be hinted');
    const layer = dom.document.getElementById('mise-hint-layer');
    const codes = layer.children.map((b) => b.dataset.code);
    assert.equal(new Set(codes).size, codes.length, 'hint codes must be unique (no 144-key modulo collisions)');
    assert.ok(codes.every((c) => c.length === 2), '13-144 targets must use two-letter codes');

    // Index 130 is 'ff' in the documented base-12 generator.
    assert.equal(codes[130], 'ff', 'code 130 must be ff');

    // A first stroke of 'f' must narrow the overlay, not dismiss or click anything.
    dom.pressKey('f');
    assert.equal(targets[130].clickCount, 0, 'first stroke must not activate a hint');
    assert.ok(dom.document.getElementById('mise-hint-layer'), 'first stroke must keep the overlay open');
    const visibleBadges = layer.children.filter((b) => b.style.opacity === '1');
    assert.equal(visibleBadges.length, 12, "only the twelve badges starting with 'f' stay highlighted");

    // Second stroke completes 'ff' and clicks target 130.
    dom.pressKey('f');
    assert.equal(targets[130].clickCount, 1, "typing 'ff' must click hint 130");

    console.log("✓ dense pages get unique two-letter codes and 'f' works as a hint stroke");
}

// ---------------------------------------------------------------------------
// 3. Shadow DOM traversal, viewport filtering and deduplication
// ---------------------------------------------------------------------------
{
    const dom = createFakeDom();
    const toggleHints = loadHinter(dom);

    // Off-screen target (scrolled above the viewport) must be skipped.
    const offscreen = dom.makeTarget({ left: 10, top: -40 });
    dom.document.body.appendChild(offscreen);

    // Zero-size target must be skipped.
    const collapsed = dom.makeTarget({ left: 10, top: 10, width: 0, height: 0 });
    dom.document.body.appendChild(collapsed);

    // Target hidden inside an open shadow root must be collected.
    const host = new FakeElement('div');
    host.shadowRoot = new FakeElement('shadow-root');
    const shadowLink = dom.makeTarget({ left: 200, top: 200 });
    host.shadowRoot.appendChild(shadowLink);
    dom.document.body.appendChild(host);

    assert.equal(toggleHints(), 1, 'only the in-viewport shadow-DOM target may be hinted');
    const layer = dom.document.getElementById('mise-hint-layer');
    assert.equal(layer.children[0].dataset.code, 'q', 'shadow root link must receive the first hint');

    console.log('✓ viewport bounds and shadow DOM traversal preserved');
}

// ---------------------------------------------------------------------------
// 4. Glance mode emits a preview request instead of navigating
// ---------------------------------------------------------------------------
{
    const dom = createFakeDom();
    const toggleHints = loadHinter(dom);

    const link = dom.makeTarget({ left: 10, href: 'https://example.org/article' });
    dom.document.body.appendChild(link);

    assert.equal(toggleHints({ mode: 'glance' }), 1, 'glance mode must paint hints');
    const layer = dom.document.getElementById('mise-hint-layer');
    assert.equal(layer.dataset.mode, 'glance', 'glance overlay must be tagged with its mode');

    dom.pressKey('q');
    assert.equal(link.clickCount, 0, 'glance mode must not navigate the page');
    assert.equal(dom.dispatched.length, 1, 'glance mode must dispatch a preview request');
    assert.equal(dom.dispatched[0].type, 'mise-glance-request');
    assert.equal(dom.dispatched[0].detail.url, 'https://example.org/article');

    console.log('✓ glance mode previews instead of clicking');
}

// ---------------------------------------------------------------------------
// 5. Static wiring: no silent 'f' failures in the host -> page pipeline
// ---------------------------------------------------------------------------
{
    const preloadSource = fs.readFileSync(path.join(__dirname, '../webview-preload.js'), 'utf8');
    const webviewSource = fs.readFileSync(path.join(__dirname, '../modules/webview.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');

    // Normal mode must claim keys in the capture phase, otherwise a page listener
    // on document that stops propagation eats 'f' before Mise ever sees it.
    assert.match(
        preloadSource,
        /window\.addEventListener\('keydown', \(e\) => \{[\s\S]*?\n\}, true\);/,
        'webview-preload.js must register the modal navigation keydown listener in the capture phase'
    );

    // 'f' reaching the host is configuration now rather than a literal in this file,
    // so pin the default binding plus the table-driven dispatch that forwards it.
    assert.equal(
        require('../keybinds.js').DEFAULT_NORMAL_KEYBINDS.f,
        'trigger-hints',
        "'f' must be bound to trigger-hints by default"
    );
    assert.match(
        preloadSource,
        /if \(normalKeymap\.singles\[key\]\) \{\s*consumeEvent\(e\);\s*runNormalAction\(normalKeymap\.singles\[key\]\);/,
        'webview-preload.js must dispatch single-key normal bindings from the keymap'
    );
    assert.match(
        preloadSource,
        /ipcRenderer\.sendToHost\('normal-mode-action', action\)/,
        'actions the guest cannot perform itself must still reach the host as normal-mode-action'
    );
    assert.match(
        webviewSource,
        /case 'trigger-hints':[\s\S]*?window\.triggerLinkHints\(webview\);/,
        'modules/webview.js must forward the originating webview to triggerLinkHints'
    );

    // The engine must be installed before any await/early return in dom-ready...
    assert.match(
        webviewSource,
        /webview\.addEventListener\('dom-ready', async \(\) => \{\s*webview\.style\.opacity = '1';\s*[\s\S]*?ensureHinterInjected\(webview\)\.catch\(\(\) => \{\}\);[\s\S]*?const liveIdx = getLiveTabIndex\(webview, currentWS, idx\);/,
        'dom-ready must install the hints engine before the liveIdx early return'
    );
    // ...and be installable on demand, so a keystroke that beats injection still works.
    assert.match(
        webviewSource,
        /export async function ensureHinterInjected\(webview\)/,
        'modules/webview.js must export ensureHinterInjected for on-demand installation'
    );
    assert.match(
        rendererSource,
        /if \(typeof window\.toggleHints !== 'function'\) return -2;[\s\S]*?const injected = await ensureHinterInjected\(webview\);[\s\S]*?shown = await webview\.executeJavaScript\(expression\);/,
        'renderer.js must install the hints engine and retry once when the document has none'
    );
    assert.match(
        rendererSource,
        /if \(shown === 0\) \{\s*setTargetUrl\('Link hints: no targets in view', 2000\);/,
        'renderer.js must report an empty hint set instead of failing silently'
    );

    // The HINTS mode indicator must observe where the layer is actually mounted.
    assert.match(
        preloadSource,
        /const root = document\.documentElement;[\s\S]*?observer\.observe\(root, \{ childList: true \}\);/,
        'webview-preload.js must observe documentElement for hint layer mutations'
    );
    assert.equal(
        /observer\.observe\(document\.body, \{ childList: true \}\)/.test(preloadSource),
        false,
        'webview-preload.js must not observe document.body for the hint layer (it mounts on documentElement)'
    );

    console.log('✓ host -> page hints pipeline cannot fail silently');
}

console.log('All link hints regression tests passed.');
