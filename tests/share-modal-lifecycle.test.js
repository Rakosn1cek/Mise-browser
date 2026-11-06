// tests/share-modal-lifecycle.test.js
// Verification for transient share modal webview lifecycle cleanup and teardown

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise transient share modal lifecycle regression tests...');

// 1. Static code analysis of modules/overlays/shareModal.js
{
    const source = fs.readFileSync(path.join(__dirname, '../modules/overlays/shareModal.js'), 'utf8');

    // Verify destroyGuestWebview is imported from webview.js
    assert(
        source.includes("import { destroyGuestWebview } from '../webview.js';"),
        'shareModal.js must import destroyGuestWebview from ../webview.js'
    );

    // Verify pre-existing webviews are cleaned up before mounting
    assert(
        source.includes("const existingWebview = container.querySelector('webview');") &&
        source.includes('destroyGuestWebview(existingWebview);'),
        'shareModal.js must clean up pre-existing webviews in container before mounting'
    );

    // Verify modal webview is destroyed during closeModal before clearing innerHTML
    assert(
        source.includes("const modalWebview = container.querySelector('webview') || webview;") &&
        source.includes('destroyGuestWebview(modalWebview);'),
        'shareModal.js must invoke destroyGuestWebview during closeModal'
    );

    console.log('✓ shareModal.js teardown and destroyGuestWebview integration verified');
}

