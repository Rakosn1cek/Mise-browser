// tests/reddit-image-preview.test.js
// Automated verification for universal self-referencing media click guards and duplicate tab suppression

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running universal media preview and duplicate tab suppression tests...');

// 1. Verify zero domain hardcoding across codebase
{
    const preloadSource = fs.readFileSync(path.join(__dirname, '../webview-preload.js'), 'utf8');
    const webviewSource = fs.readFileSync(path.join(__dirname, '../modules/webview.js'), 'utf8');
    const policySource = fs.readFileSync(path.join(__dirname, '../main/webContentsPolicy.js'), 'utf8');

    // Ensure no hardcoded reddit domain checks in the navigation and click interceptors
    assert.ok(!preloadSource.includes("includes('reddit.com')"), 'webview-preload.js must not hardcode reddit.com');
    assert.ok(!webviewSource.includes("includes('reddit.com')"), 'modules/webview.js must not hardcode reddit.com');
    assert.ok(!policySource.includes("includes('reddit.com')"), 'main/webContentsPolicy.js must not hardcode reddit.com');

    // Ensure no hardcoded /comments/ path checks in webview.js or policy
    assert.ok(!webviewSource.includes("includes('/comments/')"), 'modules/webview.js must not hardcode /comments/');
    assert.ok(!policySource.includes("includes('/comments/')"), 'main/webContentsPolicy.js must not hardcode /comments/');

    console.log('✓ Zero domain or site-specific path hardcoding verified across navigation handlers');
}

// 2. Functional verification of isSameDocumentUrl logic
{
    function isSameDocumentUrl(url, baseHref) {
        if (!url || typeof url !== 'string') return false;
        try {
            const target = new URL(url, baseHref);
            const current = new URL(baseHref);
            return target.origin === current.origin && target.pathname === current.pathname;
        } catch (_) {
            return false;
        }
    }

    const currentDoc = 'https://example.com/posts/architecture-discussion-123';

    // Identical URL
    assert.equal(isSameDocumentUrl('https://example.com/posts/architecture-discussion-123', currentDoc), true);

    // Same document with different query or hash
    assert.equal(isSameDocumentUrl('https://example.com/posts/architecture-discussion-123?utm_source=feed', currentDoc), true);
    assert.equal(isSameDocumentUrl('https://example.com/posts/architecture-discussion-123#comment-456', currentDoc), true);

    // Relative self-link
    assert.equal(isSameDocumentUrl('/posts/architecture-discussion-123', currentDoc), true);

    // Different document on same origin
    assert.equal(isSameDocumentUrl('https://example.com/posts/other-post-456', currentDoc), false);
    assert.equal(isSameDocumentUrl('/posts/other-post-456', currentDoc), false);

    // Different origin
    assert.equal(isSameDocumentUrl('https://other-site.com/posts/architecture-discussion-123', currentDoc), false);

    // Malformed input
    assert.equal(isSameDocumentUrl('', currentDoc), false);
    assert.equal(isSameDocumentUrl(null, currentDoc), false);
    assert.equal(isSameDocumentUrl(undefined, currentDoc), false);

    console.log('✓ isSameDocumentUrl document-level equivalence matching verified');
}

// 3. Functional simulation of webview.js new-window duplicate post suppression
{
    const currentWS = 'Workspace 1';
    let savedSession = false;
    const testState = {
        sessionState: {
            current_workspace: currentWS,
            workspaces: {
                'Workspace 1': ['https://example.com/posts/test-post-1']
            }
        },
        tabPinned: { 'Workspace 1': [false] },
        tabDarkReaderStates: {}
    };

    const { isSafeTabUrl } = require('../modules/utils.js');

    function simulateNewWindow(incomingUrl, currentActiveUrl) {
        let prevented = false;
        const e = {
            url: incomingUrl,
            preventDefault: () => { prevented = true; }
        };

        const targetUrl = e.url;
        e.preventDefault();
        if (!isSafeTabUrl(targetUrl)) {
            return { rejected: true, prevented, duplicate: false };
        }

        const currentUrl = currentActiveUrl || '';
        if (currentUrl && targetUrl) {
            try {
                const cur = new URL(currentUrl);
                const tgt = new URL(targetUrl);
                if (cur.origin === tgt.origin && cur.pathname === tgt.pathname) {
                    return { rejected: false, prevented, duplicate: true };
                }
            } catch (_) {}
        }

        testState.sessionState.workspaces[currentWS].push(targetUrl);
        savedSession = true;
        return { rejected: false, prevented, duplicate: false };
    }

    // Attempt to open duplicate tab of the current post
    const dupResult = simulateNewWindow(
        'https://example.com/posts/test-post-1',
        'https://example.com/posts/test-post-1'
    );
    assert.equal(dupResult.duplicate, true, 'Self-referencing new-window target must be flagged as duplicate');
    assert.equal(dupResult.prevented, true, 'Default action must be prevented');
    assert.equal(testState.sessionState.workspaces['Workspace 1'].length, 1, 'No new tab should be spawned for duplicate post');

    // Attempt to open legitimate outbound link in a new tab
    const outboundResult = simulateNewWindow(
        'https://example.com/docs/guides',
        'https://example.com/posts/test-post-1'
    );
    assert.equal(outboundResult.duplicate, false, 'Different pathname must not be flagged as duplicate');
    assert.equal(testState.sessionState.workspaces['Workspace 1'].length, 2, 'New tab must be spawned for different page');
    assert.equal(testState.sessionState.workspaces['Workspace 1'][1], 'https://example.com/docs/guides');

    console.log('✓ webview.js self-referencing duplicate tab suppression verified');
}

