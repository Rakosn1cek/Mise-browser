// tests/peek-glance-modal.test.js
// Verification for Ephemeral Tab Peek ("Glance") modal lifecycle, security guards, and keybinds

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise Ephemeral Tab Peek ("Glance") regression tests...');

// 1. Static code analysis of modules/overlays/peekModal.js
{
    const source = fs.readFileSync(path.join(__dirname, '../modules/overlays/peekModal.js'), 'utf8');

    assert(
        source.includes("import { destroyGuestWebview } from '../webview.js';"),
        'peekModal.js must import destroyGuestWebview from ../webview.js'
    );
    assert(
        source.includes("import { getWorkspacePartition, focusActiveWebview, isSafeTabUrl } from '../utils.js';"),
        'peekModal.js must import getWorkspacePartition, focusActiveWebview, and isSafeTabUrl'
    );
    assert(
        source.includes("if (!isSafeTabUrl(targetUrl)) return;"),
        'peekModal.js must guard openPeekModal with isSafeTabUrl'
    );
    assert(
        source.includes("destroyGuestWebview(existingWebview);"),
        'peekModal.js must clean up pre-existing webviews in container before mounting'
    );
    assert(
        source.includes("destroyGuestWebview(modalWebview);"),
        'peekModal.js must destroy modal webview during closePeekModal for zero memory residue'
    );
    assert(
        source.includes("focusActiveWebview();"),
        'peekModal.js must return focus to the underlying page via focusActiveWebview on dismissal'
    );
    assert(
        source.includes("export function promotePeekToTab"),
        'peekModal.js must export promotePeekToTab to support promoting preview to permanent tab'
    );

    console.log('✓ peekModal.js imports, memory detachment, and URL guards verified');
}

// 2. Static verification of webview-preload.js and hinter.js
{
    const preloadSource = fs.readFileSync(path.join(__dirname, '../webview-preload.js'), 'utf8');
    const hinterSource = fs.readFileSync(path.join(__dirname, '../hinter.js'), 'utf8');

    // Shift + Click exclusively (no Ctrl + Click for peek)
    assert(
        preloadSource.includes("!e.shiftKey"),
        'webview-preload.js must enforce Shift + Click exclusively for link peek'
    );
    assert(
        preloadSource.includes("'open-peek-preview'"),
        'webview-preload.js must send open-peek-preview via sendToHost'
    );

    // Normal mode gh chord verification
    assert(
        preloadSource.includes("now - lastGTime < 500") &&
        preloadSource.includes("'trigger-glance-hints'"),
        'webview-preload.js must detect gh chord within 500ms and dispatch trigger-glance-hints'
    );

    // hinter.js glance mode support
    assert(
        hinterSource.includes("mode === 'glance'") &&
        hinterSource.includes('#bb9af7'),
        'hinter.js must support glance mode and style badges with Tokyo Night purple (#bb9af7)'
    );
    assert(
        hinterSource.includes("'mise-glance-request'"),
        'hinter.js must dispatch mise-glance-request on hint activation in glance mode'
    );

    console.log('✓ Preload Shift+Click exclusivity, gh chord, and hinter glance mode verified');
}

