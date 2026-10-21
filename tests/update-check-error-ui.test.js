// tests/update-check-error-ui.test.js
// Verification for update check error UI feedback and diagnostics logging

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise update check error UI regression tests...');

// 1. Static code analysis of renderer.js
{
    const source = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');

    // Verify error detection in result payload
    assert(
        source.includes('if (result && result.error)'),
        'renderer.js must check result.error to prevent misleading up to date status'
    );

    // Verify error text formatting in banner
    assert(
        source.includes('textEl.textContent = `Update check failed: ${result.error}`;'),
        'renderer.js must display descriptive error text in UpdateNotificationBanner'
    );

    // Verify action button is hidden on error
    assert(
        source.includes("if (actionBtn) actionBtn.style.display = 'none';"),
        'renderer.js must hide actionBtn when update check fails'
    );

    // Verify diagnostics event logging for result errors
    assert(
        source.includes("category: 'updater'") &&
        source.includes("level: 'warn'") &&
        source.includes('window.miseAPI.logDiagnosticsEvent'),
        'renderer.js must record a diagnostic event on update check failure'
    );

    // Verify catch block displays error details and logs diagnostics
    assert(
        source.includes('textEl.textContent = `Update check failed: ${errorMsg}`;'),
        'renderer.js catch handler must display informative error text in banner'
    );

    console.log('✓ renderer.js update check error guards and diagnostics integration verified');
}

// 2. Functional verification of triggerUpdateCheck UI states
(async () => {
    // Helper to create mock DOM elements
    function createMockElements() {
        const checkBtn = {
            disabled: false,
            textContent: 'Check for Updates'
        };
        const banner = {
            style: { display: 'none' }
        };
        const textEl = {
            textContent: ''
        };
        const actionBtn = {
            style: { display: 'none' },
            onclick: null
        };
        const sidebarIndicator = {
            style: { display: 'none' },
            title: '',
            onclick: null
        };

        const elements = {
            CheckForUpdatesBtn: checkBtn,
            UpdateNotificationBanner: banner,
            UpdateNotificationText: textEl,
            UpdateActionBtn: actionBtn,
            'update-indicator-btn': sidebarIndicator
        };

        const mockDocument = {
            getElementById: (id) => elements[id] || null
        };

        return { elements, mockDocument };
    }

    // Dynamic execution of triggerUpdateCheck logic using simulated scope
    const rendererSource = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
    const updateCheckFnMatch = rendererSource.match(/export async function triggerUpdateCheck\([\s\S]*?\n\}/);
    assert(updateCheckFnMatch, 'triggerUpdateCheck function declaration must be present');

    const fnBody = updateCheckFnMatch[0].replace('export async function triggerUpdateCheck', 'async function triggerUpdateCheck');

    // Case A: Upstream error returned in result payload (e.g. rate limit, offline)
    {
        const { elements, mockDocument } = createMockElements();
        const loggedEvents = [];

        const mockAPI = {
            checkForUpdates: async () => ({
                error: 'GitHub API returned status 403',
                updateAvailable: false,
                currentVersion: '1.1.0',
                manual: true
            }),
            logDiagnosticsEvent: async (data) => {
                loggedEvents.push(data);
            }
        };

        const runTest = new Function(
            'document',
            'window',
            'displayUpdateNotification',
            `return (async () => {
                ${fnBody}
                await triggerUpdateCheck(true);
            })();`
        );

        await runTest(mockDocument, { miseAPI: mockAPI }, () => {});

        assert.equal(elements.CheckForUpdatesBtn.textContent, 'Check Failed', 'Button must indicate check failed');
        assert.equal(elements.UpdateNotificationBanner.style.display, 'flex', 'Banner must be visible');
        assert.equal(
            elements.UpdateNotificationText.textContent,
            'Update check failed: GitHub API returned status 403',
            'Banner must explain exact failure reason'
        );
        assert.equal(elements.UpdateActionBtn.style.display, 'none', 'Action button must remain hidden');
        assert.equal(loggedEvents.length, 1, 'Diagnostic event must be emitted');
        assert.equal(loggedEvents[0].level, 'warn');
        assert.equal(loggedEvents[0].category, 'updater');
        assert.equal(loggedEvents[0].message, 'Update check failed: GitHub API returned status 403');
    }

    // Case B: Thrown network exception (e.g. promise rejection or timeout)
    {
        const { elements, mockDocument } = createMockElements();
        const loggedEvents = [];

        const mockAPI = {
            checkForUpdates: async () => {
                throw new Error('Connection timed out after 10000ms');
            },
            logDiagnosticsEvent: async (data) => {
                loggedEvents.push(data);
            }
        };

        const runTest = new Function(
            'document',
            'window',
            'displayUpdateNotification',
            `return (async () => {
                ${fnBody}
                await triggerUpdateCheck(true);
            })();`
        );

        await runTest(mockDocument, { miseAPI: mockAPI }, () => {});

        assert.equal(elements.CheckForUpdatesBtn.textContent, 'Check Failed', 'Button must indicate check failed on exception');
        assert.equal(elements.UpdateNotificationBanner.style.display, 'flex', 'Banner must display error');
        assert.equal(
            elements.UpdateNotificationText.textContent,
            'Update check failed: Connection timed out after 10000ms',
            'Banner must show exception message'
        );
        assert.equal(elements.UpdateActionBtn.style.display, 'none', 'Action button must be hidden');
        assert.equal(loggedEvents.length, 1, 'Diagnostic error event must be logged');
        assert.equal(loggedEvents[0].message, 'Update check failed: Connection timed out after 10000ms');
    }

    // Case C: Successful check when up to date
    {
        const { elements, mockDocument } = createMockElements();
        const loggedEvents = [];

        const mockAPI = {
            checkForUpdates: async () => ({
                updateAvailable: false,
                currentVersion: '1.1.0',
                manual: true
            }),
            logDiagnosticsEvent: async (data) => {
                loggedEvents.push(data);
            }
        };

        const runTest = new Function(
            'document',
            'window',
            'displayUpdateNotification',
            `return (async () => {
                ${fnBody}
                await triggerUpdateCheck(true);
            })();`
        );

        await runTest(mockDocument, { miseAPI: mockAPI }, () => {});

        assert.equal(elements.CheckForUpdatesBtn.textContent, 'Up to Date', 'Button must show up to date');
        assert.equal(elements.UpdateNotificationBanner.style.display, 'flex');
        assert.equal(elements.UpdateNotificationText.textContent, 'Mise v1.1.0 is currently up to date.');
        assert.equal(elements.UpdateActionBtn.style.display, 'none');
        assert.equal(loggedEvents.length, 0, 'No warning diagnostics should be logged when up to date');
    }

    console.log('✓ Functional error states, banner notifications, and diagnostics logging verified');
    console.log('All update check error UI regression tests passed successfully!');
})();
