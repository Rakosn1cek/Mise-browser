// tests/client-hints.test.js
// Regression tests for Mise's User-Agent Client Hints shape.
//
// Context: Electron emits no `sec-ch-ua*` request headers, so Mise supplies them.
// It used to send two - `sec-ch-ua` and an unsolicited `sec-ch-ua-full-version-list`
// - which is a shape no browser produces: Chrome sends the low-entropy trio
// together, and the high-entropy full version list only to origins that asked with
// Accept-CH. This pins the corrected shape, the insertion order, and the
// per-session Accept-CH memory.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    GREASE_BRAND,
    buildLowEntropyHints,
    buildFullVersionList,
    parseAcceptCh,
    createAcceptChStore,
    applyClientHints
} = require('../main/clientHints');

console.log('Running Mise client hints regression tests...');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const RAW_ELECTRON_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) mise-browser/1.4.1 Chrome/156.0.7103.59 Electron/40.2.1 Safari/537.36';

// 1. Low-entropy trio: all three, values derived from the UA, platform mapped
{
    const hints = buildLowEntropyHints(UA, 'linux');
    assert.deepStrictEqual(Object.keys(hints),
        ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'],
        'the low-entropy trio must always be sent together');
    assert.strictEqual(hints['sec-ch-ua'],
        `"Chromium";v="156", "Google Chrome";v="156", ${GREASE_BRAND}`,
        'sec-ch-ua must carry the UA major and a GREASE brand');
    assert.strictEqual(hints['sec-ch-ua-mobile'], '?0');
    assert.strictEqual(hints['sec-ch-ua-platform'], '"Linux"');
    assert.strictEqual(buildLowEntropyHints(UA, 'win32')['sec-ch-ua-platform'], '"Windows"');
    assert.strictEqual(buildLowEntropyHints(UA, 'darwin')['sec-ch-ua-platform'], '"macOS"');

    const full = buildFullVersionList(UA);
    assert(/"Chromium";v="156\.0\.0\.0"/.test(full), 'full version list must mirror the JS uaFullVersion shape');
    assert(/"Google Chrome";v="156\.0\.0\.0"/.test(full));
    console.log('✓ low-entropy trio and full version list values verified');
}

// 2. Accept-CH parsing: arrays, multiple headers, critical-ch, junk rejection
{
    assert.deepStrictEqual(parseAcceptCh({ 'Accept-CH': 'sec-ch-ua-full-version-list' }),
        ['sec-ch-ua-full-version-list']);
    assert.deepStrictEqual(parseAcceptCh({ 'accept-ch': ['sec-ch-ua-model, Sec-CH-UA-Bitness'] }),
        ['sec-ch-ua-model', 'sec-ch-ua-bitness'], 'lists and casing must be normalised');
    assert.deepStrictEqual(parseAcceptCh({ 'Critical-CH': 'sec-ch-ua-arch' }), ['sec-ch-ua-arch']);
    assert.deepStrictEqual(parseAcceptCh({ 'Accept-CH': 'not a token, ,sec-ch-ua-wow64' }),
        ['sec-ch-ua-wow64'], 'invalid tokens must be dropped');
    assert.deepStrictEqual(parseAcceptCh({}), []);
    assert.deepStrictEqual(parseAcceptCh(null), []);
    console.log('✓ Accept-CH / Critical-CH parsing verified');
}

// 3. Per-origin store: opt-in only, per-origin isolation, bounded, recency refresh
{
    const store = createAcceptChStore({ limit: 2 });
    assert.strictEqual(store.wants('https://a.test', 'sec-ch-ua-full-version-list'), false,
        'nothing is requested before the origin opts in');

    store.record('https://a.test', { 'Accept-CH': 'sec-ch-ua-full-version-list' });
    assert.strictEqual(store.wants('https://a.test', 'sec-ch-ua-full-version-list'), true);
    assert.strictEqual(store.wants('https://a.test', 'SEC-CH-UA-FULL-VERSION-LIST'), true, 'lookup is case-insensitive');
    assert.strictEqual(store.wants('https://b.test', 'sec-ch-ua-full-version-list'), false, 'opt-in is per origin');
    assert.strictEqual(store.wants('https://a.test', 'sec-ch-ua-model'), false, 'only requested hints are wanted');

    store.record('https://b.test', { 'Accept-CH': 'sec-ch-ua-arch' });
    store.record('https://a.test', { 'Accept-CH': 'sec-ch-ua-model' });
    store.record('https://c.test', { 'Accept-CH': 'sec-ch-ua-platform-version' });
    assert.strictEqual(store.size(), 2, 'store stays bounded');
    assert.strictEqual(store.wants('https://a.test', 'sec-ch-ua-model'), true, 'a refreshed origin is not evicted');
    assert.strictEqual(store.wants('https://b.test', 'sec-ch-ua-arch'), false, 'the least recently used origin is evicted');
    console.log('✓ Accept-CH store opt-in, isolation, bound and recency verified');
}

