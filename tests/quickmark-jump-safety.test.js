// tests/quickmark-jump-safety.test.js
// Verification for quickmark jump and bookmark activation safety validation

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isSafeTabUrl } = require('../modules/utils.js');

console.log('Running Mise quickmark jump and bookmark safety regression tests...');

// 1. Static code analysis of modules/overlays/bookmarks.js
{
    const source = fs.readFileSync(path.join(__dirname, '../modules/overlays/bookmarks.js'), 'utf8');

    // Verify isSafeTabUrl is imported from utils.js
    assert(
        source.includes("import { escapeHtml, focusActiveWebview, getActiveWebview, isSafeTabUrl } from '../utils.js';"),
        'bookmarks.js must import isSafeTabUrl from ../utils.js'
    );

    // Verify promptQuickmark jump mode validates with isSafeTabUrl
    assert(
        source.includes('if (entry && isSafeTabUrl(entry.url)) {') &&
        source.includes('spawnTabWithUrl(entry.url);'),
        'promptQuickmark jump mode must verify entry.url with isSafeTabUrl prior to spawning tab'
    );

    // Verify promptQuickmark set mode validates with isSafeTabUrl
    assert(
        source.includes('if (isSafeTabUrl(url)) {') &&
        source.includes('state.quickmarks[key] = { url, title };'),
        'promptQuickmark set mode must verify active webview url with isSafeTabUrl prior to saving'
    );

    // Verify quickmark item click handler validates with isSafeTabUrl
    assert(
        source.includes('if (isSafeTabUrl(qm.url)) {') &&
        source.includes('spawnTabWithUrl(qm.url);'),
        'quickmark item click listener must guard with isSafeTabUrl'
    );

    // Verify bookmark item click handler validates with isSafeTabUrl
    assert(
        source.includes('if (isSafeTabUrl(bm.url)) {') &&
        source.includes('spawnTabWithUrl(bm.url);'),
        'bookmark item click listener must guard with isSafeTabUrl'
    );

    // Verify Enter key selection handler validates targetItem.url with isSafeTabUrl
    assert(
        source.includes('if (targetItem && targetItem.url && isSafeTabUrl(targetItem.url)) {') &&
        source.includes('spawnTabWithUrl(targetItem.url);'),
        'Enter key overlay handler must verify targetItem.url with isSafeTabUrl'
    );

    console.log('✓ bookmarks.js safety imports and guard integration verified');
}

// 2. Functional verification of quickmark jump logic
{
    const spawnedTabs = [];
    const mockSpawnTabWithUrl = (url) => {
        spawnedTabs.push(url);
    };

    let focusCount = 0;
    const mockFocusActiveWebview = () => {
        focusCount++;
    };

    // Helper to simulate promptQuickmark jump execution
    function simulateQuickmarkJump(key, quickmarks) {
        const state = {
            quickmarkMode: 'jump',
            quickmarks: { ...quickmarks }
        };

        const entry = state.quickmarks[key];
        if (entry && isSafeTabUrl(entry.url)) {
            mockSpawnTabWithUrl(entry.url);
        } else {
            mockFocusActiveWebview();
        }
    }

    // Case A: Safe http and https quickmarks are spawned
    simulateQuickmarkJump('g', { g: { url: 'https://github.com', title: 'GitHub' } });
    assert.equal(spawnedTabs.length, 1);
    assert.equal(spawnedTabs[0], 'https://github.com');

    simulateQuickmarkJump('l', { l: { url: 'http://localhost:8080/dashboard', title: 'Localhost' } });
    assert.equal(spawnedTabs.length, 2);
    assert.equal(spawnedTabs[1], 'http://localhost:8080/dashboard');

    // Case B: Unsafe protocols must not spawn tabs
    const unsafeTargets = [
        'file:///etc/passwd',
        'file:///home/user/.ssh/id_rsa',
        'javascript:alert(1)',
        'data:text/html,<b>pwned</b>',
        'blob:https://example.com/uuid',
        'about:blank',
        'chrome://settings',
        '',
        null,
        undefined,
        12345,
        'https://example.com/' + 'x'.repeat(20000)
    ];

    for (const unsafeUrl of unsafeTargets) {
        const previousTabCount = spawnedTabs.length;
        const previousFocusCount = focusCount;

        simulateQuickmarkJump('x', { x: { url: unsafeUrl, title: 'Malicious' } });

        assert.equal(
            spawnedTabs.length,
            previousTabCount,
            `Unsafe quickmark URL must not spawn tab: ${unsafeUrl}`
        );
        assert.equal(
            focusCount,
            previousFocusCount + 1,
            'Webview focus must be returned when quickmark is rejected'
        );
    }

    console.log('✓ Quickmark jump protocol filtering and safety rejection verified');
}

// 3. Functional verification of quickmark set mode logic
{
    const savedQuickmarks = [];
    const mockSaveQuickmarks = (qm) => {
        savedQuickmarks.push(qm);
    };

    function simulateQuickmarkSet(key, activeUrl, activeTitle) {
        const state = {
            quickmarks: {}
        };

        if (isSafeTabUrl(activeUrl)) {
            state.quickmarks[key] = { url: activeUrl, title: activeTitle || activeUrl };
            mockSaveQuickmarks(state.quickmarks);
        }
        return state.quickmarks;
    }

    // Safe URL set
    const safeResult = simulateQuickmarkSet('d', 'https://duckduckgo.com', 'DuckDuckGo');
    assert('d' in safeResult, 'Safe web URL must be recorded as quickmark');
    assert.equal(safeResult.d.url, 'https://duckduckgo.com');
    assert.equal(savedQuickmarks.length, 1);

    // Unsafe target set
    const unsafeResult = simulateQuickmarkSet('p', 'file:///etc/shadow', 'Shadow');
    assert(!('p' in unsafeResult), 'Local file scheme must not be recorded as quickmark');
    assert.equal(savedQuickmarks.length, 1);

    console.log('✓ Quickmark set mode validation verified');
}

// 4. Functional verification of bookmark selection activation
{
    const activatedUrls = [];
    const mockSpawn = (url) => {
        activatedUrls.push(url);
    };

    function simulateSelectionActivation(item) {
        if (item && item.url && isSafeTabUrl(item.url)) {
            mockSpawn(item.url);
        }
    }

    // Valid item
    simulateSelectionActivation({ url: 'https://archlinux.org', title: 'Arch Linux' });
    assert.equal(activatedUrls.length, 1);
    assert.equal(activatedUrls[0], 'https://archlinux.org');

    // Invalid item
    simulateSelectionActivation({ url: 'javascript:void(0)', title: 'XSS' });
    assert.equal(activatedUrls.length, 1, 'Unsafe bookmark target must not trigger tab spawn');

    console.log('✓ Bookmark selection activation validation verified');
    console.log('All quickmark jump safety regression tests passed successfully!');
}