// 3. Static verification of modules/webview.js, renderer.js, and keybinds.js
{
    const webviewSource = fs.readFileSync(path.join(__dirname, '../modules/webview.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
    const keybindsSource = fs.readFileSync(path.join(__dirname, '../keybinds.js'), 'utf8');
    const paletteSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/commandPalette.js'), 'utf8');

    assert(
        webviewSource.includes("openPeekModal") &&
        webviewSource.includes("'open-peek-preview'"),
        'modules/webview.js must handle open-peek-preview IPC message'
    );
    assert(
        webviewSource.includes("case 'trigger-glance-hints':"),
        'modules/webview.js must handle trigger-glance-hints in handleNormalModeAction'
    );
    assert(
        rendererSource.includes("function triggerGlanceHints()"),
        'renderer.js must implement triggerGlanceHints'
    );
    assert(
        rendererSource.includes("'PeekModalOverlay'"),
        'renderer.js must include PeekModalOverlay in overlayIds list'
    );
    assert(
        keybindsSource.includes("'trigger-glance': 'Ctrl+G'"),
        'keybinds.js must register trigger-glance with default keybind Ctrl+G'
    );
    assert(
        !keybindsSource.includes("'trigger-glance': 'Alt+"),
        'keybinds.js default trigger-glance must not use Alt modifier'
    );
    assert(
        paletteSource.includes("id: 'trigger-glance'"),
        'commandPalette.js must include trigger-glance entry'
    );

    console.log('✓ modules/webview.js IPC handler, renderer.js, keybinds.js, and command palette verified');
}

// 4. Functional DOM and lifecycle simulation
{
    const peekSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/peekModal.js'), 'utf8');

    let overlayDisplay = 'none';
    let destroyedWebviews = [];
    let focusedActiveWebviewCount = 0;
    let savedSessionState = null;
    let renderedWorkspaceIdx = -1;

    let containerElements = [];
    let innerHTMLValue = '';
    const mockContainer = {
        get innerHTML() { return innerHTMLValue; },
        set innerHTML(val) {
            innerHTMLValue = val;
            if (val === '') containerElements = [];
        },
        querySelector(selector) {
            if (selector === 'webview') {
                return containerElements.find(el => el.tagName === 'WEBVIEW') || null;
            }
            return null;
        },
        appendChild(el) {
            containerElements.push(el);
            return el;
        }
    };

    const mockTitle = { textContent: '' };
    const mockUrl = { textContent: '', title: '' };
    const mockCloseBtn = { onclick: null };
    const mockPromoteBtn = { onclick: null };

    const mockOverlay = {
        style: {
            get display() { return overlayDisplay; },
            set display(val) { overlayDisplay = val; }
        }
    };

    const windowListeners = new Map();
    const mockWindow = {
        addEventListener(type, handler) {
            if (!windowListeners.has(type)) windowListeners.set(type, []);
            windowListeners.get(type).push(handler);
        },
        removeEventListener(type, handler) {
            if (!windowListeners.has(type)) return;
            const list = windowListeners.get(type);
            const idx = list.indexOf(handler);
            if (idx !== -1) list.splice(idx, 1);
        },
        dispatchEvent(type, event) {
            const list = windowListeners.get(type) || [];
            for (const handler of [...list]) handler(event);
        },
        miseAPI: {
            getWebviewPreloadPath: () => '/path/to/webview-preload.js',
            saveSession: (s) => { savedSessionState = s; }
        },
        renderWorkspaceUI: (idx) => { renderedWorkspaceIdx = idx; }
    };

    const mockDocument = {
        getElementById(id) {
            if (id === 'PeekModalOverlay') return mockOverlay;
            if (id === 'PeekModalWebviewContainer') return mockContainer;
            if (id === 'PeekModalTitle') return mockTitle;
            if (id === 'PeekModalUrl') return mockUrl;
            if (id === 'ClosePeekModalBtn') return mockCloseBtn;
            if (id === 'PromotePeekTabBtn') return mockPromoteBtn;
            return null;
        },
        createElement(tagName) {
            const attrs = new Map();
            const listeners = {};
            return {
                tagName: tagName.toUpperCase(),
                style: {},
                setAttribute(k, v) { attrs.set(k, v); },
                getAttribute(k) { return attrs.get(k); },
                addEventListener(evt, fn) {
                    if (!listeners[evt]) listeners[evt] = [];
                    listeners[evt].push(fn);
                },
                _emit(evt, payload) {
                    if (listeners[evt]) listeners[evt].forEach(fn => fn(payload));
                }
            };
        }
    };

    const mockState = {
        globalPrivateModeActive: false,
        sessionState: {
            current_workspace: 'Workspace 1',
            workspaces: { 'Workspace 1': ['https://example.com/initial'] }
        },
        tabPinned: { 'Workspace 1': [false] }
    };

    function mockDestroyGuestWebview(wv) {
        if (wv) {
            wv.__miseDestroyed = true;
            destroyedWebviews.push(wv);
            const idx = containerElements.indexOf(wv);
            if (idx !== -1) containerElements.splice(idx, 1);
        }
    }

    function mockFocusActiveWebview() {
        focusedActiveWebviewCount++;
    }

    function mockIsSafeTabUrl(url) {
        if (typeof url !== 'string' || url.length === 0) return false;
        try {
            const p = new URL(url);
            return p.protocol === 'http:' || p.protocol === 'https:';
        } catch (_) {
            return false;
        }
    }

    function mockGetWorkspacePartition(ws) {
        return `persist:workspace_${ws}`;
    }

    const strippedSource = peekSource
        .replace(/import\s+[^;]+;\s*/g, '')
        .replace(/export\s+function/g, 'function');

    const factory = new Function(
        'document', 'window', 'state', 'getWorkspacePartition', 'focusActiveWebview', 'isSafeTabUrl', 'destroyGuestWebview',
        `${strippedSource}\nreturn { isPeekModalActive, openPeekModal, closePeekModal, promotePeekToTab };`
    );

    const { isPeekModalActive, openPeekModal, closePeekModal, promotePeekToTab } = factory(
        mockDocument,
        mockWindow,
        mockState,
        mockGetWorkspacePartition,
        mockFocusActiveWebview,
        mockIsSafeTabUrl,
        mockDestroyGuestWebview
    );

    // 4A: Valid URL opens modal
    openPeekModal('https://example.com/peek');
    assert.equal(isPeekModalActive(), true, 'openPeekModal must activate modal overlay');
    assert.equal(containerElements.length, 1, 'Transient webview must be mounted');
    assert.equal(containerElements[0].getAttribute('src'), 'https://example.com/peek');
    assert.equal(mockUrl.textContent, 'example.com', 'Hostname must be formatted into url element');

    // 4B: Escape key closes modal and returns focus without residue
    assert(windowListeners.has('keydown'), 'Window keydown listener must be attached');
    const escEvent = { key: 'Escape', preventDefault: () => {} };
    mockWindow.dispatchEvent('keydown', escEvent);

    assert.equal(isPeekModalActive(), false, 'Escape key must close peek modal');
    assert.equal(destroyedWebviews.length, 1, 'Modal webview must be destroyed via destroyGuestWebview');
    assert.equal(mockContainer.innerHTML, '', 'Container must be empty on close');
    assert.equal(focusedActiveWebviewCount, 1, 'focusActiveWebview must be invoked on close');

    // 4C: Malicious/unsafe URLs rejected
    openPeekModal('file:///etc/passwd');
    assert.equal(isPeekModalActive(), false, 'openPeekModal must reject file: scheme');
    openPeekModal('javascript:alert(1)');
    assert.equal(isPeekModalActive(), false, 'openPeekModal must reject javascript: scheme');

    // 4D: Promoting peek to tab appends to active workspace
    openPeekModal('https://example.com/promoted');
    assert.equal(isPeekModalActive(), true);
    promotePeekToTab();

    assert.equal(isPeekModalActive(), false, 'promotePeekToTab must close modal');
    assert.equal(mockState.sessionState.workspaces['Workspace 1'].length, 2, 'Tab must be added to workspace');
    assert.equal(mockState.sessionState.workspaces['Workspace 1'][1], 'https://example.com/promoted');
    assert.equal(renderedWorkspaceIdx, 1, 'Workspace UI must re-render at new tab index');
    assert.notEqual(savedSessionState, null, 'Session state must be saved');

    console.log('✓ Functional peek modal lifecycle, security filtering, and tab promotion verified');
}

console.log('All Mise Ephemeral Tab Peek ("Glance") regression tests passed successfully!');