// 4. Header merging: canonical position, in-place updates, no duplication
{
    const hints = buildLowEntropyHints(UA, 'linux');
    const base = { Host: 'example.test', Connection: 'keep-alive', 'User-Agent': UA, Accept: 'text/html' };

    const merged = applyClientHints({ ...base }, hints);
    assert.deepStrictEqual(Object.keys(merged),
        ['Host', 'Connection', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'User-Agent', 'Accept'],
        'hints are inserted after Connection, where Chrome puts them, not appended last');

    const withExisting = applyClientHints({
        Host: 'example.test',
        'sec-ch-ua': '"Chromium";v="1"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Windows"',
        'User-Agent': UA
    }, hints);
    assert.deepStrictEqual(Object.keys(withExisting),
        ['Host', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'User-Agent'],
        'existing hint headers are updated in place, never duplicated');
    assert.strictEqual(withExisting['sec-ch-ua-mobile'], '?0');
    assert.notStrictEqual(withExisting['sec-ch-ua'], '"Chromium";v="1"');

    const noHost = applyClientHints({ Accept: 'text/html' }, hints);
    assert.deepStrictEqual(Object.keys(noHost),
        ['Accept', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'],
        'without Host/Connection the hints are appended');
    assert.strictEqual(applyClientHints(null, hints), null);
    console.log('✓ header merge position, in-place update and fallthrough verified');
}

// 5. Wiring through security.js: request shape, Accept-CH opt-in, trusted domains
{
    const Module = require('module');
    const os = require('os');
    const userData = path.join(os.tmpdir(), 'mise-client-hints-test');
    fs.mkdirSync(userData, { recursive: true });

    const engine = {
        serialize: () => Buffer.from('stub'),
        updateFromDiff: () => {},
        enableBlockingInSession: () => {},
        isBlockingEnabled: () => false,
        onBeforeRequest: (details, callback) => callback({}),
        onHeadersReceived: (details, callback) => callback({ responseHeaders: details.responseHeaders })
    };
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function (id) {
        if (id === 'electron') {
            return { app: { getPath: () => userData }, ipcMain: { handle() {}, on() {}, removeHandler() {} } };
        }
        if (id === '@ghostery/adblocker-electron') {
            return { ElectronBlocker: { deserialize: () => engine, fromPrebuiltAdsAndTracking: async () => engine } };
        }
        if (id === './adblocker-build') {
            return () => Promise.resolve({ blocker: engine, cacheBytes: Buffer.from('stub') });
        }
        return originalRequire.apply(this, arguments);
    };

    const makeSession = () => {
        const handlers = {};
        return {
            handlers,
            webRequest: {
                onBeforeRequest: (...a) => { handlers.before = a[a.length - 1]; },
                onBeforeSendHeaders: (...a) => { handlers.headers = a[a.length - 1]; },
                onHeadersReceived: (...a) => { handlers.received = a[a.length - 1]; }
            }
        };
    };

    try {
        const security = require('../security.js');
        const request = (session, url, headers, resourceType = 'mainFrame') => {
            let out;
            session.handlers.headers({ url, resourceType, requestHeaders: { ...headers } }, (r) => { out = r.requestHeaders; });
            return out;
        };
        const response = (session, url, responseHeaders, resourceType = 'mainFrame') => {
            let out;
            session.handlers.received({ url, resourceType, responseHeaders }, (r) => { out = r; });
            return out;
        };
        const headers = () => ({
            Host: 'www.example.test',
            Connection: 'keep-alive',
            'User-Agent': RAW_ELECTRON_UA,
            Accept: 'text/html',
            'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
            'Sec-Fetch-Site': 'none'
        });

        const session = makeSession();
        security.hardenSession(session, 'en-GB', 'default_public_interface_only');

        // 5a. Default document request: trio present, no unsolicited full version list
        const first = request(session, 'https://www.example.test/page', headers());
        assert(first['sec-ch-ua'], 'sec-ch-ua must be supplied (Electron emits none)');
        assert(first['sec-ch-ua-mobile'], 'sec-ch-ua-mobile must be supplied alongside sec-ch-ua');
        assert(first['sec-ch-ua-platform'], 'sec-ch-ua-platform must be supplied alongside sec-ch-ua');
        assert.strictEqual(first['sec-ch-ua-full-version-list'], undefined,
            'the high-entropy hint must not be sent before the origin asks for it');
        assert.strictEqual(first['Accept-Language'], 'en-GB,en-US;q=0.9,en;q=0.8',
            "Accept-Language is Chromium's to send (it matches navigator.languages)");
        assert(!/Electron|mise-browser/i.test(first['User-Agent']), 'the Electron marker must still be stripped');
        assert(/Chrome\/156\.0\.0\.0/.test(first['User-Agent']), 'the reduced UA is preserved');
        assert.deepStrictEqual(Object.keys(first).slice(0, 5),
            ['Host', 'Connection', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'],
            "hints ride in Chrome's document-request position");
        console.log('✓ default request shape: coherent trio, no unsolicited high-entropy hint');

        // 5b. After Accept-CH, main-frame requests to that origin carry the full list
        response(session, 'https://www.example.test/page', { 'Accept-CH': 'sec-ch-ua-full-version-list' });
        const optedIn = request(session, 'https://www.example.test/page', headers());
        assert(optedIn['sec-ch-ua-full-version-list'], 'an origin that opted in must receive the full version list');

        const otherOrigin = request(session, 'https://other.test/page', headers());
        assert.strictEqual(otherOrigin['sec-ch-ua-full-version-list'], undefined, 'opt-in does not leak to other origins');

        const subresource = request(session, 'https://www.example.test/app.js', headers(), 'script');
        assert.strictEqual(subresource['sec-ch-ua-full-version-list'], undefined,
            'the high-entropy hint stays on document requests');
        console.log("✓ Accept-CH opt-in applies to that origin's documents only");

        // 5c. Trusted domains are left byte-identical
        security.setTrustedDomains(['bank.example']);
        const trustedInput = headers();
        const trustedSession = makeSession();
        security.hardenSession(trustedSession, 'en-GB', 'default_public_interface_only');
        const trustedOut = request(trustedSession, 'https://bank.example/', trustedInput);
        assert.deepStrictEqual(trustedOut, trustedInput, 'a trusted domain must not have headers rewritten');
        console.log('✓ trusted domains bypass hint injection entirely');

        // 5d. Non-http schemes get no hints
        const fileReq = request(session, 'file:///home/user/page.html', headers());
        assert.strictEqual(fileReq['sec-ch-ua'], undefined, 'no client hints for non-network schemes');

        // 5e. Per-session isolation: a second workspace/profile does not inherit opt-ins
        const second = makeSession();
        security.hardenSession(second, 'en-GB', 'default_public_interface_only');
        const secondReq = request(second, 'https://www.example.test/page', headers());
        assert.strictEqual(secondReq['sec-ch-ua-full-version-list'], undefined,
            'Accept-CH state must not leak between sessions (workspace profiles)');
        console.log('✓ non-http schemes and per-session isolation verified');
    } finally {
        Module.prototype.require = originalRequire;
    }
}

// 6. Security module wiring: the old unconditional assignments are gone
{
    const source = fs.readFileSync(path.join(__dirname, '..', 'security.js'), 'utf8');
    assert(!/headers\['sec-ch-ua-full-version-list'\]\s*=/.test(source),
        'security.js must not assign the high-entropy hint unconditionally');
    assert(!/headers\['sec-ch-ua'\]\s*=/.test(source),
        'security.js must build hints through main/clientHints.js');
    assert(!/headers\['Accept-Language'\]\s*=/.test(source),
        'security.js must not override Accept-Language');
    assert(/applyClientHints\(headers, hints\)/.test(source), 'hints must be merged positionally');
    assert(/acceptCh\.wants\(/.test(source) && /acceptCh\.record\(/.test(source),
        'the request handler must consult the Accept-CH store the response handler fills');
    console.log('✓ security.js wiring verified');
}

console.log('All client hints regression tests passed successfully!');
