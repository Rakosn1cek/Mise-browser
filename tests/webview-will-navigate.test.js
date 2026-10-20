// tests/webview-will-navigate.test.js
// Verification for guest webview will-navigate scheme enforcement and local file isolation

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise guest webview will-navigate security tests...');

// 1. Verify main.js registers will-navigate on webview webContents
{
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    const webviewBlockStart = mainSource.indexOf("if (webContents.getType() === 'webview')");
    assert(webviewBlockStart !== -1, 'main.js must contain webview webContents block');
    const webviewBlockSlice = mainSource.slice(webviewBlockStart, webviewBlockStart + 800);
    assert(webviewBlockSlice.includes("webContents.on('will-navigate'"), 'main.js must register will-navigate on webview webContents');

    console.log('✓ main.js guest webview will-navigate listener registration verified');
}

// 2. Verify will-navigate navigation policy logic
{
    const security = require('../security.js');
    const allowedAssetsDir = path.resolve(__dirname, '../assets');

    function createWebviewNavigationGuard(loggedEvents) {
        return (navEvent, navigationUrl) => {
            if (!navigationUrl || typeof navigationUrl !== 'string') {
                navEvent.preventDefault();
                return;
            }

            if (navigationUrl === 'about:blank') return;

            if (security.isSafeTabUrl(navigationUrl)) return;

            // Allow local application asset pages
            try {
                const parsed = new URL(navigationUrl);
                if (parsed.protocol === 'file:') {
                    const targetFilePath = path.resolve(decodeURIComponent(parsed.pathname));
                    if (targetFilePath.startsWith(allowedAssetsDir + path.sep)) {
                        return;
                    }
                }
            } catch (e) {}

            navEvent.preventDefault();
            loggedEvents.push(navigationUrl);
        };
    }

    // A. Permitted destinations
    const safeTargets = [
        'https://example.com',
        'https://duckduckgo.com/?q=test',
        'http://localhost:3000/app',
        'about:blank',
        'file://' + path.join(allowedAssetsDir, 'pdfjs', 'viewer.html') + '?file=doc.pdf',
        'file://' + path.join(allowedAssetsDir, 'welcome.html')
    ];

    safeTargets.forEach(target => {
        const logs = [];
        const guard = createWebviewNavigationGuard(logs);
        let prevented = false;
        const navEvent = { preventDefault: () => { prevented = true; } };

        guard(navEvent, target);
        assert.equal(prevented, false, `Permitted target must not be blocked: ${target}`);
        assert.equal(logs.length, 0, `No security log expected for permitted target: ${target}`);
    });
    console.log('✓ Safe web targets, about:blank, and bundled assets are permitted');

    // B. Prohibited destinations
    const prohibitedTargets = [
        'file:///etc/passwd',
        'file:///home/user/.bashrc',
        'file://' + path.resolve(__dirname, '../main.js'),
        'file://' + path.resolve(__dirname, '../package.json'),
        'javascript:alert(document.domain)',
        'data:text/html,<h1>Injected</h1>',
        'chrome://gpu',
        'blob:https://evil.com/uuid',
        '',
        null,
        undefined
    ];

    prohibitedTargets.forEach(target => {
        const logs = [];
        const guard = createWebviewNavigationGuard(logs);
        let prevented = false;
        const navEvent = { preventDefault: () => { prevented = true; } };

        guard(navEvent, target);
        assert.equal(prevented, true, `Prohibited target must be blocked: ${target}`);
    });
    console.log('✓ Arbitrary local files, javascript, data, and unknown schemes are blocked');
}

console.log('All guest webview will-navigate security tests passed successfully!');
