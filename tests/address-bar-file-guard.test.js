// tests/address-bar-file-guard.test.js
// Verification for address bar local file scheme navigation guards and PDF restriction

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise address bar local file navigation guard tests...');

// 1. Static code analysis of modules/navigation.js
{
    const navSource = fs.readFileSync(path.join(__dirname, '../modules/navigation.js'), 'utf8');

    // Verify presence of isPdfUrl check for local file candidates in handleNavigation
    assert(
        navSource.includes("trimmedInput.startsWith('/') || trimmedInput.startsWith('file://')"),
        'handleNavigation must detect local file schemes starting with / or file://'
    );
    assert(
        navSource.includes('isPdfUrl(candidateUrl)'),
        'handleNavigation must validate candidate file URLs against isPdfUrl'
    );
    assert(
        navSource.includes("setTargetUrl('Local file access restricted to PDF documents.', 4000)"),
        'handleNavigation must notify user when non-PDF local files are rejected'
    );

    // Verify secondary guard in applyTargetUrl
    assert(
        navSource.includes("(targetUrl.startsWith('file:') || targetUrl.startsWith('/')) && !isPdfUrl(targetUrl)"),
        'applyTargetUrl must enforce secondary guard rejecting non-PDF local files'
    );

    console.log('✓ modules/navigation.js file scheme restriction and PDF validation verified');
}

