// tests/webview-new-window.test.js
// Verification for guest webview new-window URL validation and scheme filtering

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise webview new-window security regression tests...');

// 1. Verify isSafeTabUrl helper in modules/utils.js
{
    const { isSafeTabUrl } = require('../modules/utils.js');
    assert.equal(typeof isSafeTabUrl, 'function', 'isSafeTabUrl must be exported as a function from utils.js');

    // Valid URLs
    assert.equal(isSafeTabUrl('https://example.com'), true);
    assert.equal(isSafeTabUrl('http://localhost:8080/path?query=1'), true);
    assert.equal(isSafeTabUrl('https://duckduckgo.com/'), true);

    // Hostile and invalid schemes
    assert.equal(isSafeTabUrl('file:///etc/passwd'), false);
    assert.equal(isSafeTabUrl('file:///home/user/.ssh/id_rsa'), false);
    assert.equal(isSafeTabUrl('javascript:alert(1)'), false);
    assert.equal(isSafeTabUrl('data:text/html,<h1>Pwned</h1>'), false);
    assert.equal(isSafeTabUrl('blob:https://example.com/uuid'), false);
    assert.equal(isSafeTabUrl('about:blank'), false);
    assert.equal(isSafeTabUrl('chrome://settings'), false);
    assert.equal(isSafeTabUrl(''), false);
    assert.equal(isSafeTabUrl(null), false);
    assert.equal(isSafeTabUrl(undefined), false);
    assert.equal(isSafeTabUrl(12345), false);
    assert.equal(isSafeTabUrl('https://example.com/' + 'a'.repeat(20000)), false);

    console.log('✓ modules/utils.js isSafeTabUrl schema and protocol enforcement verified');
}

// 2. Verify webview.js imports and invokes isSafeTabUrl on new-window event
{
    const webviewSource = fs.readFileSync(path.join(__dirname, '../modules/webview.js'), 'utf8');
    assert(webviewSource.includes('isSafeTabUrl'), 'modules/webview.js must import and reference isSafeTabUrl');

    const listenerStart = webviewSource.indexOf("webview.addEventListener('new-window', (e) => {");
    assert(listenerStart !== -1, 'new-window event listener must be registered on webview');
    const listenerSlice = webviewSource.slice(listenerStart, listenerStart + 300);
    assert(listenerSlice.includes('if (!isSafeTabUrl(targetUrl))'), 'new-window listener must guard with !isSafeTabUrl(targetUrl)');

    // Simulate handler behaviour
    let savedSession = false;
    let renderedIndex = -1;
    const testState = {
        sessionState: {
            current_workspace: 'Workspace 1',
            workspaces: {
                'Workspace 1': ['https://duckduckgo.com']
            }
        },
        tabPinned: { 'Workspace 1': [false] },
        tabDarkReaderStates: {}
    };

    const { isSafeTabUrl } = require('../modules/utils.js');

    function simulateNewWindow(incomingUrl) {
        let prevented = false;
        const e = {
            url: incomingUrl,
            preventDefault: () => { prevented = true; }
        };

        const targetUrl = e.url;
        e.preventDefault();
        if (!isSafeTabUrl(targetUrl)) {
            return { rejected: true, prevented };
        }

        const currentWS = testState.sessionState.current_workspace;
        testState.sessionState.workspaces[currentWS].push(targetUrl);
        savedSession = true;
        const newTargetIdx = testState.sessionState.workspaces[currentWS].length - 1;
        renderedIndex = newTargetIdx;
        return { rejected: false, prevented };
    }

    // Hostile URL rejection
    const hostileResult = simulateNewWindow('file:///etc/shadow');
    assert.equal(hostileResult.rejected, true, 'Hostile file:// URL must be rejected');
    assert.equal(hostileResult.prevented, true, 'Default action must be prevented');
    assert.equal(testState.sessionState.workspaces['Workspace 1'].length, 1, 'Workspace tabs count must remain 1');
    assert.equal(savedSession, false, 'Session must not be saved on rejected URL');

    const jsResult = simulateNewWindow('javascript:stealCookies()');
    assert.equal(jsResult.rejected, true, 'javascript: URL must be rejected');
    assert.equal(testState.sessionState.workspaces['Workspace 1'].length, 1);

    // Safe URL acceptance
    const safeResult = simulateNewWindow('https://github.com');
    assert.equal(safeResult.rejected, false, 'Valid https URL must be accepted');
    assert.equal(testState.sessionState.workspaces['Workspace 1'].length, 2);
    assert.equal(testState.sessionState.workspaces['Workspace 1'][1], 'https://github.com');
    assert.equal(savedSession, true, 'Session save must be triggered on safe URL');
    assert.equal(renderedIndex, 1, 'UI render index must correspond to newly added tab');

    console.log('✓ Guest webview new-window event filtering and tab isolation verified');
}

console.log('All guest webview new-window security regression tests passed successfully!');
