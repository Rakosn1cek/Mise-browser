const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

console.log('Running Mise Phase 3 security hardening regression tests...');

const REPO_ROOT = path.resolve(__dirname, '..');

function loadWithMockedElectron(moduleRelPath, { customElectron = null } = {}) {
    const absPath = path.join(REPO_ROOT, moduleRelPath);
    delete require.cache[absPath];
    const originalLoad = Module._load;

    const sessions = new Map();
    const getSess = (name) => {
        if (!sessions.has(name)) {
            sessions.set(name, { partition: name });
        }
        return sessions.get(name);
    };

    const mockElectron = customElectron || {
        app: {
            getPath: () => os.tmpdir(),
            getVersion: () => '1.7.3',
            isPackaged: false
        },
        session: { fromPartition: getSess },
        ipcMain: { handle: () => {}, removeHandler: () => {}, on: () => {} }
    };

    const adblockerBuildPath = path.join(REPO_ROOT, 'adblocker-build.js');
    const originalBuildCache = require.cache[adblockerBuildPath];
    const fakeBlocker = {
        config: { enableMutationObserver: true },
        updateFromDiff() {},
        enableBlockingInSession() {},
        isBlockingEnabled() { return true; },
        getFilters() { return { networkFilters: [], cosmeticFilters: [] }; },
        onBeforeRequest(_d, cb) { cb({}); },
        onHeadersReceived(d, cb) { cb({ responseHeaders: d.responseHeaders || {} }); }
    };
    require.cache[adblockerBuildPath] = {
        id: adblockerBuildPath,
        filename: adblockerBuildPath,
        loaded: true,
        exports: Object.assign(
            async () => ({ blocker: fakeBlocker, cacheBytes: Buffer.from('cache') }),
            { resolveListUrls: () => ['https://filters.example/list.txt'] }
        )
    };

    Module._load = function (request) {
        if (request === 'electron') return mockElectron;
        if (request === '@ghostery/adblocker-electron') {
            return { ElectronBlocker: { deserialize: () => fakeBlocker } };
        }
        return originalLoad.apply(this, arguments);
    };

    try {
        return { mod: require(absPath), mockElectron };
    } finally {
        Module._load = originalLoad;
    }
}

