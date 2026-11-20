const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

console.log('Running Mise Phase 2 security hardening regression tests...');

const REPO_ROOT = path.resolve(__dirname, '..');

async function runTests() {
    // HIGH-01: isEditableElement recognises payment iframes, spinbuttons, inputmode, and OTP/PIN components
    {
        const preloadSrc = fs.readFileSync(path.join(REPO_ROOT, 'webview-preload.js'), 'utf8');
        const startIdx = preloadSrc.indexOf('function isEditableElement(el)');
        const endIdx = preloadSrc.indexOf('// Deep inspection helper');
        assert.ok(startIdx !== -1 && endIdx !== -1 && endIdx > startIdx, 'Could not locate isEditableElement in webview-preload.js');

        const fnSrc = preloadSrc.slice(startIdx, endIdx);
        const ctx = {};
        vm.createContext(ctx);
        vm.runInContext(fnSrc, ctx);

        const makeEl = (tagName, attrs = {}, extra = {}) => ({
            nodeType: 1,
            tagName,
            type: extra.type || '',
            isContentEditable: !!extra.isContentEditable,
            contentEditable: extra.contentEditable || 'inherit',
            getAttribute: (k) => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null),
            hasAttribute: (k) => Object.prototype.hasOwnProperty.call(attrs, k),
            closest: extra.closest || (() => null)
        });

        assert.strictEqual(ctx.isEditableElement(makeEl('IFRAME')), true, 'Expected cross-origin IFRAME to count as editable');
        assert.strictEqual(ctx.isEditableElement(makeEl('OBJECT')), true, 'Expected OBJECT element to count as editable');
        assert.strictEqual(ctx.isEditableElement(makeEl('EMBED')), true, 'Expected EMBED element to count as editable');
        assert.strictEqual(ctx.isEditableElement(makeEl('DIV', { role: 'spinbutton' })), true, 'Expected role=spinbutton to count as editable');
        assert.strictEqual(ctx.isEditableElement(makeEl('DIV', { inputmode: 'numeric' })), true, 'Expected inputmode=numeric to count as editable');
        assert.strictEqual(ctx.isEditableElement(makeEl('DIV', { inputmode: 'none' })), false, 'Expected inputmode=none not to count as editable');
        assert.strictEqual(ctx.isEditableElement(makeEl('BANK-OTP-INPUT')), true, 'Expected OTP custom element to count as editable');
        assert.strictEqual(ctx.isEditableElement(makeEl('STRIPE-CARD-ELEMENT')), true, 'Expected CARD custom element to count as editable');
        assert.strictEqual(ctx.isEditableElement(makeEl('PAY-PIN-BOX')), true, 'Expected PIN custom element to count as editable');
        assert.strictEqual(ctx.isEditableElement(makeEl('DIV', { autocomplete: 'one-time-code' })), true, 'Expected non-form autocomplete element to count as editable');
        assert.strictEqual(ctx.isEditableElement(makeEl('FORM', { autocomplete: 'off' })), false, 'Expected form autocomplete=off not to count as editable');
        assert.strictEqual(ctx.isEditableElement(makeEl('BUTTON')), false, 'Expected BUTTON not to count as editable');

        console.log('✓ HIGH-01: Payment iframes, spinbuttons, inputmode, and OTP/PIN components recognised as editable');
    }

    // HIGH-02: Same-path distinct-query popups (3DS/statements) allowed and partition isolated
    {
        const policyPath = path.join(REPO_ROOT, 'main/webContentsPolicy.js');
        delete require.cache[policyPath];
        const originalLoad = Module._load;

        const sentMessages = [];
        const attachedListeners = [];
        const createdListeners = [];
        const sessionCache = new Map();
        const getMockSession = (part) => {
            if (!sessionCache.has(part)) sessionCache.set(part, { partition: part });
            return sessionCache.get(part);
        };

        const mockElectron = {
            session: { fromPartition: getMockSession },
            app: {
                on(ev, cb) {
                    if (ev === 'web-contents-created') createdListeners.push(cb);
                }
            }
        };

        Module._load = function (request) {
            if (request === 'electron') return mockElectron;
            return originalLoad.apply(this, arguments);
        };

        let policy;
        try {
            policy = require(policyPath);
        } finally {
            Module._load = originalLoad;
        }

        const mockMainWin = {
            webContents: {
                on(ev, cb) { attachedListeners.push({ ev, cb }); },
                send(...args) { sentMessages.push(args); }
            }
        };

        policy.attachWebviewSecurityGuards(mockMainWin.webContents, {});
        policy.setupWebContentsPolicy(mockElectron.app, { getMainWindow: () => mockMainWin });

        // Simulate attaching banking partition webview
        const willAttach = attachedListeners.find(l => l.ev === 'will-attach-webview');
        assert.ok(willAttach, 'Expected will-attach-webview listener');
        willAttach.cb({ preventDefault() {} }, { partition: 'persist:banking' }, { src: 'https://bank.example/portal' });

        // Helper to spawn mock webview webContents
        function createMockWebview(partitionName, currentUrl) {
            let openHandler = null;
            const wc = {
                session: getMockSession(partitionName),
                getType: () => 'webview',
                setMaxListeners() {},
                on() {},
                getURL: () => currentUrl,
                getTitle: () => 'Bank',
                setWindowOpenHandler(fn) { openHandler = fn; }
            };
            createdListeners.forEach(cb => cb({}, wc));
            return openHandler;
        }

        const bankHandler = createMockWebview('persist:banking', 'https://bank.example/portal');
        assert.ok(bankHandler, 'Expected setWindowOpenHandler registered');

        // Exact duplicate URL + query must still be denied
        sentMessages.length = 0;
        const dupRes = bankHandler({ url: 'https://bank.example/portal' });
        assert.strictEqual(dupRes.action, 'deny');
        assert.strictEqual(sentMessages.length, 0, 'Expected identical origin+pathname+search popup suppressed');

        // Query-distinct popup on same path (3DS challenge) must dispatch with banking partition
        const challengeRes = bankHandler({ url: 'https://bank.example/portal?action=3ds_challenge' });
        assert.strictEqual(challengeRes.action, 'deny');
        assert.strictEqual(sentMessages.length, 1);
        assert.deepStrictEqual(
            sentMessages[0],
            ['master-shortcut', 'spawn-tab-with-url', 'https://bank.example/portal?action=3ds_challenge', 'persist:banking'],
            'Expected 3DS popup dispatched with opener banking partition'
        );

        // Private webview popup must include MisePrivateProfile partition
        sentMessages.length = 0;
        const privHandler = createMockWebview('MisePrivateProfile', 'https://shop.example/checkout');
        privHandler({ url: 'https://shop.example/checkout?step=3ds' });
        assert.strictEqual(sentMessages.length, 1);
        assert.deepStrictEqual(
            sentMessages[0],
            ['master-shortcut', 'spawn-tab-with-url', 'https://shop.example/checkout?step=3ds', 'MisePrivateProfile'],
            'Expected Private popup tagged with MisePrivateProfile partition'
        );

        // Verify modules/webview.js & renderer.js wiring for opener partition routing
        const webviewSrc = fs.readFileSync(path.join(REPO_ROOT, 'modules/webview.js'), 'utf8');
        assert.ok(
            webviewSrc.includes('cur.origin === tgt.origin && cur.pathname === tgt.pathname && cur.search === tgt.search'),
            'Expected modules/webview.js new-window listener to compare cur.search === tgt.search'
        );
        assert.ok(
            webviewSrc.includes('export function spawnTabWithUrl(url, targetPartition = null)'),
            'Expected spawnTabWithUrl to accept targetPartition'
        );
        const rendererSrc = fs.readFileSync(path.join(REPO_ROOT, 'renderer.js'), 'utf8');
        assert.ok(
            rendererSrc.includes("case 'spawn-tab-with-url': spawnTabWithUrl(args[0], args[1]); break;"),
            'Expected renderer.js to forward opener partition arg to spawnTabWithUrl'
        );

        console.log('✓ HIGH-02: Query-distinct popups allowed and partition isolation enforced');
    }

    // HIGH-03: Save Image As uses guest webContents & Share via Email does not clobber clipboard
    {
        const ctxMenuPath = path.join(REPO_ROOT, 'main/contextMenus.js');
        delete require.cache[ctxMenuPath];
        const originalLoad = Module._load;

        let clipboardWrites = [];
        const createdMenus = [];

        class MockMenuItem {
            constructor(opts) { Object.assign(this, opts); }
        }
        class MockMenu {
            constructor() { this.items = []; createdMenus.push(this); }
            append(item) { this.items.push(item); }
            popup() {}
        }

        const mockElectron = {
            Menu: MockMenu,
            MenuItem: MockMenuItem,
            clipboard: {
                writeText(txt) { clipboardWrites.push(txt); }
            },
            shell: { openExternal: async () => {} }
        };

        Module._load = function (request) {
            if (request === 'electron') return mockElectron;
            if (request === './config') {
                return { loadBrowserConfig: () => ({ email_handler: 'system' }), buildEmailComposeUrl: () => 'mailto:test' };
            }
            return originalLoad.apply(this, arguments);
        };

        let contextMenus;
        try {
            contextMenus = require(ctxMenuPath);
        } finally {
            Module._load = originalLoad;
        }

        const winDownloads = [];
        const guestDownloads = [];
        const mockWin = {
            isDestroyed: () => false,
            webContents: { downloadURL: (u) => winDownloads.push(u), send() {} }
        };
        const mockGuest = {
            downloadURL: (u) => guestDownloads.push(u),
            getTitle: () => 'Bank Receipt',
            getURL: () => 'https://bank.example/receipt',
            isDestroyed: () => false
        };

        // 3a. Valid image Save Image As uses guest webContents
        createdMenus.length = 0;
        contextMenus.showWebviewContextMenu(
            {},
            { mediaType: 'image', srcURL: 'https://bank.example/qr.png', pageURL: 'https://bank.example/2fa' },
            mockGuest,
            { getMainWindow: () => mockWin }
        );
        const rootMenu = createdMenus[0];
        const saveItem = rootMenu.items.find(i => i.label === 'Save Image As...');
        assert.ok(saveItem, 'Expected Save Image As... item');
        saveItem.click();
        assert.deepStrictEqual(guestDownloads, ['https://bank.example/qr.png'], 'Expected downloadURL invoked on guest webContents');
        assert.strictEqual(winDownloads.length, 0, 'Expected win.webContents.downloadURL never called');

        // 3b. Unsafe srcURL rejected cleanly
        createdMenus.length = 0;
        guestDownloads.length = 0;
        contextMenus.showWebviewContextMenu(
            {},
            { mediaType: 'image', srcURL: 'file:///etc/passwd', pageURL: 'https://bank.example/2fa' },
            mockGuest,
            { getMainWindow: () => mockWin }
        );
        const unsafeSave = createdMenus[0].items.find(i => i.label === 'Save Image As...');
        unsafeSave.click();
        assert.strictEqual(guestDownloads.length, 0, 'Expected file: image URL rejected before downloadURL');

        // 3c. Share via Email must not clobber clipboard
        clipboardWrites = [];
        createdMenus.length = 0;
        contextMenus.showWebviewContextMenu(
            {},
            { selectionText: 'SENSITIVE-CARD-4111', pageURL: 'https://shop.example/checkout' },
            mockGuest,
            { getMainWindow: () => mockWin }
        );
        const shareParent = createdMenus[0].items.find(i => i.label === 'Share...');
        assert.ok(shareParent && shareParent.submenu, 'Expected Share submenu');
        const emailItem = shareParent.submenu.items.find(i => i.label === 'Share via Email');
        assert.ok(emailItem, 'Expected Share via Email item');
        emailItem.click();
        assert.strictEqual(clipboardWrites.length, 0, 'Expected Share via Email never to overwrite clipboard');

        console.log('✓ HIGH-03: Save Image As scoped to guest session and clipboard preserved on Share via Email');
    }

    // HIGH-04: Anti-fingerprint prototype toString masking, no global flag, no Europe/London timezone override
    {
        const preloadSrc = fs.readFileSync(path.join(REPO_ROOT, 'webview-preload.js'), 'utf8');
        assert.ok(!preloadSrc.includes('__miseFingerprintPatchesApplied'), 'Expected global __miseFingerprintPatchesApplied removed');
        assert.ok(!preloadSrc.includes("res.timeZone = 'Europe/London'"), 'Expected hardcoded Europe/London timezone override removed');

        const marker = 'const codeToInject = `';
        const s = preloadSrc.indexOf(marker);
        const e = preloadSrc.indexOf('\n    try {\n        webFrame.executeJavaScript(codeToInject);', s);
        assert.ok(s !== -1 && e !== -1, 'Could not locate codeToInject template in webview-preload.js');

        const templateBody = preloadSrc.slice(s + marker.length, preloadSrc.lastIndexOf('`;', e));
        const injectedCode = templateBody.replace('${webrtcBlockScript}', '');

        function OrigToDataURL() { return 'data:image/png;base64,orig'; }
        function OrigToBlob() {}
        function OrigGetImageData() { return { data: new Uint8ClampedArray(16) }; }
        function OrigGetParam() { return 'native'; }
        function OrigGetExt() { return null; }
        function OrigGetSupportedExt() { return ['EXT_a', 'EXT_b']; }
        function OrigGetChannelData() { return new Float32Array(200); }
        function OrigResolvedOptions() { return { timeZone: 'America/New_York' }; }

        const mockCtx = {
            window: { location: { hostname: 'shop.example' } },
            navigator: {
                userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/132.0.1.2 Electron/33.0 mise-browser/1.7.3',
                plugins: [{ description: 'PDF Plugin' }],
                userAgentData: { brands: [] }
            },
            HTMLCanvasElement: { prototype: { toDataURL: OrigToDataURL, toBlob: OrigToBlob } },
            CanvasRenderingContext2D: { prototype: { getImageData: OrigGetImageData } },
            WebGLRenderingContext: { prototype: { getParameter: OrigGetParam, getExtension: OrigGetExt, getSupportedExtensions: OrigGetSupportedExt } },
            AudioBuffer: { prototype: { getChannelData: OrigGetChannelData } },
            Intl: { DateTimeFormat: { prototype: { resolvedOptions: OrigResolvedOptions } } }
        };
        mockCtx.window = Object.assign(mockCtx.window, {
            navigator: mockCtx.navigator
        });
        vm.createContext(mockCtx);
        vm.runInContext(injectedCode, mockCtx);

        assert.strictEqual(Object.prototype.hasOwnProperty.call(mockCtx.window, '__miseFingerprintPatchesApplied'), false);
        assert.strictEqual(mockCtx.Intl.DateTimeFormat.prototype.resolvedOptions().timeZone, 'America/New_York');
        const maskedStrings = vm.runInContext(`({
            toDataURL: HTMLCanvasElement.prototype.toDataURL.toString(),
            fnToStringToDataURL: Function.prototype.toString.call(HTMLCanvasElement.prototype.toDataURL),
            getImageData: CanvasRenderingContext2D.prototype.getImageData.toString(),
            getParameter: WebGLRenderingContext.prototype.getParameter.toString(),
            getChannelData: AudioBuffer.prototype.getChannelData.toString(),
            fnToStringSelf: Function.prototype.toString.toString()
        })`, mockCtx);
        assert.strictEqual(maskedStrings.toDataURL, 'function toDataURL() { [native code] }');
        assert.strictEqual(maskedStrings.fnToStringToDataURL, 'function toDataURL() { [native code] }');
        assert.strictEqual(maskedStrings.getImageData, 'function getImageData() { [native code] }');
        assert.strictEqual(maskedStrings.getParameter, 'function getParameter() { [native code] }');
        assert.strictEqual(maskedStrings.getChannelData, 'function getChannelData() { [native code] }');
        assert.strictEqual(maskedStrings.fnToStringSelf, 'function toString() { [native code] }');

        console.log('✓ HIGH-04: Native function masking, global flag removal, and timezone consistency verified');
    }

    // HIGH-05: Subframe trusted_certificates guard, ephemeral public MITM exceptions, and TLS EXCEPTION badge
    {
        const security = require('../security.js');
        security.setTrustedCertificates(['public-mitm.example']);
        assert.strictEqual(
            security.isCertificateAllowed('https://public-mitm.example/login', { isMainFrame: true, topLevelUrl: '' }),
            true,
            'Expected top-level trusted certificate allowed'
        );
        assert.strictEqual(
            security.isCertificateAllowed('https://public-mitm.example/subframe', { isMainFrame: false, topLevelUrl: 'https://public-mitm.example/app' }),
            true,
            'Expected same-origin subframe allowed'
        );
        assert.strictEqual(
            security.isCertificateAllowed('https://public-mitm.example/steal', { isMainFrame: false, topLevelUrl: 'https://evil-site.example/' }),
            false,
            'Expected cross-origin subframe onto trusted certificate blocked'
        );
        security.setTrustedCertificates([]);

        // Verify trust-certificate-host persists only local/private hosts
        const systemIpcPath = path.join(REPO_ROOT, 'main/systemIpc.js');
        delete require.cache[systemIpcPath];
        const originalLoad = Module._load;
        const handlers = {};
        const syncHandlers = {};
        const persistedWrites = [];
        let inMemTrusted = [];

        const mockElectron = {
            app: { getPath: () => '/tmp', getVersion: () => '1.7.3', isPackaged: false },
            clipboard: { writeText() {} },
            dialog: {},
            shell: {},
            ipcMain: {
                handle(ch, cb) { handlers[ch] = cb; },
                on(ch, cb) { syncHandlers[ch] = cb; }
            }
        };

        Module._load = function (request) {
            if (request === 'electron') return mockElectron;
            if (request === './config') {
                return {
                    loadBrowserConfig: () => ({ trusted_certificates: [...inMemTrusted] }),
                    writeConfigFile: (cfg) => {
                        persistedWrites.push(cfg);
                        inMemTrusted = [...cfg.trusted_certificates];
                    }
                };
            }
            return originalLoad.apply(this, arguments);
        };

        const configModulePath = path.join(REPO_ROOT, 'main/config.js');
        const originalConfigCache = require.cache[configModulePath];
        require.cache[configModulePath] = {
            id: configModulePath,
            filename: configModulePath,
            loaded: true,
            exports: {
                loadBrowserConfig: () => ({ trusted_certificates: [...inMemTrusted] }),
                writeConfigFile: (cfg) => {
                    persistedWrites.push(cfg);
                    inMemTrusted = [...cfg.trusted_certificates];
                }
            }
        };

        let systemIpc;
        try {
            systemIpc = require(systemIpcPath);
        } finally {
            Module._load = originalLoad;
        }
        systemIpc.registerSystemIpc(mockElectron.ipcMain, {});

        try {
            // Public MITM override stays ephemeral in memory only
            await handlers['trust-certificate-host']({}, 'public-mitm.example');
            assert.strictEqual(persistedWrites.length, 0, 'Expected public host cert override NOT written to config.json');
            assert.ok(security.getTrustedCertificates().includes('public-mitm.example'));

            // Sync check reports trusted exception host
            const checkEvent = { returnValue: null };
            syncHandlers['is-certificate-trusted-host'](checkEvent, 'public-mitm.example:443');
            assert.strictEqual(checkEvent.returnValue, true, 'Expected is-certificate-trusted-host to match exception host');

            // Local private host override persists to config.json
            await handlers['trust-certificate-host']({}, '192.168.1.50:8443');
            assert.strictEqual(persistedWrites.length, 1, 'Expected local/private cert override persisted to config.json');
            assert.ok(persistedWrites[0].trusted_certificates.includes('192.168.1.50:8443'));
        } finally {
            if (originalConfigCache) {
                require.cache[configModulePath] = originalConfigCache;
            } else {
                delete require.cache[configModulePath];
            }
        }
        security.setTrustedCertificates([]);

        // Status bar shows TLS EXCEPTION instead of green HTTPS lock for trusted_certificates public hosts
        const elements = {
            StatusBarSecurity: { innerHTML: '', className: '', title: '' }
        };
        const sbCtx = {
            URL,
            escapeHtml: (s) => s,
            document: { getElementById: (id) => elements[id] },
            window: {
                addEventListener() {},
                miseAPI: {
                    isLocalOrPrivateHost: () => false,
                    isCertificateTrustedHost: (h) => h === 'public-mitm.example'
                }
            },
            state: {},
            getWorkspacePartition: () => 'persist:default',
            isSplitActive: () => false,
            getSplitState: () => ({})
        };
        vm.createContext(sbCtx);
        const sbSrc = fs.readFileSync(path.join(REPO_ROOT, 'modules/statusBar.js'), 'utf8')
            .replace(/^import .*$/gm, '')
            .replace(/export /g, '');
        vm.runInContext(sbSrc, sbCtx);

        sbCtx.updateSecurityStatus('https://public-mitm.example/login');
        assert.ok(elements.StatusBarSecurity.innerHTML.includes('TLS EXCEPTION'), 'Expected TLS EXCEPTION badge instead of green HTTPS lock');
        assert.strictEqual(elements.StatusBarSecurity.className.includes('security-secure'), false, 'Expected exception host not styled as security-secure');

        console.log('✓ HIGH-05: Certificate subframe isolation, ephemeral public exceptions, and TLS EXCEPTION badge verified');
    }

    console.log('\nAll Phase 2 security hardening regression tests passed successfully!');
}

runTests().catch(err => {
    console.error('Phase 2 security test failed:', err);
    process.exit(1);
});
