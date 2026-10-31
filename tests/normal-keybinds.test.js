// Regression test for configurable normal-mode (vim) keybindings.
//
// Before this refactor the guest's normal-mode keys were an if-chain plus a switch
// inside webview-preload.js, so rebinding one meant editing shipped code. They are
// now data in the "normal" section of keybinds.json. This script checks three
// things that are easy to get wrong and impossible to see failing:
//   1. the registry layer (normalisation, merge, unbind, sequence matching);
//   2. that the guest fallback table cannot drift from the shipped defaults;
//   3. the real preload dispatcher, executed in a VM against a stubbed Electron, so
//      the assertions are about what sendToHost actually receives.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const keybinds = require('../keybinds.js');

const PRELOAD_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'webview-preload.js'), 'utf8');

// ── 1. Registry layer ────────────────────────────────────────────────────────
assert.deepStrictEqual(
    keybinds.normalizeNormalKeySpec('Shift+j'),
    'J',
    'Shift+j must canonicalise to the uppercase letter, which is what e.key reports'
);
assert.strictEqual(keybinds.normalizeNormalKeySpec('j'), 'j', 'a bare letter stays lowercase');
assert.strictEqual(keybinds.normalizeNormalKeySpec('shift+J'), 'J', 'shift spelling is case-insensitive');
assert.strictEqual(keybinds.normalizeNormalKeySpec('g + h'), 'gh', 'a two-part spec is a sequence');
assert.strictEqual(
    keybinds.normalizeNormalKeySpec('Ctrl+j'),
    '',
    'Ctrl/Alt/Meta chords must be rejected here; they belong in the chord table, which is mode-blind'
);
assert.strictEqual(keybinds.normalizeNormalKeySpec(''), '', 'empty spec rejected');

// Every keystroke the old hardcoded chain handled must still be bound by default.
const LEGACY_BINDINGS = {
    j: 'scroll-down', k: 'scroll-up', h: 'scroll-left', l: 'scroll-right',
    u: 'scroll-half-page-up', d: 'toggle-dark-reader', e: 'toggle-reader-view',
    i: 'enter-insert-mode', G: 'scroll-bottom', t: 'spawn-tab', x: 'remove-tab',
    o: 'toggle-address', r: 'reload-active-tab', R: 'force-reload-active-tab',
    H: 'history-back', L: 'history-forward', '/': 'toggle-find', f: 'trigger-hints',
    w: 'toggle-dashboard', s: 'focus-sidebar', m: 'toggle-tab-audio-mute',
    M: 'toggle-global-audio-mute', p: 'toggle-pin-tab', y: 'yank-url'
};
for (const [key, action] of Object.entries(LEGACY_BINDINGS)) {
    assert.strictEqual(
        keybinds.DEFAULT_NORMAL_KEYBINDS[key],
        action,
        `default normal binding for "${key}" must be ${action}`
    );
}
assert.strictEqual(keybinds.DEFAULT_NORMAL_KEYBINDS.gg, 'scroll-top', 'gg sequence preserved');
assert.strictEqual(keybinds.DEFAULT_NORMAL_KEYBINDS.gh, 'trigger-glance', 'gh glance sequence preserved');
assert.strictEqual(keybinds.DEFAULT_NORMAL_KEYBINDS.J, 'previous-tab', 'Shift+J is previous tab');
assert.strictEqual(keybinds.DEFAULT_NORMAL_KEYBINDS.K, 'next-tab', 'Shift+K is next tab');
assert.strictEqual(keybinds.DEFAULT_NORMAL_KEYBINDS.W, 'remove-tab', 'Shift+W closes the tab');

// Every default value must be a real action, or compile would drop it silently.
for (const [key, action] of Object.entries(keybinds.DEFAULT_NORMAL_KEYBINDS)) {
    assert.ok(
        Object.prototype.hasOwnProperty.call(keybinds.ACTION_METADATA, action),
        `normal binding "${key}" points at unknown action "${action}"`
    );
}

const compiled = keybinds.compileNormalKeymap(keybinds.DEFAULT_NORMAL_KEYBINDS);
assert.deepStrictEqual(keybinds.matchNormalKey(compiled, 'g', null), { pending: 'g' });
assert.deepStrictEqual(keybinds.matchNormalKey(compiled, 'g', 'g'), { action: 'scroll-top' });
assert.deepStrictEqual(
    keybinds.matchNormalKey(compiled, 'h', 'g'),
    { action: 'trigger-glance' },
    'a pending sequence must win over the single-key binding'
);
assert.deepStrictEqual(keybinds.matchNormalKey(compiled, 'h', null), { action: 'scroll-left' });
assert.strictEqual(keybinds.matchNormalKey(compiled, 'Q', null), null, 'an unbound key must reach the page');
assert.strictEqual(keybinds.matchNormalKey(compiled, 'Escape', null), null, 'multi-char keys are not normal-mode keys');

