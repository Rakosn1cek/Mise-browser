// tests/template-modularisation.test.js
// Automated verification for Phase 5: Interface Shell and Overlay Template Modularisation

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise interface shell & overlay template modularisation regression tests...');

// 1. Verify all 10 overlay templates exist under templates/ with valid content
{
    const expectedTemplates = [
        { file: 'command-palette.html', expectedId: 'CommandPaletteOverlay' },
        { file: 'preferences.html', expectedId: 'PreferencesOverlay' },
        { file: 'dashboard.html', expectedId: 'DashboardOverlay' },
        { file: 'bookmarks.html', expectedId: 'BookmarksOverlay' },
        { file: 'diagnostics.html', expectedId: 'DiagnosticsOverlay' },
        { file: 'history.html', expectedId: 'HistoryOverlay' },
        { file: 'notes.html', expectedId: 'NotesOverlay' },
        { file: 'share-modal.html', expectedId: 'ShareModalOverlay' },
        { file: 'peek-modal.html', expectedId: 'PeekModalOverlay' },
        { file: 'find-bar.html', expectedId: 'FindBarOverlay' }
    ];

    for (const tpl of expectedTemplates) {
        const filePath = path.join(__dirname, '../templates', tpl.file);
        assert(fs.existsSync(filePath), `Template ${tpl.file} must exist in templates directory`);
        const content = fs.readFileSync(filePath, 'utf8').trim();
        assert(content.length > 0, `Template ${tpl.file} must not be empty`);
        assert(content.includes(`id="${tpl.expectedId}"`), `Template ${tpl.file} must define root element with id="${tpl.expectedId}"`);
    }

    // Verify preferences template retains runtime version badge and updater controls
    const prefContent = fs.readFileSync(path.join(__dirname, '../templates/preferences.html'), 'utf8');
    assert(prefContent.includes('id="MiseVersionBadge"'), 'templates/preferences.html must include #MiseVersionBadge');
    assert(prefContent.includes('id="WhatsNewOpenBtn"'), 'templates/preferences.html must include #WhatsNewOpenBtn');
    assert(prefContent.includes('id="CheckForUpdatesBtn"'), 'templates/preferences.html must include #CheckForUpdatesBtn');

    console.log('✓ All 10 overlay templates verified on disk with valid root IDs and version controls');
}

// 2. Verify index.html line budget and persistent shell integrity
{
    const indexPath = path.join(__dirname, '../index.html');
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const lines = indexContent.split('\n');
    const lineCount = lines.length;

    // Line budget check
    assert(
        lineCount <= 260,
        `index.html must remain streamlined under budget (currently ${lineCount} lines, down from 1025 lines)`
    );

    // Persistent shell elements check
    const requiredShellSelectors = [
        'id="Sidebar"',
        'id="WindowControls"',
        'id="WorkspaceHeader"',
        'id="TabList"',
        'id="SidebarClock"',
        'class="bottom-theme-layout"',
        'id="webview-container"',
        'id="EmptyWorkspaceWelcome"',
        'id="DownloadShelf"',
        'id="StatusBar"',
        'id="StatusBarMode"',
        'id="StatusBarUrl"',
        'id="WideAddressBar"',
        'id="StatusBarSecurity"',
        'id="StatusBarPartition"',
        'id="StatusBarClock"',
        'id="PermissionsPopover"',
        'id="PermissionPromptBanner"'
    ];

    for (const sel of requiredShellSelectors) {
        assert(indexContent.includes(sel), `index.html persistent shell must include ${sel}`);
    }

    // Heavy overlay elements must NOT be present in index.html directly
    const extractedOverlayIds = [
        'id="CommandPaletteOverlay"',
        'id="PreferencesOverlay"',
        'id="DashboardOverlay"',
        'id="BookmarksOverlay"',
        'id="DiagnosticsOverlay"',
        'id="HistoryOverlay"',
        'id="NotesOverlay"',
        'id="ShareModalOverlay"',
        'id="PeekModalOverlay"',
        'id="FindBarOverlay"'
    ];

    for (const id of extractedOverlayIds) {
        assert(!indexContent.includes(id), `index.html must not contain heavy overlay ${id}`);
    }

    console.log(`✓ index.html line count capped under budget (${lineCount} lines) with persistent shell preserved`);
}

// 3. Verify package.json includes templates in build files
{
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    assert(
        pkg.build && Array.isArray(pkg.build.files) && pkg.build.files.includes('templates/**/*'),
        'package.json build.files must include templates/**/* for packaging'
    );
    console.log('✓ package.json distribution packaging includes templates/**/*');
}

