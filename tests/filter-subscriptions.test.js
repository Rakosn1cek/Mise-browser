// tests/filter-subscriptions.test.js
// Verification for community filter list subscriptions, validation, and session hot-swapping

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const { ElectronBlocker, adsAndTrackingLists, Request } = require('@ghostery/adblocker-electron');

console.log('Running Mise filter list subscriptions regression tests...');

// 1. Validation & SSRF Security Guards
{
    const { validateFilterLists, DEFAULT_FILTER_LISTS } = require('../main/config');

    assert.equal(typeof validateFilterLists, 'function', 'validateFilterLists must be exported');

    // Reject non-objects
    assert.equal(validateFilterLists(null), null);
    assert.equal(validateFilterLists(undefined), null);
    assert.equal(validateFilterLists('invalid'), null);
    assert.equal(validateFilterLists([1, 2, 3]), null);

    // Reject non-boolean values in presets
    assert.equal(validateFilterLists({ easylist: 'yes' }), null);
    assert.equal(validateFilterLists({ annoyances: 1 }), null);

    // Accept valid booleans and default missing ones
    const validPresets = validateFilterLists({ annoyances: true, social: true });
    assert.equal(validPresets.easylist, true);
    assert.equal(validPresets.easyprivacy, true);
    assert.equal(validPresets.annoyances, true);
    assert.equal(validPresets.social, true);
    assert.deepEqual(validPresets.custom_urls, []);

    // Reject insecure HTTP protocols
    assert.equal(validateFilterLists({ custom_urls: ['http://example.com/rules.txt'] }), null);
    assert.equal(validateFilterLists({ custom_urls: ['file:///etc/hosts'] }), null);
    assert.equal(validateFilterLists({ custom_urls: ['data:text/plain;base64,abc'] }), null);

    // Reject private IP ranges and localhost (SSRF protection)
    assert.equal(validateFilterLists({ custom_urls: ['https://localhost/list.txt'] }), null);
    assert.equal(validateFilterLists({ custom_urls: ['https://127.0.0.1/list.txt'] }), null);
    assert.equal(validateFilterLists({ custom_urls: ['https://10.0.0.5/list.txt'] }), null);
    assert.equal(validateFilterLists({ custom_urls: ['https://192.168.1.100/list.txt'] }), null);
    assert.equal(validateFilterLists({ custom_urls: ['https://172.16.0.1/list.txt'] }), null);
    assert.equal(validateFilterLists({ custom_urls: ['https://172.31.255.255/list.txt'] }), null);

    // Accept valid HTTPS URLs
    const withCustom = validateFilterLists({
        custom_urls: [
            'https://filters.example.org/list1.txt',
            'https://community-rules.com/adblock.txt'
        ]
    });
    assert.deepEqual(withCustom.custom_urls, [
        'https://filters.example.org/list1.txt',
        'https://community-rules.com/adblock.txt'
    ]);

    // Enforce 10 URL maximum cap
    const elevenUrls = Array.from({ length: 11 }, (_, i) => `https://example${i}.com/list.txt`);
    assert.equal(validateFilterLists({ custom_urls: elevenUrls }), null);

    // Enforce 2048 character URL limit
    const oversizeUrl = 'https://example.com/' + 'a'.repeat(2048);
    assert.equal(validateFilterLists({ custom_urls: [oversizeUrl] }), null);

    console.log('✓ Filter list schema, URL validation, and SSRF security guards verified');
}

// 2. Recipe Resolution Logic
{
    const buildAdblocker = require('../adblocker-build');
    const { resolveListUrls, TRACKING_LIST_URLS, ANNOYANCE_LIST_URLS, SOCIAL_LIST_URLS } = buildAdblocker;

    // Default configuration must resolve identically to adsAndTrackingLists
    assert.equal(resolveListUrls(null), adsAndTrackingLists);
    assert.equal(resolveListUrls({}), adsAndTrackingLists);
    assert.equal(resolveListUrls({ easylist: true, easyprivacy: true }), adsAndTrackingLists);

    // Annoyances toggle appends annoyance lists
    const withAnnoyances = resolveListUrls({ easylist: true, easyprivacy: true, annoyances: true });
    ANNOYANCE_LIST_URLS.forEach(url => {
        assert(withAnnoyances.includes(url), `Annoyances list must include ${url}`);
    });

    // Social toggle appends Fanboy social list
    const withSocial = resolveListUrls({ easylist: true, easyprivacy: true, social: true });
    SOCIAL_LIST_URLS.forEach(url => {
        assert(withSocial.includes(url), `Social list must include ${url}`);
    });

    // Custom URLs are included
    const customRecipe = resolveListUrls({
        easylist: true,
        easyprivacy: true,
        custom_urls: ['https://custom.filter/rules.txt']
    });
    assert(customRecipe.includes('https://custom.filter/rules.txt'));

    console.log('✓ Filter list recipe resolution and preset composition verified');
}