// 2. Functional testing of address bar navigation logic
{
    const navSource = fs.readFileSync(path.join(__dirname, '../modules/navigation.js'), 'utf8');

    // Mock dependencies and state
    let targetStatusMsg = '';
    function mockSetTargetUrl(msg) {
        targetStatusMsg = msg;
    }

    function mockIsPdfUrl(url) {
        if (!url || typeof url !== 'string') return false;
        try {
            const parsed = new URL(url);
            return parsed.pathname.toLowerCase().endsWith('.pdf');
        } catch (e) {
            const clean = url.split('?')[0].split('#')[0];
            return clean.toLowerCase().endsWith('.pdf');
        }
    }

    function mockGetPdfViewerUrl(targetUrl) {
        return `assets/pdfjs/viewer.html?file=${encodeURIComponent(targetUrl)}`;
    }

    function mockFormatSearchUrl(query, template) {
        return (template || 'https://duckduckgo.com/?q=%s').replace('%s', encodeURIComponent(query));
    }

    function mockResolveSearchAliasUrl() {
        return null;
    }

    function mockEvaluateMathExpression() {
        return null;
    }

    function mockExtractDdgBang() {
        return null;
    }

    let activeWebviewFocused = false;
    function mockFocusActiveWebview() {
        activeWebviewFocused = true;
    }

    let savedSessionState = null;
    let suggestionsHidden = false;
    let addressBarDisplay = 'block';

    const mockState = {
        sessionState: {
            current_workspace: 'default',
            workspaces: {
                default: ['https://initial.example.org']
            }
        },
        activeViewsCache: {
            default: [{
                src: 'https://initial.example.org',
                setAttribute(attr, val) {
                    if (attr === 'src') this.src = val;
                }
            }]
        },
        customSearchAliases: {},
        addressSuggestions: [],
        addressSelectionIdx: -1
    };

    const selectedTab = { id: 'tab-0' };
    function mockWakeTab() {}
    function mockRenderWorkspaceUI() {}

    const mockDocument = {
        querySelector(selector) {
            if (selector === '#TabList li.selected') {
                return selectedTab;
            }
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '#TabList li') {
                return [selectedTab];
            }
            return [];
        },
        getElementById(id) {
            if (id === 'WideAddressBar') {
                return {
                    style: {
                        get display() { return addressBarDisplay; },
                        set display(val) { addressBarDisplay = val; }
                    },
                    blur() { addressBarDisplay = 'none'; },
                    value: ''
                };
            }
            if (id === 'AddressSuggestions') {
                return {
                    style: { display: 'none' },
                    innerHTML: ''
                };
            }
            return null;
        }
    };

    const mockWindow = {
        miseAPI: {
            saveSession: (s) => { savedSessionState = JSON.parse(JSON.stringify(s)); },
            getBrowserSettings: async () => ({ search_engine: 'https://duckduckgo.com/?q=%s' })
        }
    };

    // Prepare sandbox runner for handleNavigation and applyTargetUrl
    const strippedSource = navSource
        .replace(/import\s+[^;]+;\s*/g, '')
        .replace('export const POPULAR_BANGS', 'const POPULAR_BANGS')
        .replace('export function dismissAddressBar', 'function dismissAddressBar')
        .replace('export function extractDdgBang', 'function extractDdgBang')
        .replace('export function displayAddressOverlay', 'function displayAddressOverlay')
        .replace('export async function handleNavigation', 'async function handleNavigation')
        .replace('export function setupAddressBarAutocomplete', 'function setupAddressBarAutocomplete')
        .replace('export function renderSuggestions', 'function renderSuggestions')
        .replace('export function updateSuggestionHighlight', 'function updateSuggestionHighlight')
        .replace('export async function selectSuggestion', 'async function selectSuggestion')
        .replace('export function hideSuggestions', 'function hideSuggestions');

    const factory = new Function(
        'state', 'document', 'window', 'isPdfUrl', 'getPdfViewerUrl', 'setTargetUrl',
        'formatSearchUrl', 'resolveSearchAliasUrl', 'evaluateMathExpression',
        'extractDdgBang', 'focusActiveWebview', 'wakeTab', 'renderWorkspaceUI',
        `${strippedSource}\nreturn { handleNavigation, applyTargetUrl };`
    );

    const { handleNavigation, applyTargetUrl } = factory(
        mockState, mockDocument, mockWindow, mockIsPdfUrl, mockGetPdfViewerUrl,
        mockSetTargetUrl, mockFormatSearchUrl, mockResolveSearchAliasUrl,
        mockEvaluateMathExpression, mockExtractDdgBang, mockFocusActiveWebview,
        mockWakeTab, mockRenderWorkspaceUI
    );

    async function runTest() {
        // Test A: Reject arbitrary unix file path (/etc/passwd)
        targetStatusMsg = '';
        activeWebviewFocused = false;
        addressBarDisplay = 'block';
        await handleNavigation('/etc/passwd');

        assert.equal(targetStatusMsg, 'Local file access restricted to PDF documents.');
        assert.equal(mockState.sessionState.workspaces.default[0], 'https://initial.example.org', 'Workspace tab must not be altered');
        assert.equal(mockState.activeViewsCache.default[0].src, 'https://initial.example.org', 'Webview src must not be modified');
        assert.equal(addressBarDisplay, 'none', 'Address bar must close upon rejection');
        assert.equal(activeWebviewFocused, true, 'Active webview focus must be restored');

        // Test B: Reject explicit file scheme to sensitive file (file:///etc/shadow)
        targetStatusMsg = '';
        await handleNavigation('file:///etc/shadow');
        assert.equal(targetStatusMsg, 'Local file access restricted to PDF documents.');
        assert.equal(mockState.sessionState.workspaces.default[0], 'https://initial.example.org');

        // Test C: Reject local HTML and source file navigation
        targetStatusMsg = '';
        await handleNavigation('/home/user/page.html');
        assert.equal(targetStatusMsg, 'Local file access restricted to PDF documents.');
        assert.equal(mockState.sessionState.workspaces.default[0], 'https://initial.example.org');

        targetStatusMsg = '';
        await handleNavigation('file:///var/log/syslog');
        assert.equal(targetStatusMsg, 'Local file access restricted to PDF documents.');
        assert.equal(mockState.sessionState.workspaces.default[0], 'https://initial.example.org');

        // Test D: Permit valid local PDF file path
        targetStatusMsg = '';
        await handleNavigation('/home/user/document.pdf');
        assert.equal(targetStatusMsg, '', 'Valid PDF must not trigger rejection warning');
        assert.equal(mockState.sessionState.workspaces.default[0], 'file:///home/user/document.pdf', 'Tab URL must reflect PDF document');
        assert.equal(
            mockState.activeViewsCache.default[0].src,
            'assets/pdfjs/viewer.html?file=file%3A%2F%2F%2Fhome%2Fuser%2Fdocument.pdf',
            'Webview src must route through vendored PDF viewer'
        );

        // Test E: Permit file:// URL with uppercase .PDF extension
        await handleNavigation('file:///home/user/manual.PDF');
        assert.equal(mockState.sessionState.workspaces.default[0], 'file:///home/user/manual.PDF');
        assert(mockState.activeViewsCache.default[0].src.includes('viewer.html'));

        // Test F: Secondary guard in applyTargetUrl directly
        targetStatusMsg = '';
        mockState.sessionState.workspaces.default[0] = 'https://initial.example.org';
        mockState.activeViewsCache.default[0].src = 'https://initial.example.org';
        applyTargetUrl('file:///etc/hosts');
        assert.equal(targetStatusMsg, 'Local file access restricted to PDF documents.');
        assert.equal(mockState.sessionState.workspaces.default[0], 'https://initial.example.org');

        // Test G: Standard web URL navigation remains intact
        await handleNavigation('https://github.com/rakosn1cek/mise-browser');
        assert.equal(mockState.sessionState.workspaces.default[0], 'https://github.com/rakosn1cek/mise-browser');
        assert.equal(mockState.activeViewsCache.default[0].src, 'https://github.com/rakosn1cek/mise-browser');

        console.log('✓ Address bar navigation guard successfully isolates local file schemes and permits PDFs');
        console.log('All address bar local file navigation guard tests passed successfully!');
    }

    runTest().catch((err) => {
        console.error('Test execution failed:', err);
        process.exit(1);
    });
}