// 4. Verify templateLoader.js contracts, export signatures, and security whitelist
{
    const loaderPath = path.join(__dirname, '../modules/templateLoader.js');
    assert(fs.existsSync(loaderPath), 'modules/templateLoader.js must exist');
    const loaderSource = fs.readFileSync(loaderPath, 'utf8');

    const expectedExports = [
        'REGISTERED_TEMPLATES',
        'isOverlayMounted',
        'loadTemplate',
        'mountOverlayTemplate',
        'mountOverlaySync',
        'ensureOverlayMounted',
        'preloadTemplates',
        'resetTemplateCache'
    ];

    for (const exp of expectedExports) {
        assert(
            loaderSource.includes(`export const ${exp}`) || loaderSource.includes(`export function ${exp}`) || loaderSource.includes(`export async function ${exp}`),
            `modules/templateLoader.js must export ${exp}`
        );
    }

    // Security whitelist check: ensure unrecognised keys are rejected
    assert(
        loaderSource.includes('REGISTERED_TEMPLATES[templateKey]'),
        'modules/templateLoader.js must strictly check templateKey against whitelist'
    );

    console.log('✓ modules/templateLoader.js exports and security whitelist verified');
}

// 5. Verify functional templateLoader caching and DOM mounting
{
    const loaderSource = fs.readFileSync(path.join(__dirname, '../modules/templateLoader.js'), 'utf8');

    // Build mock environment
    let mountedChildren = [];
    const mockContainer = {
        appendChild(child) {
            mountedChildren.push(child);
            return child;
        }
    };

    const mockDocument = {
        elements: new Map(),
        getElementById(id) {
            return this.elements.get(id) || null;
        },
        querySelector(selector) {
            if (selector === '#webview-container' || selector === 'body') return mockContainer;
            return null;
        },
        createElement(tag) {
            if (tag === 'template') {
                return {
                    tagName: 'TEMPLATE',
                    _html: '',
                    get innerHTML() { return this._html; },
                    set innerHTML(val) {
                        this._html = val;
                        const match = val.match(/id="([^"]+)"/);
                        const id = match ? match[1] : 'mock-overlay';
                        this.content = {
                            firstElementChild: {
                                id,
                                tagName: 'DIV',
                                style: { display: 'none' }
                            }
                        };
                    }
                };
            }
            return { tagName: tag.toUpperCase() };
        }
    };

    const strippedSource = loaderSource
        .replace(/export\s+(const|async\s+function|function)/g, '$1');

    const factory = new Function(
        'document', 'window', 'fetch', 'console',
        `${strippedSource}\nreturn { REGISTERED_TEMPLATES, isOverlayMounted, loadTemplate, mountOverlayTemplate, mountOverlaySync, ensureOverlayMounted, resetTemplateCache };`
    );

    const mockFetch = async (url) => {
        return {
            ok: true,
            status: 200,
            text: async () => `<div id="TestOverlay" style="display: none;"><span>Template Content</span></div>`
        };
    };

    const {
        REGISTERED_TEMPLATES,
        isOverlayMounted,
        loadTemplate,
        mountOverlayTemplate,
        mountOverlaySync,
        ensureOverlayMounted,
        resetTemplateCache
    } = factory(mockDocument, {}, mockFetch, console);

    (async () => {
        // A. Unknown template rejection
        const rejected = await loadTemplate('invalid-key-xyz');
        assert.strictEqual(rejected, null, 'Unregistered template key must return null');

        // B. Mounting into container
        const mounted = await mountOverlayTemplate('TestOverlay', 'command-palette', '#webview-container');
        assert(mounted, 'mountOverlayTemplate must return mounted element');
        assert.strictEqual(mounted.id, 'TestOverlay', 'Mounted element ID must match template');
        assert.strictEqual(mountedChildren.length, 1, 'Container must receive mounted child');

        // Register mounted element in mock document
        mockDocument.elements.set('TestOverlay', mounted);
        assert.strictEqual(isOverlayMounted('TestOverlay'), true, 'isOverlayMounted must return true');

        // C. Idempotency test: calling again must return existing element without re-appending
        const secondCall = await mountOverlayTemplate('TestOverlay', 'command-palette', '#webview-container');
        assert.strictEqual(secondCall, mounted, 'Idempotent mount must return identical instance');
        assert.strictEqual(mountedChildren.length, 1, 'Container must not receive duplicate elements');

        // D. Initialisation callback executes once
        let initCallCount = 0;
        await ensureOverlayMounted('TestOverlay', 'command-palette', '#webview-container', () => {
            initCallCount++;
        });
        assert.strictEqual(initCallCount, 1, 'Initialisation callback must run on initial mount');

        // Calling again does not re-run callback
        await ensureOverlayMounted('TestOverlay', 'command-palette', '#webview-container', () => {
            initCallCount++;
        });
        assert.strictEqual(initCallCount, 1, 'Initialisation callback must not re-run on subsequent calls');

        // E. Synchronous mount using cached markup
        const syncMounted = mountOverlaySync('TestOverlay', 'command-palette', '#webview-container');
        assert.strictEqual(syncMounted, mounted, 'mountOverlaySync must return existing or cached element');

        // Clean up
        resetTemplateCache();

        console.log('✓ templateLoader functional lifecycle, idempotency, and one-time callback verified');
    })().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
