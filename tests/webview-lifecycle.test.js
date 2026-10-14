// tests/webview-lifecycle.test.js
// Verification for guest webview lifecycle teardown, signal aborting, and crash loop prevention

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise guest webview lifecycle and teardown regression tests...');

// 1. Verify destroyGuestWebview lifecycle cleanup steps
{
    // Mock webview instance
    let blurred = false;
    let muted = false;
    let stopped = false;
    let removed = false;
    const injectedScripts = new Set(['script1', 'script2']);
    const abortController = new AbortController();

    const mockWebview = {
        ownerDocument: {},
        src: 'https://example.org',
        __miseAbortController: abortController,
        __miseInjectedScriptIds: injectedScripts,
        blur: () => { blurred = true; },
        setAudioMuted: (val) => { muted = val; },
        stop: () => { stopped = true; },
        remove: () => { removed = true; }
    };
    mockWebview.ownerDocument.activeElement = mockWebview;

    // Load destroyGuestWebview from modules/webview.js
    const webviewSource = fs.readFileSync(path.join(__dirname, '../modules/webview.js'), 'utf8');
    assert(webviewSource.includes('export function destroyGuestWebview'), 'destroyGuestWebview must be exported');

    // Extract function implementation for direct execution
    const fnStart = webviewSource.indexOf('export function destroyGuestWebview(webview) {');
    const fnEnd = webviewSource.indexOf('export function handleWebviewCrash');
    assert(fnStart !== -1 && fnEnd !== -1, 'Function boundaries for destroyGuestWebview must exist');

    const fnCode = webviewSource.slice(fnStart, fnEnd).replace('export function destroyGuestWebview', 'function destroyGuestWebview');
    const runner = new Function('webview', fnCode + '\ndestroyGuestWebview(webview);');

    // Execute teardown
    runner(mockWebview);

    assert.equal(mockWebview.__miseDestroyed, true, 'Webview must be flagged as destroyed');
    assert.equal(blurred, true, 'Active webview must release focus via blur()');
    assert.equal(abortController.signal.aborted, true, 'Webview abort controller signal must be aborted');
    assert.equal(mockWebview.__miseAbortController, null, 'Webview abort controller reference must be cleared');
    assert.equal(muted, true, 'Audio stream must be muted on teardown');
    assert.equal(stopped, true, 'Pending network requests must be stopped');
    assert.equal(mockWebview.src, 'about:blank', 'Source must be assigned to about:blank to release memory');
    assert.equal(removed, true, 'Webview node must be removed from the DOM');
    assert.equal(injectedScripts.size, 0, 'Injected script identifier cache must be cleared');

    // Null safety check
    assert.doesNotThrow(() => runner(null), 'destroyGuestWebview must safely handle null inputs');
    assert.doesNotThrow(() => runner(undefined), 'destroyGuestWebview must safely handle undefined inputs');

    console.log('✓ destroyGuestWebview halts media, aborts listeners, navigates to about:blank, and unmounts');
}

// 2. Verify AbortSignal integration prevents lingering listener callbacks after destruction
{
    const abortController = new AbortController();
    const eventTarget = new EventTarget();
    let invocationCount = 0;

    const listener = () => { invocationCount++; };
    eventTarget.addEventListener('test-event', listener, { signal: abortController.signal });

    eventTarget.dispatchEvent(new Event('test-event'));
    assert.equal(invocationCount, 1, 'Listener must fire when signal is active');

    // Abort signal (as destroyGuestWebview does)
    abortController.abort();

    eventTarget.dispatchEvent(new Event('test-event'));
    assert.equal(invocationCount, 1, 'Listener must not fire after signal has been aborted');

    console.log('✓ AbortController signal detaches event listeners synchronously upon teardown');
}