// 2. Functional lifecycle and teardown verification
{
    const source = fs.readFileSync(path.join(__dirname, '../modules/overlays/shareModal.js'), 'utf8');

    let destroyedWebviews = [];
    function mockDestroyGuestWebview(wv) {
        if (wv) {
            wv.__miseDestroyed = true;
            destroyedWebviews.push(wv);
            if (typeof wv.setAudioMuted === 'function') wv.setAudioMuted(true);
            if (typeof wv.stop === 'function') wv.stop();
            wv.src = 'about:blank';
            if (typeof wv.remove === 'function') wv.remove();
        }
    }

    // Mock DOM elements
    let overlayDisplay = 'none';
    const mockOverlay = {
        style: {
            get display() { return overlayDisplay; },
            set display(val) { overlayDisplay = val; }
        }
    };

    let containerElements = [];
    let innerHTMLValue = '';
    const mockContainer = {
        get innerHTML() { return innerHTMLValue; },
        set innerHTML(val) {
            innerHTMLValue = val;
            if (val === '') {
                containerElements = [];
            }
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

    const mockCloseBtn = {
        onclick: null
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
            for (const handler of [...list]) {
                handler(event);
            }
        },
        miseAPI: {
            getWebviewPreloadPath: () => '/path/to/preload.js'
        }
    };

    const mockDocument = {
        getElementById(id) {
            if (id === 'ShareModalOverlay') return mockOverlay;
            if (id === 'ShareModalWebviewContainer') return mockContainer;
            if (id === 'CloseShareModalBtn') return mockCloseBtn;
            return null;
        },
        createElement(tagName) {
            const attrs = new Map();
            const webviewObj = {
                tagName: tagName.toUpperCase(),
                style: {},
                setAttribute(k, v) { attrs.set(k, v); },
                getAttribute(k) { return attrs.get(k); },
                setAudioMuted(val) { this.muted = val; },
                stop() { this.stopped = true; },
                remove() {
                    const idx = containerElements.indexOf(this);
                    if (idx !== -1) containerElements.splice(idx, 1);
                }
            };
            return webviewObj;
        }
    };

    const mockState = {
        globalPrivateModeActive: false,
        sessionState: { current_workspace: 'default' }
    };

    function mockGetWorkspacePartition(ws) {
        return `persist:workspace_${ws}`;
    }

    // Build executable function from source
    // Replace ES module imports with local scope references
    const strippedSource = source
        .replace(/import\s+[^;]+;\s*/g, '')
        .replace('export function openTransientShareModal', 'function openTransientShareModal');

    const factory = new Function(
        'document', 'window', 'state', 'getWorkspacePartition', 'destroyGuestWebview',
        `${strippedSource}\nreturn { openTransientShareModal };`
    );

    const { openTransientShareModal } = factory(
        mockDocument,
        mockWindow,
        mockState,
        mockGetWorkspacePartition,
        mockDestroyGuestWebview
    );

    // Test A: Opening modal mounts webview and sets attributes
    openTransientShareModal('https://example.com/share');
    assert.equal(overlayDisplay, 'flex', 'Overlay must be visible with display: flex');
    assert.equal(containerElements.length, 1, 'Container must hold one webview');
    const mountedWebview = containerElements[0];
    assert.equal(mountedWebview.getAttribute('src'), 'https://example.com/share');
    assert.equal(mountedWebview.getAttribute('partition'), 'persist:workspace_default');

    // Test B: Closing modal via Close button invokes destroyGuestWebview and resets state
    assert(typeof mockCloseBtn.onclick === 'function', 'Close button must have onclick handler');
    mockCloseBtn.onclick();

    assert.equal(overlayDisplay, 'none', 'Overlay must be hidden on close');
    assert.equal(containerElements.length, 0, 'Container elements must be cleared on close');
    assert.equal(destroyedWebviews.length, 1, 'destroyGuestWebview must be called exactly once');
    assert.strictEqual(destroyedWebviews[0], mountedWebview, 'Destroyed webview must match mounted instance');
    assert.equal(mountedWebview.__miseDestroyed, true, 'Webview must be flagged as destroyed');
    assert.equal(mountedWebview.muted, true, 'Audio stream must be muted');
    assert.equal(mountedWebview.stopped, true, 'Pending requests must be stopped');
    assert.equal(mountedWebview.src, 'about:blank', 'Webview src must navigate to about:blank');

    // Test C: Opening modal again and closing via Escape keydown event
    destroyedWebviews = [];
    openTransientShareModal('https://example.com/share2');
    assert.equal(containerElements.length, 1);
    const secondWebview = containerElements[0];

    // Trigger Escape key
    let defaultPrevented = false;
    mockWindow.dispatchEvent('keydown', {
        key: 'Escape',
        preventDefault() { defaultPrevented = true; }
    });

    assert.equal(defaultPrevented, true, 'Escape keydown event must be prevented');
    assert.equal(overlayDisplay, 'none', 'Overlay must be hidden on Escape');
    assert.equal(destroyedWebviews.length, 1, 'destroyGuestWebview must be called on Escape');
    assert.strictEqual(destroyedWebviews[0], secondWebview);

    // Test D: Re-opening modal when an existing webview is still present tears down the old instance
    destroyedWebviews = [];
    openTransientShareModal('https://example.com/share3');
    const thirdWebview = containerElements[0];

    // Simulate opening another URL before closing
    openTransientShareModal('https://example.com/share4');
    assert.equal(destroyedWebviews.length, 1, 'Pre-existing webview must be destroyed before mounting next');
    assert.strictEqual(destroyedWebviews[0], thirdWebview, 'Previously active webview must be cleanly destroyed');
    assert.equal(containerElements.length, 1, 'Only new webview should reside in container');

    // Clean up
    mockCloseBtn.onclick();
    assert.equal(destroyedWebviews.length, 2, 'Final webview must be destroyed on close');

    console.log('✓ Transient share modal webview creation, teardown, and Escape dismissal verified');
}

// 3. Verify launchEmailComposer integration with configured webmail handlers
{
    const cpSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/commandPalette.js'), 'utf8');

    assert(
        cpSource.includes('export async function launchEmailComposer('),
        'commandPalette.js must export launchEmailComposer function'
    );
    assert(
        cpSource.includes("import { openTransientShareModal } from './shareModal.js';"),
        'commandPalette.js must import openTransientShareModal from shareModal.js'
    );
    assert(
        cpSource.includes('cfg.email_handler'),
        'launchEmailComposer must inspect cfg.email_handler configuration'
    );
    assert(
        cpSource.includes('getBrowserSettings'),
        'launchEmailComposer must invoke window.miseAPI.getBrowserSettings'
    );
    assert(
        cpSource.includes('openTransientShareModal(composeUrl)'),
        'launchEmailComposer must route webmail compose URLs to openTransientShareModal'
    );

    const shareSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/shareModal.js'), 'utf8');
    assert(
        shareSource.includes('ensureOverlayMounted'),
        'shareModal.js must import and fall back to ensureOverlayMounted'
    );

    console.log('✓ launchEmailComposer webmail share modal routing verified');
}

// 4. Verify buildEmailComposeUrl and normalizeEmailHandler across providers
{
    const config = require('../main/config');
    const { buildEmailComposeUrl, normalizeEmailHandler } = config;

    assert.equal(typeof buildEmailComposeUrl, 'function', 'config must export buildEmailComposeUrl');
    assert.equal(typeof normalizeEmailHandler, 'function', 'config must export normalizeEmailHandler');

    // System handler returns null (delegated to native OS handler)
    assert.strictEqual(buildEmailComposeUrl('system', { to: 'dev@example.com' }), null);

    // Gmail standalone compose endpoint verification
    const gmailUrl = buildEmailComposeUrl(
        'https://mail.google.com/mail/?view=cm&fs=1&to=%t&su=%s&body=%b',
        { to: 'rakosn1cek@zohomail.eu', subject: 'Feedback', body: 'Hello world' }
    );
    assert(gmailUrl.includes('view=cm&fs=1'), 'Gmail compose must include view=cm and fs=1');
    assert(gmailUrl.includes('to=rakosn1cek%40zohomail.eu'), 'Gmail compose must prefill to recipient');
    assert(gmailUrl.includes('su=Feedback'), 'Gmail compose must prefill su subject parameter');
    assert(gmailUrl.includes('body=Hello%20world'), 'Gmail compose must prefill body');

    // Legacy Gmail hash route auto-migration
    const legacyGmailMigrated = normalizeEmailHandler('https://mail.google.com/mail/u/0/#inbox?compose=new&subject=%s&body=%b');
    assert.strictEqual(
        legacyGmailMigrated,
        'https://mail.google.com/mail/?view=cm&fs=1&to=%t&su=%s&body=%b',
        'Legacy Gmail hash route must migrate to standalone compose template'
    );

    const legacyGmailUrl = buildEmailComposeUrl(
        'https://mail.google.com/mail/u/0/#inbox?compose=new&subject=%s&body=%b',
        { to: 'rakosn1cek@zohomail.eu', subject: 'Feedback', body: 'Hello' }
    );
    assert(legacyGmailUrl.includes('view=cm&fs=1'), 'Legacy Gmail input must produce working standalone compose URL');
    assert(legacyGmailUrl.includes('to=rakosn1cek%40zohomail.eu'), 'Legacy Gmail input must preserve recipient');

    // Zoho Mail EU compose envelope verification
    const zohoUrl = buildEmailComposeUrl(
        'https://mail.zoho.eu/zm/comp.do?ct=%m',
        { to: 'rakosn1cek@zohomail.eu', subject: 'Feedback', body: 'Hello world' }
    );
    assert(zohoUrl.includes('mail.zoho.eu/zm/comp.do?ct=mailto'), 'Zoho EU compose must wrap target in ct mailto envelope');
    assert(zohoUrl.includes('rakosn1cek%40zohomail.eu'), 'Zoho EU compose must include encoded recipient');

    // Legacy Zoho Mail auto-migration
    const legacyZohoMigrated = normalizeEmailHandler('https://mail.zoho.eu/zm/comp.do?originalMode=compose&app=6&subject=%s&body=%b');
    assert.strictEqual(
        legacyZohoMigrated,
        'https://mail.zoho.eu/zm/comp.do?ct=%m',
        'Legacy Zoho compose URL must migrate to ct mailto envelope template'
    );

    const legacyZohoUrl = buildEmailComposeUrl(
        'https://mail.zoho.eu/zm/comp.do?originalMode=compose&app=6&subject=%s&body=%b',
        { to: 'rakosn1cek@zohomail.eu', subject: 'Feedback', body: 'Hello' }
    );
    assert(legacyZohoUrl.includes('mail.zoho.eu/zm/comp.do?ct=mailto'), 'Legacy Zoho input must produce working ct envelope URL');

    // Outlook Web compose parameter verification
    const outlookUrl = buildEmailComposeUrl(
        'https://outlook.live.com/mail/0/deeplink/compose?to=%t&subject=%s&body=%b',
        { to: 'rakosn1cek@zohomail.eu', subject: 'Feedback', body: 'Hello' }
    );
    assert(outlookUrl.includes('to=rakosn1cek%40zohomail.eu'), 'Outlook compose must populate to parameter');
    assert(outlookUrl.includes('subject=Feedback'), 'Outlook compose must populate subject parameter');
    assert(outlookUrl.includes('body=Hello'), 'Outlook compose must populate body parameter');

    // Empty recipient handling for context menu sharing
    const shareUrl = buildEmailComposeUrl(
        'https://mail.google.com/mail/?view=cm&fs=1&to=%t&su=%s&body=%b',
        { to: '', subject: 'Shared link', body: 'https://mise.app' }
    );
    assert(shareUrl.includes('to=&su=Shared%20link'), 'Empty recipient must produce clean compose query without placeholder leak');

    console.log('✓ buildEmailComposeUrl webmail parameter construction and migration verified');
}

console.log('All transient share modal lifecycle regression tests passed successfully!');