// 3. Cache Hashing Determinism
{
    const security = require('../security');
    const { getFilterCachePath } = security;

    const defaultPath = getFilterCachePath(adsAndTrackingLists);
    assert(defaultPath.endsWith('adblock_cache.bin'), 'Default recipe must resolve to canonical adblock_cache.bin');

    const customUrls1 = ['https://a.org/list.txt', 'https://b.org/list.txt'];
    const customUrls2 = ['https://b.org/list.txt', 'https://a.org/list.txt'];

    const path1 = getFilterCachePath(customUrls1);
    const path2 = getFilterCachePath(customUrls2);

    assert(path1.includes('adblock_cache_'), 'Custom recipe must generate a hash-suffixed cache filename');
    assert.equal(path1, path2, 'Sorted URLs must produce identical deterministic cache path');

    console.log('✓ Deterministic recipe cache hashing verified');
}

// 4. Hot-Swapping across Mock Sessions
(async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-hotswap-test-'));
    try {
        const securitySource = fs.readFileSync(path.join(__dirname, '../security.js'), 'utf8');

        let builds = 0;
        let release;

        const fakeRules = [
            'example.com##.banner',
            '||adserver.example^\n@@||allowed.adserver.example^'
        ];

        const fakeEngine = {
            serialize: () => Buffer.from('mock-cache'),
            updateFromDiff: () => {},
            getFilters: () => ({
                networkFilters: [{ hostname: 'adserver.example' }],
                cosmeticFilters: [{ selector: '.banner' }]
            }),
            enableBlockingInSession: (session) => {
                session.enabled = true;
            },
            disableBlockingInSession: (session) => {
                session.enabled = false;
            },
            isBlockingEnabled: (session) => Boolean(session.enabled),
            onBeforeRequest: (details, callback) => {
                if (details.url.includes('adserver.example')) {
                    callback({ cancel: true });
                } else {
                    callback({});
                }
            },
            onHeadersReceived: (details, callback) => callback({ responseHeaders: details.responseHeaders })
        };

        const context = {
            module: { exports: {} },
            __dirname: path.resolve(__dirname, '..'),
            console: { warn() {}, error() {}, log() {} },
            process,
            require: (id) => {
                if (id === 'electron') {
                    return {
                        app: { getPath: () => temporary },
                        ipcMain: { removeHandler() {} }
                    };
                }
                if (id === './adblocker-build') {
                    const fn = (opts) => {
                        builds++;
                        return Promise.resolve({
                            blocker: fakeEngine,
                            cacheBytes: Buffer.from('mock-cache'),
                            urls: opts ? ['https://custom.filter'] : adsAndTrackingLists
                        });
                    };
                    fn.resolveListUrls = () => ['https://mock.recipe'];
                    return fn;
                }
                if (id === '@ghostery/adblocker-electron') {
                    return {
                        ElectronBlocker: {
                            deserialize: () => fakeEngine
                        },
                        adsAndTrackingLists
                    };
                }
                return require(id);
            }
        };

        vm.createContext(context);
        vm.runInContext(securitySource, context);

        const mockSessions = Array.from({ length: 3 }, () => {
            const handlers = {};
            return {
                handlers,
                enabled: false,
                webRequest: {
                    onBeforeRequest: (_filter, handler) => { handlers.before = handler; },
                    onHeadersReceived: (_filter, handler) => { handlers.headers = handler; }
                }
            };
        });

        // Initialize adblocker in mock sessions
        for (const sess of mockSessions) {
            context.module.exports.hardenSession(sess);
            await context.initialiseAdblocker(sess);
            assert.equal(sess.enabled, true, 'Session must have blocking enabled');
        }

        // Test request blocking via attachNetworkHandlers
        let blocked = false;
        mockSessions[0].handlers.before(
            { url: 'https://adserver.example/banner.js', resourceType: 'script' },
            (res) => { if (res.cancel) blocked = true; }
        );
        assert.equal(blocked, true, 'Matching network request must be blocked');

        let allowed = false;
        mockSessions[0].handlers.before(
            { url: 'https://clean-site.org/index.html', resourceType: 'mainFrame' },
            (res) => { if (!res.cancel) allowed = true; }
        );
        assert.equal(allowed, true, 'Clean network request must be allowed');

        // Hot-swap adblocker with new subscription options
        const swapResult = await context.module.exports.reloadAdblocker(
            { easylist: true, easyprivacy: true, annoyances: true },
            mockSessions
        );

        assert.equal(swapResult.success, true, 'Hot-swap reload must succeed');
        assert.equal(swapResult.ruleCount, 2, 'Rule count must reflect active engine filters');

        // Verify all sessions remain protected after hot-swap
        for (const sess of mockSessions) {
            assert.equal(sess.enabled, true, 'Session must remain protected after hot-swap');
        }

        console.log('✓ Dynamic session hot-swapping and network handler delegation verified');
    } finally {
        try { fs.rmSync(temporary, { recursive: true, force: true }); } catch (_) {}
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