// 3. Verify handleWebviewCrash exponential backoff and loop termination
{
    const webviewSource = fs.readFileSync(path.join(__dirname, '../modules/webview.js'), 'utf8');
    assert(webviewSource.includes('export function handleWebviewCrash'), 'handleWebviewCrash must be exported');

    const fnStart = webviewSource.indexOf('export function handleWebviewCrash(webview, event) {');
    const fnEnd = webviewSource.indexOf('export function createWebView');
    assert(fnStart !== -1 && fnEnd !== -1, 'Function boundaries for handleWebviewCrash must exist');

    const fnCode = webviewSource.slice(fnStart, fnEnd).replace('export function handleWebviewCrash', 'function handleWebviewCrash');

    let statusMessages = [];
    const setTargetUrl = (msg) => { statusMessages.push(msg); };

    let timeouts = [];
    const customSetTimeout = (fn, delay) => {
        timeouts.push({ fn, delay });
        return timeouts.length;
    };

    const runCrashHandler = (wv, ev) => {
        const fullScope = `
            ${fnCode}
            handleWebviewCrash(webview, event);
        `;
        const executor = new Function('webview', 'event', 'setTargetUrl', 'setTimeout', fullScope);
        executor(wv, ev, setTargetUrl, customSetTimeout);
    };

    // Test 3a: Clean exit or killed process should not trigger auto reload
    const cleanWebview = { reload: () => {} };
    runCrashHandler(cleanWebview, { reason: 'clean-exit' });
    runCrashHandler(cleanWebview, { reason: 'killed' });
    assert.equal(timeouts.length, 0, 'Clean exit or killed reason must not trigger reload');

    // Test 3b: First abnormal crash schedules reload with initial delay
    const crashingWebview = {
        reloadCalled: false,
        reload: function() { this.reloadCalled = true; }
    };
    runCrashHandler(crashingWebview, { reason: 'crashed' });
    assert.equal(timeouts.length, 1, 'First crash must schedule a reload timer');
    assert.equal(timeouts[0].delay, 500, 'First crash reload delay must be 500ms');
    assert(statusMessages[0].includes('Reloading in 0.5s'), 'Status message must report 0.5s reload');

    // Test 3c: Second crash within 10s schedules backoff reload
    runCrashHandler(crashingWebview, { reason: 'oom' });
    assert.equal(timeouts.length, 2, 'Second crash must schedule second reload timer');
    assert.equal(timeouts[1].delay, 1500, 'Second crash reload delay must back off to 1500ms');
    assert(statusMessages[1].includes('Reloading in 1.5s'), 'Status message must report 1.5s reload');

    // Test 3d: Third crash within 10s terminates loop and suspends auto reload
    runCrashHandler(crashingWebview, { reason: 'oom' });
    assert.equal(timeouts.length, 2, 'Third crash within window must not schedule another reload');
    assert(statusMessages[2].includes('Automatic reload suspended'), 'Status message must announce auto reload suspension');

    // Test 3e: Destroyed webview never reloads even if pending timer executes
    const destroyedWebview = {
        __miseDestroyed: true,
        reloadCalled: false,
        reload: function() { this.reloadCalled = true; }
    };
    timeouts = [];
    runCrashHandler(destroyedWebview, { reason: 'crashed' });
    assert.equal(timeouts.length, 0, 'Destroyed webview must be ignored by crash handler');

    // Execute first scheduled timer callback on crashingWebview to verify invocation
    timeouts[0] = timeouts[0] || {};
    const testTimerWv = { reloadCount: 0, reload: function() { this.reloadCount++; } };
    timeouts = [];
    runCrashHandler(testTimerWv, { reason: 'crashed' });
    timeouts[0].fn();
    assert.equal(testTimerWv.reloadCount, 1, 'Scheduled reload callback must call reload() on active webview');

    // If webview is destroyed before callback fires, reload must not be called
    testTimerWv.__miseDestroyed = true;
    timeouts[0].fn();
    assert.equal(testTimerWv.reloadCount, 1, 'Callback must not invoke reload() if webview was destroyed in interim');

    console.log('✓ handleWebviewCrash prevents infinite loops and suspends repeated crashes');
}

// 4. Verify Chromium disk and media cache limits in main.js
{
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    assert(mainSource.includes("'disk-cache-size'"), 'disk-cache-size switch must be configured');
    assert(mainSource.includes("'157286400'"), 'disk-cache-size must be bounded to 150MB (157286400 bytes)');
    assert(mainSource.includes("'media-cache-size'"), 'media-cache-size switch must be configured');
    assert(mainSource.includes("'52428800'"), 'media-cache-size must be bounded to 50MB (52428800 bytes)');

    console.log('✓ Chromium disk and media cache limits registered with explicit boundaries');
}

// 5. Verify createWebView attaches AbortSignal to all listeners
{
    const webviewSource = fs.readFileSync(path.join(__dirname, '../modules/webview.js'), 'utf8');
    const createWvStart = webviewSource.indexOf('export function createWebView');
    const createWvEnd = webviewSource.indexOf('export function handleNormalModeAction');
    const createWvBody = webviewSource.slice(createWvStart, createWvEnd);

    const allListenersRegex = /webview\.addEventListener\(\s*['"]([a-z-]+)['"]/g;
    const allListeners = [...createWvBody.matchAll(allListenersRegex)].map(m => m[1]);
    assert.equal(allListeners.length, 17, `Expected exactly 17 addEventListener registrations in createWebView, found ${allListeners.length}`);

    const wiredListenersRegex = /webview\.addEventListener\(\s*['"]([a-z-]+)['"],[\s\S]*?, listenerOptions\);/g;
    const wiredListeners = [...createWvBody.matchAll(wiredListenersRegex)].map(m => m[1]);
    assert.equal(wiredListeners.length, 17, `All 17 addEventListener registrations must pass listenerOptions, found ${wiredListeners.length}`);

    console.log('✓ All 17 createWebView event listeners wired with AbortController signal');
}

console.log('All guest webview lifecycle and teardown regression tests passed successfully!');
