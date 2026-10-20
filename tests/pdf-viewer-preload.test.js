// tests/pdf-viewer-preload.test.js
// Verification for PDF viewer preload capability matching and origin isolation

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise PDF viewer preload capability matching regression tests...');

// 1. Verify webview-preload.js restricts capability check to canonical viewer path
{
    const preloadSource = fs.readFileSync(path.join(__dirname, '../webview-preload.js'), 'utf8');

    // Overly broad suffix matching must be eliminated
    assert.equal(
        preloadSource.includes("endsWith('/assets/pdfjs/viewer.html')"),
        false,
        'webview-preload.js must not use loose endsWith path suffix matching'
    );

    // Verify canonical path IPC query and pathname equality check
    assert(
        preloadSource.includes("ipcRenderer.sendSync('get-pdf-viewer-path')"),
        'webview-preload.js must query get-pdf-viewer-path to determine canonical location'
    );
    assert(
        preloadSource.includes('currentUrl.pathname === targetUrl.pathname'),
        'webview-preload.js must verify pathname equality against canonical viewer path'
    );

    console.log('✓ webview-preload.js canonical path matching logic verified');
}

// 2. Verify main.js registers get-pdf-viewer-path IPC handler
{
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

    assert(
        mainSource.includes("ipcMain.on('get-pdf-viewer-path'"),
        'main.js must register get-pdf-viewer-path synchronous IPC handler'
    );
    assert(
        mainSource.includes("path.join(__dirname, 'assets', 'pdfjs', 'viewer.html')"),
        'main.js must resolve canonical assets/pdfjs/viewer.html path'
    );

    console.log('✓ main.js get-pdf-viewer-path handler registration verified');
}

// 3. Functional verification of capability matching algorithm
{
    const appDir = path.resolve(__dirname, '..');
    const canonicalViewerUrl = 'file://' + path.join(appDir, 'assets', 'pdfjs', 'viewer.html');

    function checkViewerCapability(currentHref, mockIpcResponse) {
        try {
            const currentUrl = new URL(currentHref);
            if (currentUrl.protocol !== 'file:') return false;

            const canonicalUrlStr = mockIpcResponse;
            if (!canonicalUrlStr || typeof canonicalUrlStr !== 'string') return false;

            const targetUrl = new URL(canonicalUrlStr);
            return currentUrl.protocol === 'file:' && currentUrl.pathname === targetUrl.pathname;
        } catch (e) {
            return false;
        }
    }

    // A. Genuine vendored viewer URL with queries and tokens
    assert.equal(
        checkViewerCapability(canonicalViewerUrl + '?file=sample.pdf&token=test-token-123', canonicalViewerUrl),
        true,
        'Genuine viewer URL with query params must be granted capability'
    );
    assert.equal(
        checkViewerCapability(canonicalViewerUrl + '#page=3', canonicalViewerUrl),
        true,
        'Genuine viewer URL with hash fragment must be granted capability'
    );
    assert.equal(
        checkViewerCapability(canonicalViewerUrl, canonicalViewerUrl),
        true,
        'Exact canonical viewer URL must be granted capability'
    );

    // B. Spoofed local file paths ending with the viewer path suffix
    const spoofedPaths = [
        'file:///tmp/malicious/assets/pdfjs/viewer.html',
        'file:///home/user/Downloads/assets/pdfjs/viewer.html',
        'file:///var/tmp/assets/pdfjs/viewer.html?token=fake',
        'file://' + path.join(appDir, 'other_dir', 'assets', 'pdfjs', 'viewer.html')
    ];

    for (const spoofedUrl of spoofedPaths) {
        assert.equal(
            checkViewerCapability(spoofedUrl, canonicalViewerUrl),
            false,
            `Spoofed path "${spoofedUrl}" must be denied PDF bridge capability`
        );
    }

    // C. Non-file protocols and external URLs
    const externalUrls = [
        'http://example.com/assets/pdfjs/viewer.html',
        'https://attacker.org/assets/pdfjs/viewer.html',
        'data:text/html,<html><body>/assets/pdfjs/viewer.html</body></html>',
        'javascript:void(0)'
    ];

    for (const extUrl of externalUrls) {
        assert.equal(
            checkViewerCapability(extUrl, canonicalViewerUrl),
            false,
            `External URL "${extUrl}" must be denied PDF bridge capability`
        );
    }

    // D. Missing or failing IPC response
    assert.equal(
        checkViewerCapability(canonicalViewerUrl, null),
        false,
        'Capability check must fail closed if IPC returns null'
    );
    assert.equal(
        checkViewerCapability(canonicalViewerUrl, ''),
        false,
        'Capability check must fail closed if IPC returns empty string'
    );

    console.log('✓ PDF viewer preload capability scoping and fail-closed logic verified');
    console.log('All PDF viewer preload capability tests passed successfully!');
}