// ── 2. Persistence ───────────────────────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-keybinds-'));
const bindPath = path.join(tmpDir, 'keybinds.json');

keybinds.initializeKeybinds(tmpDir);
const written = JSON.parse(fs.readFileSync(bindPath, 'utf8'));
assert.ok(written.normal && typeof written.normal === 'object', 'first boot must write a normal section to edit');
assert.strictEqual(written.normal.f, 'trigger-hints');

// A user file that only spells chords must not lose the normal defaults.
fs.writeFileSync(bindPath, JSON.stringify({ 'spawn-tab': 'Ctrl+Alt+N' }));
keybinds.initializeKeybinds(tmpDir);
assert.strictEqual(keybinds.getKeybinds()['spawn-tab'], 'Ctrl+Alt+N', 'chord override honoured');
assert.strictEqual(keybinds.getCompiledNormalKeymap().singles.f, 'trigger-hints', 'normal defaults survive a chords-only file');

// Override, unbind, and a typo that must fall back instead of deleting the default.
fs.writeFileSync(bindPath, JSON.stringify({
    normal: { 'Shift+J': 'next-tab', f: null, x: 'not-a-real-action' }
}));
keybinds.initializeKeybinds(tmpDir);
const afterUser = keybinds.getCompiledNormalKeymap();
assert.strictEqual(afterUser.singles.J, 'next-tab', 'user override applies');
assert.ok(!('f' in afterUser.singles), 'an explicit null unbinds the key');
assert.strictEqual(afterUser.singles.x, 'remove-tab', 'an unknown action must leave the default binding in place');

// Saving chords from the preferences path must not wipe hand-written normal keys.
fs.writeFileSync(bindPath, JSON.stringify({ normal: { 'Q': 'toggle-zen-mode' } }));
keybinds.initializeKeybinds(tmpDir);
keybinds.saveKeybinds(tmpDir, { 'spawn-tab': 'Ctrl+Alt+T' });
const reloaded = JSON.parse(fs.readFileSync(bindPath, 'utf8'));
assert.strictEqual(reloaded.normal.Q, 'toggle-zen-mode', 'save-keybinds must preserve the normal section');
fs.rmSync(tmpDir, { recursive: true, force: true });

// ── 3. The guest fallback table cannot drift from the shipped defaults ───────
const fallbackMatch = PRELOAD_SOURCE.match(/const FALLBACK_NORMAL_KEYMAP = \{[\s\S]*?\n\};/);
assert.ok(fallbackMatch, 'webview-preload.js must carry a fallback keymap for a failed IPC fetch');
// A vm-created object carries the sandbox's Object.prototype, which deepStrictEqual
// rejects even when the contents match, so both sides go through a JSON round trip.
const hostRealm = (value) => JSON.parse(JSON.stringify(value));
const guestFallback = hostRealm(vm.runInNewContext(
    `(${fallbackMatch[0]
        .replace(/^const FALLBACK_NORMAL_KEYMAP =\s*/, '')
        .replace(/;\s*$/, '')})`
));
const defaultSingles = Object.fromEntries(
    Object.entries(keybinds.DEFAULT_NORMAL_KEYBINDS).filter(([spec]) => spec.length === 1)
);
const defaultSequences = Object.fromEntries(
    Object.entries(keybinds.DEFAULT_NORMAL_KEYBINDS).filter(([spec]) => spec.length > 1)
);
assert.deepStrictEqual(
    guestFallback.singles,
    defaultSingles,
    'the guest fallback must equal the shipped single-key defaults'
);
assert.deepStrictEqual(
    guestFallback.sequences,
    defaultSequences,
    'the guest fallback must equal the shipped sequence defaults'
);

// No hardcoded normal-mode key branches may come back.
assert.ok(
    !/case '(f|x|t|w|y|H|L|R)':/.test(PRELOAD_SOURCE),
    'webview-preload.js must not hardcode normal-mode letters in a switch again'
);
assert.ok(
    PRELOAD_SOURCE.includes("ipcRenderer.sendSync('get-normal-keybinds')"),
    'the guest must fetch its bindings from the main process'
);
const guardSource = fs.readFileSync(path.join(__dirname, '..', 'main', 'ipcGuard.js'), 'utf8');
assert.ok(
    guardSource.includes("'get-normal-keybinds'"),
    'the new sync channel must be in the guest allowlist or the guard throws "Forbidden" for every page'
);

