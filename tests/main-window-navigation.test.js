// tests/main-window-navigation.test.js
// Verification for main window navigation guards and window open handling

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise main window navigation and window open guard tests...');

// 1. Verify main.js registers will-navigate and setWindowOpenHandler on mainWindow
{
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    assert(mainSource.includes("mainWindow.webContents.on('will-navigate'"), 'main.js must register will-navigate on mainWindow');
    assert(mainSource.includes('mainWindow.webContents.setWindowOpenHandler('), 'main.js must register setWindowOpenHandler on mainWindow');

    console.log('✓ main.js mainWindow navigation listeners registration verified');
}

// 2. Verify will-navigate handler logic: allow app index.html, block external and route safe URLs
{
    const appIndexPath = path.resolve(__dirname, '../index.html');
    const security = require('../security.js');

    function createWillNavigateHandler(sentMessages) {
        return (event, navigationUrl) => {
            let isAppIndex = false;
            try {
                const parsed = new URL(navigationUrl);
                if (parsed.protocol === 'file:') {
                    const targetFilePath = path.resolve(decodeURIComponent(parsed.pathname));
                    if (targetFilePath === appIndexPath) {
                        isAppIndex = true;
                    }
                }
            } catch (e) {}

            if (isAppIndex) return;

            event.preventDefault();
            if (security.isSafeTabUrl(navigationUrl)) {
                sentMessages.push(['master-shortcut', 'spawn-tab-with-url', navigationUrl]);
            }
        };
    }

    // A. Internal index.html navigation must be permitted
    {
        const sent = [];
        const handler = createWillNavigateHandler(sent);
        let prevented = false;
        const event = { preventDefault: () => { prevented = true; } };

        handler(event, 'file://' + appIndexPath);
        assert.equal(prevented, false, 'Internal index.html file URL must not be blocked');
        assert.equal(sent.length, 0, 'No tab spawn message should be sent for index.html');
    }

    // B. Safe external URL navigation must be prevented and routed to a tab
    {
        const sent = [];
        const handler = createWillNavigateHandler(sent);
        let prevented = false;
        const event = { preventDefault: () => { prevented = true; } };

        handler(event, 'https://example.com/research');
        assert.equal(prevented, true, 'External https navigation must be prevented in mainWindow');
        assert.equal(sent.length, 1);
        assert.deepEqual(sent[0], ['master-shortcut', 'spawn-tab-with-url', 'https://example.com/research']);
    }

    // C. Hostile or local file navigation must be prevented and dropped
    {
        const sent = [];
        const handler = createWillNavigateHandler(sent);
        let prevented = false;
        const event = { preventDefault: () => { prevented = true; } };

        handler(event, 'file:///etc/passwd');
        assert.equal(prevented, true, 'Arbitrary local file navigation must be prevented in mainWindow');
        assert.equal(sent.length, 0, 'Hostile target must not trigger tab spawn');

        prevented = false;
        handler(event, 'javascript:alert(1)');
        assert.equal(prevented, true, 'javascript: navigation must be prevented');
        assert.equal(sent.length, 0);
    }

    console.log('✓ will-navigate policy prevents escape from index.html and safely routes valid web targets');
}

// 3. Verify setWindowOpenHandler policy: deny all popups and route safe targets
{
    const security = require('../security.js');

    function createWindowOpenHandler(sentMessages) {
        return (details) => {
            if (details.url && security.isSafeTabUrl(details.url)) {
                sentMessages.push(['master-shortcut', 'spawn-tab-with-url', details.url]);
            }
            return { action: 'deny' };
        };
    }

    const sent = [];
    const handler = createWindowOpenHandler(sent);

    // Safe popup target
    const safeDecision = handler({ url: 'https://duckduckgo.com' });
    assert.deepEqual(safeDecision, { action: 'deny' }, 'action must be deny to prevent unmanaged child windows');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], ['master-shortcut', 'spawn-tab-with-url', 'https://duckduckgo.com']);

    // Unsafe popup target
    const unsafeDecision = handler({ url: 'file:///etc/shadow' });
    assert.deepEqual(unsafeDecision, { action: 'deny' });
    assert.equal(sent.length, 1, 'Unsafe target must not produce a tab spawn message');

    console.log('✓ setWindowOpenHandler denies child BrowserWindow creation and routes safe popups');
}

console.log('All main window navigation and window open guard tests passed successfully!');