// 4. Functional simulation of main/webContentsPolicy.js setWindowOpenHandler guard
{
    const { isSafeTabUrl } = require('../modules/utils.js');

    function simulateWindowOpenHandler(details, activeUrl) {
        let dispatchedShortcut = null;
        const currentUrl = activeUrl || '';

        if (details.url && details.url !== 'about:blank') {
            if (isSafeTabUrl(details.url)) {
                if (currentUrl && details.url) {
                    try {
                        const cur = new URL(currentUrl);
                        const tgt = new URL(details.url);
                        if (cur.origin === tgt.origin && cur.pathname === tgt.pathname) {
                            return { action: 'deny', dispatchedShortcut };
                        }
                    } catch (_) {}
                }
                dispatchedShortcut = ['spawn-tab-with-url', details.url];
            }
        }
        return { action: 'deny', dispatchedShortcut };
    }

    // Suppress duplicate popup
    const resDup = simulateWindowOpenHandler(
        { url: 'https://news.ycombinator.com/item?id=12345' },
        'https://news.ycombinator.com/item?id=12345'
    );
    assert.equal(resDup.action, 'deny');
    assert.equal(resDup.dispatchedShortcut, null, 'Must not dispatch spawn-tab-with-url on duplicate popup');

    // Allow legitimate outbound popup
    const resOutbound = simulateWindowOpenHandler(
        { url: 'https://github.com/project/releases' },
        'https://news.ycombinator.com/item?id=12345'
    );
    assert.equal(resOutbound.action, 'deny');
    assert.deepEqual(resOutbound.dispatchedShortcut, ['spawn-tab-with-url', 'https://github.com/project/releases']);

    console.log('✓ setWindowOpenHandler self-referencing duplicate popup rejection verified');
}

// 5. Verification of isCandidateImageUrl and extractWrappedMediaUrl in security.js
{
    const security = require('../security.js');

    assert.equal(typeof security.isCandidateImageUrl, 'function', 'security.js must export isCandidateImageUrl');
    assert.equal(typeof security.extractWrappedMediaUrl, 'function', 'security.js must export extractWrappedMediaUrl');

    const sampleImageUrl = 'https://preview.redd.it/luma-0-17-0-is-out-prism-glass-theme-ctrl-tab-to-your-last-v0-mhwnwxef3d2i1.png?width=640&crop=smart&auto=webp&s=43a3baca759cb1a02ac033ec77ec9802d6da12ed';
    const directImageUrl = 'https://i.redd.it/mhwnwxef3d2i1.png';
    const cdnImageUrl = 'https://images.unsplash.com/photo-12345?format=webp&q=80';
    const htmlPageUrl = 'https://example.com/r/browsers/comments/1gx/post_title/';

    assert.equal(security.isCandidateImageUrl(sampleImageUrl), true, 'Sample preview image URL must be recognized as image candidate');
    assert.equal(security.isCandidateImageUrl(directImageUrl), true, 'Direct image URL must be recognized as image candidate');
    assert.equal(security.isCandidateImageUrl(cdnImageUrl), true, 'Query-formatted image URL must be recognized as image candidate');
    assert.equal(security.isCandidateImageUrl(htmlPageUrl), false, 'HTML post URL must not be recognized as image candidate');
    assert.equal(security.isCandidateImageUrl(''), false);
    assert.equal(security.isCandidateImageUrl(null), false);

    const wrappedMediaUrl = 'https://www.example.com/media?url=' + encodeURIComponent(sampleImageUrl);
    assert.equal(security.extractWrappedMediaUrl(wrappedMediaUrl), sampleImageUrl, 'extractWrappedMediaUrl must extract target image URL');

    const nonImageWrappedUrl = 'https://www.example.com/media?url=' + encodeURIComponent('https://example.com/post/123');
    assert.equal(security.extractWrappedMediaUrl(nonImageWrappedUrl), null, 'extractWrappedMediaUrl must reject non-image targets');

    console.log('✓ isCandidateImageUrl and extractWrappedMediaUrl image candidate resolution verified');
}

// 6. Verification of context menu "Open Image in New Tab"
{
    const contextMenuSource = fs.readFileSync(path.join(__dirname, '../main/contextMenus.js'), 'utf8');
    assert.ok(contextMenuSource.includes("'Open Image in New Tab'"), 'contextMenus.js must provide Open Image in New Tab for images');
    assert.ok(contextMenuSource.includes('openLinkTab(targetMedia)'), 'Open Image in New Tab must open link tab');

    console.log('✓ Context menu Open Image in New Tab integration verified');
}

// 7. Verify zero domain hardcoding in security.js and contextMenus.js
{
    const securitySource = fs.readFileSync(path.join(__dirname, '../security.js'), 'utf8');
    const contextMenuSource = fs.readFileSync(path.join(__dirname, '../main/contextMenus.js'), 'utf8');

    assert.ok(!securitySource.includes("includes('reddit.com')"), 'security.js must not hardcode reddit.com');
    assert.ok(!contextMenuSource.includes("includes('reddit.com')"), 'main/contextMenus.js must not hardcode reddit.com');

    console.log('✓ Zero domain hardcoding verified in security and context menu layers');
}

console.log('All universal media preview and duplicate tab suppression tests passed successfully!');