// ── 4. Functional: run the real preload and read what it sends the host ──────
function loadGuest(keymapOverride) {
    const sent = [];
    const consumed = { value: false };
    const windowListeners = {};

    const ipcRenderer = {
        sendSync: (channel) => {
            if (channel === 'get-normal-keybinds') return keymapOverride || null;
            return undefined;
        },
        sendToHost: (channel, ...args) => {
            if (channel === 'normal-mode-action') sent.push(args);
        },
        on: () => {},
        removeListener: () => {},
        send: () => {}
    };
    const electron = {
        ipcRenderer,
        webFrame: {
            executeJavaScript: () => {},
            setZoomLevel: () => {},
            insertCSS: () => {},
            addWorldScript: () => {},
            clearRangedBlobs: () => {},
            isOffscreen: false
        },
        contextBridge: { exposeInMainWorld: () => {} }
    };

    const makeElement = (id) => ({ id, style: {}, classList: { contains: () => false, add: () => {}, remove: () => {} }, appendChild: () => {}, remove: () => {}, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, contains: () => false, shadowRoot: null, children: [] });

    const document = {
        documentElement: makeElement('html'),
        body: makeElement('body'),
        activeElement: null,
        hidden: false,
        visibilityState: 'visible',
        getElementById: (id) => (id === 'mise-hint-layer' ? null : makeElement(id)),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        createElement: (tag) => makeElement(tag),
        createTextNode: () => makeElement('text'),
        defaultView: null
    };

    const win = {
        innerHeight: 800,
        innerWidth: 1200,
        location: { href: 'https://example.com/page', assign: () => {} },
        scrollX: 0,
        scrollY: 0,
        pageXOffset: 0,
        pageYOffset: 0,
        addEventListener: (type, fn, capture) => {
            (windowListeners[type] = windowListeners[type] || []).push({ fn, capture });
        },
        removeEventListener: () => {},
        matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }),
        getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }),
        requestAnimationFrame: (fn) => { fn(); return 1; },
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id),
        MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
        scrollTo: () => {},
        open: () => null
    };

    const sandbox = {
        window: win,
        document,
        navigator: { clipboard: { writeText: () => Promise.resolve() }, platform: 'Linux', userAgent: 'test', maxTouchPoints: 0 },
        location: win.location,
        ipcRenderer,
        webFrame: electron.webFrame,
        contextBridge: electron.contextBridge,
        require: (id) => (id === 'electron' ? electron : (() => { throw new Error('unexpected require ' + id); })()),
        console: { log: () => {}, warn: () => {}, error: () => {} },
        setTimeout: win.setTimeout,
        clearTimeout: win.clearTimeout,
        setInterval: () => 0,
        clearInterval: () => {},
        URL,
        URLSearchParams,
        Promise,
        MutationObserver: win.MutationObserver,
        CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
        Event: class { constructor(t) { this.type = t; } },
        Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }
    };
    sandbox.globalThis = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(PRELOAD_SOURCE, sandbox, { filename: 'webview-preload.js' });

    const handlers = (windowListeners.keydown || []).filter(l => l.capture === true);
    assert.equal(handlers.length, 1, 'the preload must install exactly one capture-phase keydown listener');

    return {
        sent,
        press(key, extra = {}) {
            const event = {
                key,
                code: 'Key' + key.toUpperCase(),
                shiftKey: /[A-Z]/.test(key) || !!extra.shiftKey,
                ctrlKey: false,
                altKey: false,
                metaKey: false,
                repeat: false,
                target: document.body,
                currentTarget: null,
                composedPath: () => [document.body],
                preventDefault() { consumed.value = true; },
                stopPropagation() {},
                stopImmediatePropagation() {},
                ...extra
            };
            consumed.value = false;
            for (const h of handlers) h.fn(event);
            return { consumed: consumed.value };
        }
    };
}

