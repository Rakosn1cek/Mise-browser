// tests/webview-attach-security.test.js
// Regression tests for webview attachment hardening, preload pinning, and partition/src validation

const assert = require('assert');
const path = require('path');

// Mock minimal electron requirements if running in standalone Node
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'electron') {
        return {
            app: {
                getPath: () => path.join(__dirname, '..')
            },
            ipcMain: {
                handle: () => {},
                on: () => {}
            }
        };
    }
    return origRequire.apply(this, arguments);
};

const security = require('../security.js');

console.log('Running Mise webview attach security tests...');

const pinnedPreload = path.join(__dirname, '..', 'webview-preload.js');

// 1. Hostile preferences and preload pinning
{
    const webPreferences = {
        preload: '/tmp/evil.js',
        preloadURL: 'file:///tmp/evil.js',
        nodeIntegration: true,
        nodeIntegrationInSubFrames: true,
        nodeIntegrationInWorker: true,
        sandbox: false,
        contextIsolation: false,
        webSecurity: false,
        allowRunningInsecureContent: true,
        webviewTag: true,
        partition: 'persist:work'
    };
    const params = {
        src: 'https://a.com/',
        preload: '/tmp/evil.js'
    };

    const decision = security.prepareWebviewAttach(webPreferences, params, { preloadPath: pinnedPreload });

    assert.strictEqual(decision.allowed, true, 'Valid webview attach should be allowed');
    assert.strictEqual(decision.reason, '', 'Allowed attach reason must be empty string');
    assert.strictEqual(webPreferences.preload, pinnedPreload, 'webPreferences preload must be pinned');
    assert.strictEqual(params.preload, pinnedPreload, 'params preload must be overwritten with pinned path');
    assert.strictEqual(webPreferences.preloadURL, undefined, 'preloadURL must be deleted');
    assert.strictEqual(webPreferences.nodeIntegration, false, 'nodeIntegration must be false');
    assert.strictEqual(webPreferences.nodeIntegrationInSubFrames, false, 'nodeIntegrationInSubFrames must be false');
    assert.strictEqual(webPreferences.nodeIntegrationInWorker, false, 'nodeIntegrationInWorker must be false');
    assert.strictEqual(webPreferences.sandbox, true, 'sandbox must be true');
    assert.strictEqual(webPreferences.contextIsolation, true, 'contextIsolation must be true');
    assert.strictEqual(webPreferences.webSecurity, true, 'webSecurity must be true');
    assert.strictEqual(webPreferences.allowRunningInsecureContent, false, 'allowRunningInsecureContent must be false');
    assert.strictEqual(webPreferences.webviewTag, false, 'webviewTag must be false');

    console.log('✓ Hostile webPreferences hardening and preload pinning verified');
}

// 2. Partition validation allowlist and rejection
{
    const allowedPartitions = ['persist:default', 'persist:my-workspace_2', 'MisePrivateProfile'];
    for (const partition of allowedPartitions) {
        const wp = { partition };
        const params = { src: 'https://example.com' };
        const res = security.prepareWebviewAttach(wp, params, { preloadPath: pinnedPreload });
        assert.strictEqual(res.allowed, true, `Partition "${partition}" should be allowed`);
        assert.strictEqual(res.reason, '', 'Allowed reason should be empty');
    }

    const rejectedPartitions = [undefined, '', 'persist:', '../x', 'a/b', 'persist:a b', 'x'.repeat(201)];
    for (const partition of rejectedPartitions) {
        const wp = { partition };
        const params = { src: 'https://example.com' };
        const res = security.prepareWebviewAttach(wp, params, { preloadPath: pinnedPreload });
        assert.strictEqual(res.allowed, false, `Partition "${partition}" should be rejected`);
        assert.strictEqual(res.reason, 'partition', 'Rejected partition reason must be "partition"');
    }

    console.log('✓ Partition validation allowlist and format bounds verified');
}

// 3. Webview source URL scheme validation
{
    const allowedSrcs = ['', undefined, 'https://a.com', 'http://a.com/x', 'file:///tmp/a.pdf', 'about:blank'];
    for (const src of allowedSrcs) {
        const wp = { partition: 'persist:default' };
        const params = { src };
        const res = security.prepareWebviewAttach(wp, params, { preloadPath: pinnedPreload });
        assert.strictEqual(res.allowed, true, `Source "${src}" should be allowed`);
        assert.strictEqual(res.reason, '', 'Allowed reason should be empty');
    }

    const rejectedSrcs = [
        'javascript:alert(1)',
        'data:text/html,x',
        'blob:https://a.com/x',
        'chrome://gpu',
        'devtools://devtools/x',
        'vbscript:x',
        'garbage'
    ];
    for (const src of rejectedSrcs) {
        const wp = { partition: 'persist:default' };
        const params = { src };
        const res = security.prepareWebviewAttach(wp, params, { preloadPath: pinnedPreload });
        assert.strictEqual(res.allowed, false, `Source "${src}" should be rejected`);
        assert.strictEqual(res.reason, 'src', 'Rejected source reason must be "src"');
    }

    console.log('✓ Source URL scheme filtering verified');
}

console.log('All webview attach security tests passed successfully!');