async function runTests() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-sec-p3-'));

    try {
        // MED-01: validatePdfAccess enforces validateLocalDocumentPath canonicalisation against symlinks
        {
            const { mod: security } = loadWithMockedElectron('security.js');
            const viewerUrl = 'file://' + path.join(REPO_ROOT, 'assets', 'pdfjs', 'viewer.html');

            const realPdf = path.join(tmpDir, 'statement.pdf');
            fs.writeFileSync(realPdf, '%PDF-1.4\n%%EOF\n', 'utf8');

            const sshDir = path.join(tmpDir, '.ssh');
            fs.mkdirSync(sshDir, { recursive: true });
            const fakeKey = path.join(sshDir, 'id_rsa');
            fs.writeFileSync(fakeKey, 'PRIVATE-KEY-MATERIAL', 'utf8');

            const evilSymlink = path.join(tmpDir, 'disguised.pdf');
            fs.symlinkSync(fakeKey, evilSymlink);

            const mintedEvil = security.mintPdfViewerUrl('file://' + evilSymlink);
            const evilToken = new URL(mintedEvil).searchParams.get('token');
            assert.throws(
                () => security.validatePdfAccess(evilToken, 'file://' + evilSymlink, viewerUrl),
                /Authorisation failure: Target local PDF path rejected/,
                'Expected symlink pointing into .ssh to be rejected by validatePdfAccess'
            );

            const validLink = path.join(tmpDir, 'link-to-statement.pdf');
            fs.symlinkSync(realPdf, validLink);
            const mintedValid = security.mintPdfViewerUrl('file://' + validLink);
            const validToken = new URL(mintedValid).searchParams.get('token');
            const resolved = security.validatePdfAccess(validToken, 'file://' + validLink, viewerUrl);
            assert.strictEqual(
                resolved,
                fs.realpathSync(realPdf),
                'Expected validatePdfAccess to return canonicalised target path for allowed PDF'
            );

            // Verify systemIpc read-pdf-data consumes canonical resolvedPdfPath
            const systemIpcSrc = fs.readFileSync(path.join(REPO_ROOT, 'main/systemIpc.js'), 'utf8');
            assert.ok(systemIpcSrc.includes('const resolvedPdfPath = security.validatePdfAccess'), 'Expected systemIpc to capture canonical path from validatePdfAccess');
            assert.ok(systemIpcSrc.includes('readFile(safePath)'), 'Expected read-pdf-data to read canonicalised path');
            assert.ok(systemIpcSrc.includes('copyFile(resolvedPdfPath || srcPath'), 'Expected save-pdf-file to copy canonicalised path');

            console.log('✓ MED-01: PDF symlink traversal guard and canonical path enforcement verified');
        }

        // MED-02: Domain and workspace site data wiping
        {
            const { mod: security } = loadWithMockedElectron('security.js');
            const removedCookies = [];
            const clearedStorageCalls = [];
            let flushedCount = 0;

            const mockSession = {
                cookies: {
                    async get(filter) {
                        if (filter.url) {
                            return [
                                { name: 'parent_sid', domain: '.bank.example', path: '/', secure: true }
                            ];
                        }
                        if (filter.domain === 'sub.bank.example') {
                            return [
                                { name: 'sub_tok', domain: 'sub.bank.example', path: '/app', secure: false },
                                { name: 'parent_sid', domain: '.bank.example', path: '/', secure: true }
                            ];
                        }
                        return [];
                    },
                    async remove(cookieUrl, name) {
                        removedCookies.push({ cookieUrl, name });
                    },
                    async flushStore() {
                        flushedCount += 1;
                    }
                },
                async clearStorageData(opts) {
                    clearedStorageCalls.push(opts);
                }
            };

            const clearedHost = await security.clearDomainSiteData(mockSession, 'https://sub.bank.example/dashboard');
            assert.strictEqual(clearedHost, 'sub.bank.example');
            assert.strictEqual(removedCookies.length, 2, 'Expected parent and subdomain cookies removed once each');
            assert.ok(removedCookies.some(c => c.name === 'parent_sid' && c.cookieUrl === 'https://bank.example/'));
            assert.ok(removedCookies.some(c => c.name === 'sub_tok' && c.cookieUrl === 'http://sub.bank.example/app'));
            assert.deepStrictEqual(clearedStorageCalls[0], {
                origin: 'https://sub.bank.example',
                storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
            });
            assert.strictEqual(flushedCount, 1);

            await security.clearWorkspaceSiteData(mockSession);
            assert.deepStrictEqual(clearedStorageCalls[1], {
                storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
            });
            assert.strictEqual(flushedCount, 2);

            const mainSrc = fs.readFileSync(path.join(REPO_ROOT, 'main.js'), 'utf8');
            assert.ok(mainSrc.includes('security.clearDomainSiteData'), 'Expected clear-domain-cookies to invoke clearDomainSiteData');
            assert.ok(mainSrc.includes('security.clearWorkspaceSiteData'), 'Expected clear-workspace-cookies to invoke clearWorkspaceSiteData');

            console.log('✓ MED-02: Comprehensive domain and workspace cookie/storage wiping verified');
        }

        // MED-03: Outgoing Referer sanitisation on cross-origin and downgraded requests
        {
            let beforeSendCb = null;
            const { mod: security } = loadWithMockedElectron('security.js', {
                customElectron: {
                    app: { getPath: () => tmpDir, getVersion: () => '1.7.3', isPackaged: false },
                    session: { fromPartition: () => ({}) },
                    ipcMain: { handle: () => {}, removeHandler: () => {}, on: () => {} }
                }
            });

            const mockSess = {
                webRequest: {
                    onBeforeSendHeaders(cb) { beforeSendCb = cb; },
                    onBeforeRequest() {},
                    onHeadersReceived() {}
                }
            };
            security.hardenSession(mockSess, 'en-GB');
            await security.initialiseAdblocker(mockSess);
            assert.ok(beforeSendCb, 'Expected onBeforeSendHeaders listener registered');

            // Cross-origin HTTPS -> HTTPS truncates to origin/
            beforeSendCb(
                { url: 'https://tracker.thirdparty.example/collect', requestHeaders: { Referer: 'https://bank.example/reset?token=secret99' } },
                (res) => {
                    assert.strictEqual(res.requestHeaders.Referer, 'https://bank.example/');
                }
            );

            // HTTPS -> HTTP downgrade deletes Referer header completely
            beforeSendCb(
                { url: 'http://insecure.example/pixel.gif', requestHeaders: { referer: 'https://bank.example/account?sid=xyz' } },
                (res) => {
                    assert.strictEqual(Object.prototype.hasOwnProperty.call(res.requestHeaders, 'referer'), false);
                }
            );

            // Same-origin HTTPS -> HTTPS preserves full Referer
            beforeSendCb(
                { url: 'https://bank.example/api/confirm', requestHeaders: { Referer: 'https://bank.example/transfer?step=2' } },
                (res) => {
                    assert.strictEqual(res.requestHeaders.Referer, 'https://bank.example/transfer?step=2');
                }
            );

            console.log('✓ MED-03: Cross-origin Referer truncation and downgrade stripping verified');
        }

        // MED-04: Deterministic ephemeral webview tagging immune to concurrent tab wakes
        {
            const appListeners = [];
            const winListeners = [];
            const privSess = { partition: 'MisePrivateProfile' };
            const stdSess = { partition: 'persist:default' };

            const { mod: policy } = loadWithMockedElectron('main/webContentsPolicy.js', {
                customElectron: {
                    session: { fromPartition: (p) => (p === 'MisePrivateProfile' ? privSess : stdSess) },
                    app: { on(ev, cb) { if (ev === 'web-contents-created') appListeners.push(cb); } }
                }
            });

            const mockWinWc = { on(ev, cb) { if (ev === 'will-attach-webview') winListeners.push(cb); } };
            policy.attachWebviewSecurityGuards(mockWinWc, {});
            policy.setupWebContentsPolicy({ on(ev, cb) { if (ev === 'web-contents-created') appListeners.push(cb); } }, {});

            // Modal registers an ephemeral preview for specific URL
            policy.markNextWebviewEphemeral('https://peek-secret.example/item');

            // Concurrent sleeping tab attaches first with a different URL
            const bgAttachParams = { src: 'https://sleeping-tab.example/home', partition: 'persist:default' };
            winListeners.forEach(fn => fn({ preventDefault() {} }, { partition: 'persist:default' }, bgAttachParams));
            const bgWc = {
                session: stdSess,
                getType: () => 'webview',
                getURL: () => 'https://sleeping-tab.example/home',
                setMaxListeners() {},
                on() {},
                setWindowOpenHandler() {}
            };
            appListeners.forEach(fn => fn({}, bgWc));
            assert.strictEqual(policy.isEphemeralWebContents(bgWc), false, 'Expected concurrent background tab NOT to steal Peek ephemeral mark');

            // Now Peek modal attaches with matching URL
            const peekAttachParams = { src: 'https://peek-secret.example/item', partition: 'persist:default' };
            winListeners.forEach(fn => fn({ preventDefault() {} }, { partition: 'persist:default' }, peekAttachParams));
            const peekWc = {
                session: stdSess,
                getType: () => 'webview',
                getURL: () => 'https://peek-secret.example/item',
                setMaxListeners() {},
                on() {},
                setWindowOpenHandler() {}
            };
            appListeners.forEach(fn => fn({}, peekWc));
            assert.strictEqual(policy.isEphemeralWebContents(peekWc), true, 'Expected Peek modal webview deterministically marked ephemeral');

            console.log('✓ MED-04: Deterministic ephemeral webview tagging free of race condition verified');
        }

        // MED-05: Spellchecker disabled automatically in MisePrivateProfile
        {
            const { mod: security, mockElectron } = loadWithMockedElectron('security.js');
            const privSession = mockElectron.session.fromPartition('MisePrivateProfile');
            const privCalls = { enabled: null, langs: null };
            privSession.setSpellCheckerEnabled = (v) => { privCalls.enabled = v; };
            privSession.setSpellCheckerLanguages = (v) => { privCalls.langs = v; };

            security.applySpellcheckerLanguage(privSession, 'en-GB');
            assert.strictEqual(privCalls.enabled, false, 'Expected spellchecker disabled on MisePrivateProfile even when language configured');
            assert.deepStrictEqual(privCalls.langs, []);

            const stdSession = mockElectron.session.fromPartition('persist:personal');
            const stdCalls = { enabled: null, langs: null };
            stdSession.setSpellCheckerEnabled = (v) => { stdCalls.enabled = v; };
            stdSession.setSpellCheckerLanguages = (v) => { stdCalls.langs = v; };

            security.applySpellcheckerLanguage(stdSession, 'en-GB');
            assert.strictEqual(stdCalls.enabled, true, 'Expected spellchecker enabled on persistent workspace session');
            assert.deepStrictEqual(stdCalls.langs, ['en-GB']);

            console.log('✓ MED-05: Private profile spellchecker lockdown verified');
        }

        console.log('\nAll Phase 3 security hardening regression tests passed successfully!');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

runTests().catch(err => {
    console.error('Phase 3 security test failed:', err);
    process.exit(1);
});
