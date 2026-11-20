const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

console.log('Running Mise Phase 1 security hardening regression tests...');

const REPO_ROOT = path.resolve(__dirname, '..');

function loadWithMockedElectron(moduleRelPath, {
    blockerOverride = null,
    userDataDir = null,
    privatePartitionName = 'MisePrivateProfile'
} = {}) {
    const absPath = path.join(REPO_ROOT, moduleRelPath);
    delete require.cache[absPath];

    const originalLoad = Module._load;
    const mockPrivateSession = { partition: privatePartitionName };
    const mockSessions = new Map([[privatePartitionName, mockPrivateSession]]);

    const mockElectron = {
        app: {
            getPath: () => userDataDir || os.tmpdir(),
            getVersion: () => '1.7.3',
            isPackaged: false
        },
        session: {
            fromPartition: (name) => {
                if (!mockSessions.has(name)) {
                    mockSessions.set(name, { partition: name });
                }
                return mockSessions.get(name);
            }
        },
        ipcMain: {
            handle: () => {},
            removeHandler: () => {},
            on: () => {}
        },
        net: {
            fetch: async () => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) })
        },
        dialog: {
            showMessageBox: async () => ({ response: 1 })
        }
    };

    Module._load = function (request, parent, isMain) {
        if (request === 'electron') {
            return mockElectron;
        }
        if (blockerOverride && request === './adblocker-build') {
            return blockerOverride.buildFn;
        }
        if (blockerOverride && request === '@ghostery/adblocker-electron') {
            return blockerOverride.adblockerPkg;
        }
        return originalLoad.apply(this, arguments);
    };

    try {
        return {
            mod: require(absPath),
            mockElectron,
            mockPrivateSession
        };
    } finally {
        Module._load = originalLoad;
    }
}

