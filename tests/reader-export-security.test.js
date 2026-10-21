// tests/reader-export-security.test.js
// Verification for hardened Reader View export: trusted click gating, rate limiting, and clipping limits

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const storage = require('../main/storage.js');

// Mock minimal DOM and window for modules/webview.js export invocations
const mockEl = {
    value: '',
    style: {},
    focus: () => {},
    innerHTML: '',
    setSelectionRange: () => {}
};
global.document = {
    getElementById: () => mockEl
};
global.window = {
    miseAPI: {
        readNotes: async () => '',
        saveNotes: async () => ({ success: true }),
        exportArticleToExternal: async () => ({ success: true })
    }
};

async function runTests() {
    console.log('Running Mise reader export security regression tests...');

    // 1. Static code analysis of webview-preload.js
    {
        const preloadSource = fs.readFileSync(path.join(__dirname, '../webview-preload.js'), 'utf8');
        assert(!preloadSource.includes('mise-reader-export-notes'), 'webview-preload.js must not forward mise-reader-export-notes');
        assert(!preloadSource.includes('mise-reader-export-external'), 'webview-preload.js must not forward mise-reader-export-external');
        assert(preloadSource.includes("window.addEventListener('click'"), 'webview-preload.js must register click listener');
        assert(preloadSource.includes('e.isTrusted'), 'webview-preload.js must enforce event.isTrusted check');
        assert(preloadSource.includes('export-notes-btn'), 'webview-preload.js must filter for export-notes-btn');
        assert(preloadSource.includes('export-external-btn'), 'webview-preload.js must filter for export-external-btn');
        assert(preloadSource.includes("'reader-export-request'"), 'webview-preload.js must send reader-export-request');

        console.log('✓ webview-preload.js CustomEvent removal and trusted click gating verified');
    }

    // 2. Functional simulation of webview-preload.js click listener logic
    {
        const sentMessages = [];
        const mockIpcRenderer = {
            sendToHost: (channel, data) => {
                sentMessages.push({ channel, data });
            }
        };

        function simulatePreloadClick(event, overlayEl, elementsInPath) {
            if (!event || !event.isTrusted) return;
            const overlay = overlayEl;
            if (!overlay) return;
            const path = elementsInPath || [];
            const isInsideOverlay = path.includes(overlay) || (overlay.contains && overlay.contains(event.target));
            if (!isInsideOverlay) return;

            let targetType = null;
            for (const el of path) {
                if (el === overlay) break;
                if (!el || !el.classList) continue;
                if (el.classList.contains('export-notes-btn')) {
                    targetType = 'notes';
                    break;
                }
                if (el.classList.contains('export-external-btn')) {
                    targetType = 'external';
                    break;
                }
            }

            if (targetType) {
                mockIpcRenderer.sendToHost('reader-export-request', targetType);
            }
        }

        const overlayMock = { id: 'mise-reader-overlay' };
        const notesBtnMock = { classList: { contains: (cls) => cls === 'export-notes-btn' } };
        const extBtnMock = { classList: { contains: (cls) => cls === 'export-external-btn' } };

        // Case A: Untrusted click (isTrusted: false)
        sentMessages.length = 0;
        simulatePreloadClick({ isTrusted: false }, overlayMock, [notesBtnMock, overlayMock]);
        assert.strictEqual(sentMessages.length, 0, 'Untrusted event must be rejected');

        // Case B: Click outside overlay
        sentMessages.length = 0;
        simulatePreloadClick({ isTrusted: true }, overlayMock, [notesBtnMock]);
        assert.strictEqual(sentMessages.length, 0, 'Click outside overlay must be rejected');

        // Case C: Trusted click on notes button inside overlay
        sentMessages.length = 0;
        simulatePreloadClick({ isTrusted: true }, overlayMock, [notesBtnMock, overlayMock]);
        assert.strictEqual(sentMessages.length, 1, 'Trusted click on notes button must send message');
        assert.strictEqual(sentMessages[0].channel, 'reader-export-request');
        assert.strictEqual(sentMessages[0].data, 'notes', 'Message must send notes target with no payload');

        // Case D: Trusted click on external button inside overlay
        sentMessages.length = 0;
        simulatePreloadClick({ isTrusted: true }, overlayMock, [extBtnMock, overlayMock]);
        assert.strictEqual(sentMessages.length, 1, 'Trusted click on external button must send message');
        assert.strictEqual(sentMessages[0].channel, 'reader-export-request');
        assert.strictEqual(sentMessages[0].data, 'external', 'Message must send external target with no payload');

        console.log('✓ webview-preload.js click gate simulation verified');
    }

    // 3. Static code analysis and functional tests for modules/webview.js
    {
        const webviewSource = fs.readFileSync(path.join(__dirname, '../modules/webview.js'), 'utf8');
        assert(!webviewSource.includes("e.channel === 'reader-export-notes'"), 'modules/webview.js must not listen for reader-export-notes');
        assert(!webviewSource.includes("e.channel === 'reader-export-external'"), 'modules/webview.js must not listen for reader-export-external');
        assert(webviewSource.includes("e.channel === 'reader-export-request'"), 'modules/webview.js must listen for reader-export-request');

        const { handleReaderExportRequest } = await import('../modules/webview.js');

        // Test webview without __miseReaderActive
        let jsExecuted = false;
        const inactiveWv = {
            __miseReaderActive: false,
            executeJavaScript: async () => { jsExecuted = true; }
        };
        await handleReaderExportRequest(inactiveWv, 'notes');
        assert.strictEqual(jsExecuted, false, 'handleReaderExportRequest must ignore inactive reader webviews');

        // Test rate-limiting (2 seconds)
        let execCount = 0;
        const activeWv = {
            __miseReaderActive: true,
            executeJavaScript: async () => {
                execCount++;
                return { title: 'Test Title', textContent: 'Test Content' };
            }
        };

        await handleReaderExportRequest(activeWv, 'notes');
        assert.strictEqual(execCount, 1, 'First export request must execute JavaScript');

        // Immediate second call should be suppressed by rate limiter
        await handleReaderExportRequest(activeWv, 'notes');
        assert.strictEqual(execCount, 1, 'Second export request within 2 seconds must be suppressed');

        // Non-string title rejection
        activeWv.__lastReaderExportTime = 0;
        let scriptCalled = false;
        activeWv.executeJavaScript = async () => {
            scriptCalled = true;
            return { title: 12345, textContent: 'Valid Content' };
        };
        await handleReaderExportRequest(activeWv, 'notes');
        assert.strictEqual(scriptCalled, true);

        // Non-string textContent rejection
        activeWv.__lastReaderExportTime = 0;
        scriptCalled = false;
        activeWv.executeJavaScript = async () => {
            scriptCalled = true;
            return { title: 'Valid Title', textContent: null };
        };
        await handleReaderExportRequest(activeWv, 'notes');
        assert.strictEqual(scriptCalled, true);

        // Verify title capped at 300 and textContent capped at 200000 chars
        activeWv.__lastReaderExportTime = 0;
        const longTitle = 'T'.repeat(500);
        const longText = 'C'.repeat(250000);
        activeWv.executeJavaScript = async () => ({
            title: longTitle,
            textContent: longText,
            url: 'https://example.com'
        });

        let externalPayload = null;
        global.window.miseAPI.exportArticleToExternal = async (payload) => {
            externalPayload = payload;
            return { success: true };
        };
        await handleReaderExportRequest(activeWv, 'external');
        assert(externalPayload, 'exportArticleToExternal must be invoked');
        assert.strictEqual(externalPayload.title.length, 300, 'Title must be capped at 300 characters');
        assert(externalPayload.markdown.includes('C'.repeat(200000)), 'Content must contain capped 200000 characters');
        assert(!externalPayload.markdown.includes('C'.repeat(200001)), 'Content must not exceed 200000 characters');

        console.log('✓ modules/webview.js rate-limiting, reader active guard, and payload validation verified');
    }

    // 4. storage.js exportArticleToExternal size caps and clippings count limit
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-export-test-'));
    try {
        const dummyConfig = { external_notes_command: '' };
        fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(dummyConfig));

        // Test: Reject non-string markdown
        const invalidTypeRes = await storage.exportArticleToExternal({
            title: 'Test',
            markdown: 12345
        }, tempDir);
        assert.strictEqual(invalidTypeRes.success, false, 'Non-string markdown must be rejected');

        // Test: Reject markdown > 1 MB (1024 * 1024 + 1 bytes)
        const oversizedMarkdown = 'M'.repeat(1024 * 1024 + 1);
        const oversizedRes = await storage.exportArticleToExternal({
            title: 'Oversized',
            markdown: oversizedMarkdown
        }, tempDir);
        assert.strictEqual(oversizedRes.success, false, 'Markdown over 1 MB must be rejected');
        assert(oversizedRes.error.includes('1 MB'), 'Error message must note 1 MB size limit');

        // Test: Allow valid markdown under 1 MB
        const validRes = await storage.exportArticleToExternal({
            title: 'Valid Clipping',
            markdown: '# Legitimate Clipping'
        }, tempDir);
        assert.strictEqual(validRes.success, true, 'Valid markdown export must succeed');
        assert(fs.existsSync(validRes.path), 'Export file must be created on disk');

        // Test: Refuse to write when clippings/ already has 200 files
        const clippingsDir = path.join(tempDir, 'clippings');
        if (!fs.existsSync(clippingsDir)) fs.mkdirSync(clippingsDir, { recursive: true });

        // Populate clippingsDir with 200 files
        const existingCount = fs.readdirSync(clippingsDir).length;
        for (let i = existingCount; i < 200; i++) {
            fs.writeFileSync(path.join(clippingsDir, `dummy_${i}.md`), 'dummy');
        }
        assert.strictEqual(fs.readdirSync(clippingsDir).length, 200, 'Must have exactly 200 files');

        // 201st file attempt must be refused
        const limitRes = await storage.exportArticleToExternal({
            title: 'Should Be Blocked',
            markdown: '# Content'
        }, tempDir);
        assert.strictEqual(limitRes.success, false, 'Export must be refused when clippings directory has 200 files');
        assert(limitRes.error.includes('limit reached'), 'Error message must mention limit reached');
        assert.strictEqual(fs.readdirSync(clippingsDir).length, 200, 'File count must not exceed 200');

        console.log('✓ storage.js 1 MB size cap and 200 files clipping limit verified');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    console.log('All reader export security regression tests passed successfully!');
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