// Default table arriving from the main process.
{
    const guest = loadGuest({
        singles: Object.fromEntries(Object.entries(keybinds.DEFAULT_NORMAL_KEYBINDS).filter(([k]) => k.length === 1)),
        sequences: Object.fromEntries(Object.entries(keybinds.DEFAULT_NORMAL_KEYBINDS).filter(([k]) => k.length > 1)),
        windowMs: keybinds.SEQUENCE_WINDOW_MS
    });

    guest.press('f');
    assert.deepEqual(guest.sent.at(-1), ['trigger-hints'], 'f must ask the host for link hints');
    guest.press('J');
    assert.deepEqual(guest.sent.at(-1), ['previous-tab'], 'Shift+J must ask the host for the previous tab');
    guest.press('K');
    assert.deepEqual(guest.sent.at(-1), ['next-tab'], 'Shift+K must ask the host for the next tab');
    guest.press('W');
    assert.deepEqual(guest.sent.at(-1), ['remove-tab'], 'Shift+W must ask the host to close the tab');

    guest.sent.length = 0;
    guest.press('g');
    assert.equal(guest.sent.length, 0, 'a sequence starter must not act yet');
    guest.press('h');
    assert.deepEqual(guest.sent.at(-1), ['trigger-glance'], 'g then h must glance');

    const unbound = guest.press('Q');
    assert.ok(unbound.consumed === false, 'an unbound key must reach the page unconsumed');
}

// A user rebind must change what the guest sends, with no code change anywhere.
{
    const remapped = loadGuest({
        singles: { 'J': 'next-tab', 'K': 'previous-tab', 'f': 'spawn-tab' },
        sequences: {},
        windowMs: keybinds.SEQUENCE_WINDOW_MS
    });
    remapped.press('J');
    assert.deepEqual(remapped.sent.at(-1), ['next-tab'], 'the keymap must be honoured over any built-in behaviour');
    remapped.press('f');
    assert.deepEqual(remapped.sent.at(-1), ['spawn-tab'], 'a rebound key follows the user table even if it contradicts the old default');
}

// A failed fetch must fall back rather than kill every vim key.
{
    const broken = loadGuest(null);
    broken.press('f');
    assert.deepEqual(broken.sent.at(-1), ['trigger-hints'], 'if the IPC fetch fails the guest fallback table must still work');
}

// ── 5. The in-app reference must describe the config, not a frozen copy ──────
{
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const rows = [...html.matchAll(/data-normal-action(?:-alt)?="([^"]+)"/g)].map(m => m[1]);
    assert.ok(rows.length > 20, `the Preferences reference should list the normal bindings (found ${rows.length})`);

    const known = new Set(Object.values(keybinds.DEFAULT_NORMAL_KEYBINDS));
    for (const action of rows) {
        assert.ok(
            known.has(action),
            `index.html references data-normal-action="${action}", which no default binding produces`
        );
    }

    // Every action the guest can reach through the normal table should appear in the
    // reference, otherwise the user has no way to discover it is rebindable.
    const documented = new Set(rows);
    for (const action of known) {
        assert.ok(
            documented.has(action),
            `action "${action}" is bindable in normal mode but missing from the in-app reference`
        );
    }

    // A row without data-normal-action is a hardcoded <kbd> label that will lie after
    // a rebind. Only the two mode keys may stay static.
    const vimStart = html.indexOf('Vim Modal Navigation (NORMAL Mode)');
    const vimSection = html.slice(vimStart, html.indexOf('<h3 class="reference-subheading">', vimStart + 1));
    const staticRows = [...vimSection.matchAll(/<div class="shortcut-row">((?:(?!<\/div>)[\s\S])*?)<\/div>/g)]
        .map(m => (m[1].match(/<kbd class="shortcut-badge">([^<]+)<\/kbd>/) || [, '?'])[1]);
    assert.deepStrictEqual(
        staticRows.sort(),
        ['Escape', 'Shift + Escape'].sort(),
        'every normal-mode reference row must be config-driven except the mode keys'
    );
    // The repaint must exist and must not interpolate config text via innerHTML.
    const paletteSource = fs.readFileSync(path.join(__dirname, '..', 'modules', 'overlays', 'commandPalette.js'), 'utf8');
    assert.ok(
        paletteSource.includes("querySelectorAll('.shortcut-row[data-normal-action]')"),
        'commandPalette.js must repaint normal-mode reference rows from the live keymap'
    );
    const normalRepaint = paletteSource.slice(paletteSource.indexOf(".shortcut-row[data-normal-action]"));
    assert.ok(
        !normalRepaint.slice(0, normalRepaint.indexOf('} catch (err) {}')).includes('innerHTML'),
        'the normal-mode repaint must build nodes, not innerHTML strings from user config'
    );
}


console.log('✓ normal-mode keybindings are configurable, persisted, and dispatched from the table');