async function runTests() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-sec-p1-'));

    try {
        // SEC-01 & SEC-02: security.js tests
        let onBeforeRequestCb = null;
        let onHeadersReceivedCb = null;
        const diffUpdates = [];
        let blockerBeforeCalls = 0;
        let blockerHeadersCalls = 0;

        const fakeBlocker = {
            config: { enableMutationObserver: true },
            updateFromDiff(payload) {
                diffUpdates.push(payload);
            },
            enableBlockingInSession() {},
            isBlockingEnabled() { return true; },
            getFilters() {
                return { networkFilters: ['a'], cosmeticFilters: [] };
            },
            onBeforeRequest(details, cb) {
                blockerBeforeCalls += 1;
                cb({});
            },
            onHeadersReceived(details, cb) {
                blockerHeadersCalls += 1;
                cb({ responseHeaders: details.responseHeaders || {} });
            }
        };

        const blockerOverride = {
            buildFn: Object.assign(
                async () => ({ blocker: fakeBlocker, cacheBytes: Buffer.from('cache') }),
                { resolveListUrls: () => ['https://filters.example/list.txt'] }
            ),
            adblockerPkg: {
                ElectronBlocker: {
                    deserialize: () => fakeBlocker
                }
            }
        };

        const adblockerBuildPath = path.join(REPO_ROOT, 'adblocker-build.js');
        const originalBuildCache = require.cache[adblockerBuildPath];
        require.cache[adblockerBuildPath] = {
            id: adblockerBuildPath,
            filename: adblockerBuildPath,
            loaded: true,
            exports: blockerOverride.buildFn
        };

        const { mod: security } = loadWithMockedElectron('security.js', {
            blockerOverride,
            userDataDir: tmpDir
        });

        // SEC-01: extractWrappedMediaUrl allows legitimate raster /media?url=... and blocks hijack/SVG vectors
        const validImg = 'https://preview.redd.it/sample-photo.png?width=640&auto=webp';
        assert.strictEqual(
            security.extractWrappedMediaUrl('https://www.reddit.com/media?url=' + encodeURIComponent(validImg)),
            validImg,
            'Expected valid raster /media?url= image to unwrap cleanly'
        );
        assert.strictEqual(
            security.extractWrappedMediaUrl('https://shop.example/checkout?next=' + encodeURIComponent('https://cdn.example/pay.png')),
            null,
            'Expected checkout redirect parameter on non-/media path to be rejected'
        );
        assert.strictEqual(
            security.extractWrappedMediaUrl('https://accounts.example/login?redirect_uri=' + encodeURIComponent('https://cdn.example/logo.png')),
            null,
            'Expected login redirect_uri parameter to be rejected'
        );
        assert.strictEqual(
            security.extractWrappedMediaUrl('https://www.reddit.com/media?next=' + encodeURIComponent(validImg)),
            null,
            'Expected non-url query parameter on /media to be rejected'
        );
        assert.strictEqual(
            security.extractWrappedMediaUrl('https://www.reddit.com/media?url=' + encodeURIComponent('https://evil.example/payload.svg')),
            null,
            'Expected SVG image payload to be rejected'
        );
        assert.strictEqual(
            security.extractWrappedMediaUrl('https://www.reddit.com/media?url=' + encodeURIComponent('https://evil.example/payload.svg?format=png')),
            null,
            'Expected .svg pathname with format=png spoofing to be rejected'
        );
        assert.strictEqual(
            security.extractWrappedMediaUrl('https://www.reddit.com/media?url=' + encodeURIComponent('https://evil.example/img?format=svg')),
            null,
            'Expected format=svg query parameter to be rejected'
        );
        assert.strictEqual(
            security.extractWrappedMediaUrl('https://www.reddit.com/media?url=' + encodeURIComponent('javascript:alert(1)')),
            null,
            'Expected javascript: URI to be rejected'
        );
        console.log('✓ SEC-01: extractWrappedMediaUrl checkout hijacking and SVG rejection verified');

        // SEC-02: Trusted Domain $document/$subdocument exceptions and subresource bypass scoping
        security.setTrustedDomains(['shop.example']);
        const mockSession = {
            webRequest: {
                onBeforeRequest(_filter, cb) { onBeforeRequestCb = cb; },
                onHeadersReceived(_filter, cb) { onHeadersReceivedCb = cb; }
            }
        };
        await security.initialiseAdblocker(mockSession);
        if (originalBuildCache) {
            require.cache[adblockerBuildPath] = originalBuildCache;
        } else {
            delete require.cache[adblockerBuildPath];
        }

        const allAdded = diffUpdates.flatMap(u => Array.isArray(u.added) ? u.added : []);
        assert.ok(allAdded.includes('@@||shop.example^$document,important'), 'Expected $document,important exception rule');
        assert.ok(allAdded.includes('@@||shop.example^$subdocument,important'), 'Expected $subdocument,important exception rule');
        assert.ok(allAdded.includes('@@||shop.example^$important'), 'Expected $important exception rule');

        // Subresource (3DS gateway) triggered inside trusted checkout page must bypass blockerInstance
        await new Promise((resolve) => {
            onBeforeRequestCb({
                url: 'https://3ds.cardnetwork.example/challenge',
                resourceType: 'subFrame',
                webContents: { getURL: () => 'https://shop.example/checkout' }
            }, (res) => {
                assert.deepStrictEqual(res, {});
                resolve();
            });
        });
        assert.strictEqual(blockerBeforeCalls, 0, 'Expected trusted page subresource to bypass onBeforeRequest blocker');

        await new Promise((resolve) => {
            onHeadersReceivedCb({
                url: 'https://3ds.cardnetwork.example/challenge',
                resourceType: 'subFrame',
                responseHeaders: { 'x-test': ['1'] },
                webContents: { getURL: () => 'https://shop.example/checkout' }
            }, (res) => {
                assert.ok(res && res.responseHeaders);
                resolve();
            });
        });
        assert.strictEqual(blockerHeadersCalls, 0, 'Expected trusted page subresource to bypass onHeadersReceived blocker');

        // Google infra (e.g. youtube.com) must NOT bypass adblocking via user trusted domain bypass
        await new Promise((resolve) => {
            onBeforeRequestCb({
                url: 'https://ads.example/script.js',
                resourceType: 'script',
                webContents: { getURL: () => 'https://www.youtube.com/watch?v=1' }
            }, () => resolve());
        });
        assert.strictEqual(blockerBeforeCalls, 1, 'Expected non-user-trusted YouTube page to remain filtered by adblocker');
        console.log('✓ SEC-02: Trusted Domain $document exceptions and third-party checkout bypass verified');

        // SEC-03: Userscripts fail-closed @match/@grant, Private isolation, bridge locking, null-proto storage
        const { mod: userContent, mockPrivateSession } = loadWithMockedElectron('userContent.js', { userDataDir: tmpDir });
        userContent.__test_setStorageDir(path.join(tmpDir, 'uc-storage'));

        // Empty @match/@include must fail closed
        userContent.__test_setLoadedContent([
            {
                name: 'NoMatch',
                filename: 'no-match.user.js',
                code: 'console.log(1);',
                meta: { name: 'NoMatch', grants: [], matches: [], includes: [], excludes: [] }
            },
            {
                name: 'Granted',
                filename: 'granted.user.js',
                code: 'console.log(2);',
                meta: {
                    name: 'Granted',
                    grants: ['gm_xmlhttprequest', 'gm_setvalue', 'gm_getvalue'],
                    matches: ['https://example.com/*'],
                    includes: [],
                    excludes: []
                }
            }
        ], []);

        const noMatchRes = userContent.getMatchingUserContent('https://bank.example/account');
        assert.strictEqual(noMatchRes.scripts.length, 0, 'Expected script with empty @match/@include to never match');

        // Lazy compilation for programmatic test mocks that omit matchRegexes
        const matchedRes = userContent.getMatchingUserContent('https://example.com/profile');
        assert.strictEqual(matchedRes.scripts.length, 1, 'Expected script with matches entry to compile lazily and match');

        // Grants validation fail-closed checks
        await assert.rejects(
            () => userContent.validateRequestDestination('https://api.example.com/data', { grants: [], allowedConnects: ['*'] }),
            /does not declare @grant GM_xmlhttpRequest/,
            'Expected empty grants array to fail closed for GM_xmlhttpRequest'
        );

        await assert.rejects(
            () => userContent.validateRequestDestination('https://api.example.com/data', { grants: ['none'], allowedConnects: ['*'] }),
            /does not declare @grant GM_xmlhttpRequest/,
            'Expected @grant none to reject GM_xmlhttpRequest'
        );

        // validateTokenSender rejects MisePrivateProfile partition sessions
        const privateTokenData = {
            token: 'tok-priv',
            scriptId: 'granted.user',
            grants: ['gm_setvalue'],
            allowedConnects: [],
            boundSenderId: null,
            pageOrigin: 'https://example.com',
            lastUsedAt: Date.now()
        };
        const privateEvent = {
            sender: {
                id: 99,
                session: mockPrivateSession,
                mainFrame: { url: 'https://example.com/login', origin: 'https://example.com' },
                getURL: () => 'https://example.com/login',
                isDestroyed: () => false,
                once: () => {}
            },
            senderFrame: null
        };
        privateEvent.senderFrame = privateEvent.sender.mainFrame;
        assert.throws(
            () => userContent.validateTokenSender(privateTokenData, privateEvent),
            /Private profile/,
            'Expected Private profile sender to be rejected by validateTokenSender'
        );

        // Verify webview-preload freezes & locks __miseGMBridge and userScriptShim uses null-prototype store
        const preloadSrc = fs.readFileSync(path.join(REPO_ROOT, 'webview-preload.js'), 'utf8');
        assert.ok(preloadSrc.includes('Object.freeze(bridge)'), 'Expected webview-preload.js to freeze __miseGMBridge');
        assert.ok(preloadSrc.includes("Object.defineProperty(window, '__miseGMBridge'"), 'Expected webview-preload.js to lock __miseGMBridge descriptor');

        const shimSrc = fs.readFileSync(path.join(REPO_ROOT, 'modules/userScriptShim.js'), 'utf8');
        assert.ok(shimSrc.includes('Object.assign(Object.create(null), __gm_initial_storage__ || {})'), 'Expected null-prototype GM storage dictionary');

        const lifecycleSrc = fs.readFileSync(path.join(REPO_ROOT, 'modules/webview/tabLifecycle.js'), 'utf8');
        assert.ok(lifecycleSrc.includes("=== 'MisePrivateProfile'"), 'Expected tabLifecycle to gate scripts in Private profile');
        assert.ok(lifecycleSrc.includes('window.miseAPI.getUserStylesForUrl'), 'Expected Private profile to inject styles only');
        console.log('✓ SEC-03: Fail-closed @match/@grant, Private isolation, bridge lock, and null-prototype storage verified');

        // SEC-04: Cross-process sessionStorage token filtering & Private profile flush blocks
        const sleepSrc = fs.readFileSync(path.join(REPO_ROOT, 'modules/webview/sleepManager.js'), 'utf8');
        assert.ok(sleepSrc.includes("=== 'MisePrivateProfile'"), 'Expected sleepManager to exclude Private profile from sleep snapshots and flush');
        assert.ok(sleepSrc.includes('token|auth|jwt|pkce'), 'Expected sleepManager to filter sensitive sessionStorage keys');

        const mainSrc = fs.readFileSync(path.join(REPO_ROOT, 'main.js'), 'utf8');
        assert.ok(mainSrc.includes("targetSession === session.fromPartition('MisePrivateProfile')"), 'Expected main.js flush-session-store to reject MisePrivateProfile');
        console.log('✓ SEC-04: Private flush block and sensitive sessionStorage token filtering verified');

        // SEC-05: 0600/0700 file permissions and URL auth/token scrubbing
        const sessionDataDir = path.join(tmpDir, 'session-data');
        const { mod: sessionStore } = loadWithMockedElectron('main/sessionStore.js', { userDataDir: sessionDataDir });
        const rawSession = {
            workspaces: {
                Banking: [
                    'https://alice:s3cr3t@bank.example/transfer?access_token=tok123&tab=overview#id_token=jwt999',
                    'https://duckduckgo.com/?q=mise'
                ],
                Private: ['https://secret-private.example/']
            },
            tab_titles: {
                Banking: ['Transfer', 'Search'],
                Private: ['Secret']
            },
            active_tabs: { Banking: 0, Private: 0 }
        };
        const sanitised = sessionStore.sanitizeSessionForDisk(rawSession);
        assert.strictEqual(sanitised.workspaces.Private, undefined, 'Expected Private workspace omitted from disk session');
        assert.strictEqual(
            sanitised.workspaces.Banking[0],
            'https://bank.example/transfer?tab=overview',
            'Expected credentials, access_token, and token hash stripped from persisted URL'
        );
        assert.strictEqual(
            sanitised.workspaces.Banking[1],
            'https://duckduckgo.com/?q=mise',
            'Expected benign search URL query preserved verbatim'
        );

        sessionStore.scheduleSessionSave(rawSession);
        assert.strictEqual(sessionStore.flushSessionToDisk(), true, 'Expected first session flush to succeed');
        sessionStore.scheduleSessionSave(rawSession);
        assert.strictEqual(sessionStore.flushSessionToDisk(), true, 'Expected second session flush to rotate backup');
        const flushedDisk = JSON.parse(fs.readFileSync(sessionStore.sessionPath, 'utf8'));
        assert.strictEqual(flushedDisk.workspaces.Banking[0], 'https://bank.example/transfer?tab=overview');
        assert.strictEqual(flushedDisk.workspaces.Private, undefined);
        if (process.platform !== 'win32') {
            assert.strictEqual(fs.statSync(sessionDataDir).mode & 0o777, 0o700, 'Expected userData directory mode 0700');
            assert.strictEqual(fs.statSync(sessionStore.sessionPath).mode & 0o777, 0o600, 'Expected session.json mode 0600');
            assert.strictEqual(fs.statSync(sessionStore.sessionBackupPath).mode & 0o777, 0o600, 'Expected session.json.bak mode 0600');
        }

        const storageDir = path.join(tmpDir, 'storage-data');
        const { mod: storage } = loadWithMockedElectron('main/storage.js', { userDataDir: storageDir });
        assert.strictEqual(
            storage.scrubSensitiveUrl('https://u:p@checkout.example/confirm?code=abc123&order=42#token=xyz'),
            'https://checkout.example/confirm?order=42',
            'Expected storage.scrubSensitiveUrl to strip credentials, code param, and token hash'
        );
        assert.strictEqual(
            storage.scrubSensitiveUrl('https://docs.example/page#section-2'),
            'https://docs.example/page#section-2',
            'Expected non-sensitive hash fragment preserved in storage.scrubSensitiveUrl'
        );

        const cfgDir = path.join(tmpDir, 'config-data');
        const cfgFile = path.join(cfgDir, 'config.json');
        const { mod: config } = loadWithMockedElectron('main/config.js', { userDataDir: cfgDir });
        config.loadBrowserConfig(cfgDir, cfgFile);
        config.updateBrowserConfig({ disable_gpu: true }, cfgDir, cfgFile);
        if (process.platform !== 'win32') {
            assert.strictEqual(fs.statSync(cfgDir).mode & 0o777, 0o700, 'Expected config directory mode 0700');
            assert.strictEqual(fs.statSync(cfgFile).mode & 0o777, 0o600, 'Expected config.json mode 0600');
        }

        const kbDir = path.join(tmpDir, 'keybind-data');
        const { mod: keybinds } = loadWithMockedElectron('keybinds.js', { userDataDir: kbDir });
        keybinds.initializeKeybinds(kbDir);
        const kbFile = path.join(kbDir, 'keybinds.json');
        if (process.platform !== 'win32') {
            assert.strictEqual(fs.statSync(kbDir).mode & 0o777, 0o700, 'Expected keybinds directory mode 0700');
            assert.strictEqual(fs.statSync(kbFile).mode & 0o777, 0o600, 'Expected keybinds.json mode 0600');
        }
        console.log('✓ SEC-05: POSIX 0600/0700 permissions and sensitive URL token scrubbing verified');
        console.log('\nAll Phase 1 security hardening regression tests passed successfully!');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

runTests().catch(err => {
    console.error('Phase 1 security test failed:', err);
    process.exit(1);
});
