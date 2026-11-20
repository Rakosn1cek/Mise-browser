const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running Mise Phase 4 cleanup and documentation sync regression tests...');

const REPO_ROOT = path.resolve(__dirname, '..');

async function runTests() {
    // LOW-01: Remove duplicate bubble-webview-key listener from main.js whilst preserving main/windowManager.js
    {
        const mainSrc = fs.readFileSync(path.join(REPO_ROOT, 'main.js'), 'utf8');
        const wmSrc = fs.readFileSync(path.join(REPO_ROOT, 'main/windowManager.js'), 'utf8');
        assert.strictEqual(mainSrc.includes("ipcMain.on('bubble-webview-key'"), false, 'Expected duplicate bubble-webview-key removed from main.js');
        assert.ok(wmSrc.includes("ipcMain.on('bubble-webview-key'"), 'Expected canonical bubble-webview-key retained in main/windowManager.js');
        console.log('✓ LOW-01: Single bubble-webview-key IPC registration verified');
    }

    // LOW-02: Legacy permission helpers deprecated & fail closed for sensitive permissions
    {
        const securitySrc = fs.readFileSync(path.join(REPO_ROOT, 'security.js'), 'utf8');
        assert.ok(securitySrc.includes('@deprecated Legacy permission helper'), 'Expected decidePermission annotated as @deprecated');
        assert.ok(securitySrc.includes('@deprecated Legacy permission trust helper'), 'Expected isPermissionTrustedRequest annotated as @deprecated');

        const Module = require('module');
        const origLoad = Module._load;
        Module._load = function (request) {
            if (request === 'electron') {
                return {
                    app: { getPath: () => require('os').tmpdir() },
                    ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {} },
                    session: { fromPartition: () => ({}) }
                };
            }
            return origLoad.apply(this, arguments);
        };
        const absSec = path.join(REPO_ROOT, 'security.js');
        delete require.cache[absSec];
        let security;
        try {
            security = require(absSec);
        } finally {
            Module._load = origLoad;
        }
        assert.strictEqual(security.decidePermission('media', { trusted: true }), false);
        assert.strictEqual(security.decidePermission('geolocation', { trusted: true }), false);
        assert.strictEqual(security.decidePermission('clipboard-read', { trusted: true }), false);
        assert.strictEqual(security.decidePermission('fullscreen', { trusted: false }), true);
        console.log('✓ LOW-02: Deprecated legacy permission helpers fail closed for sensors');
    }

    // LOW-03: Dead code removal and launchEmailComposer version string fix
    {
        const navSrc = fs.readFileSync(path.join(REPO_ROOT, 'modules/navigation.js'), 'utf8');
        assert.strictEqual(navSrc.includes('checkTerminalCmd'), false, 'Expected dead checkTerminalCmd fallback removed');
        assert.strictEqual(navSrc.includes('prepTerminalCmd'), false, 'Expected dead prepTerminalCmd fallback removed');

        const webviewSrc = fs.readFileSync(path.join(REPO_ROOT, 'modules/webview.js'), 'utf8');
        assert.strictEqual(webviewSrc.includes('applyCSSThemeToView'), false, 'Expected unused applyCSSThemeToView removed');

        const cpSrc = fs.readFileSync(path.join(REPO_ROOT, 'modules/overlays/commandPalette.js'), 'utf8');
        assert.ok(
            cpSrc.includes("appVer = (typeof v === 'object' && v.version) ? v.version : String(v)"),
            'Expected launchEmailComposer to extract v.version instead of interpolating [object Object]'
        );
        console.log('✓ LOW-03: Dead fallbacks removed and launchEmailComposer version formatting verified');
    }

    // LOW-04: SECURITY.md & docs/guide/security-policy.md aligned with runtime architecture
    {
        const secMd = fs.readFileSync(path.join(REPO_ROOT, 'SECURITY.md'), 'utf8');
        const docPolicyMd = fs.readFileSync(path.join(REPO_ROOT, 'docs/guide/security-policy.md'), 'utf8');

        for (const [label, content] of [['SECURITY.md', secMd], ['docs/guide/security-policy.md', docPolicyMd]]) {
            assert.strictEqual(content.includes('guest-webview-open-url'), false, `${label} must not reference non-existent guest-webview-open-url`);
            assert.strictEqual(content.includes('mise_ws_'), false, `${label} must not reference outdated persist:mise_ws_ partition naming`);
            assert.ok(content.includes('persist:<clean-workspace-name>'), `${label} must document persist:<clean-workspace-name> partition naming`);
            assert.ok(content.includes('GUEST_CHANNELS'), `${label} must document GUEST_CHANNELS allowlist`);
        }
        console.log('✓ LOW-04: SECURITY.md and docs/guide/security-policy.md runtime alignment verified');
    }

    console.log('\nAll Phase 4 cleanup and documentation alignment regression tests passed successfully!');
}

runTests().catch(err => {
    console.error('Phase 4 regression test failed:', err);
    process.exit(1);
});
