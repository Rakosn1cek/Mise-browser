// tests/pre-phase-4-hardening.test.js
// Regression tests for Pre-Phase 4: Focus, Link Hinting & Workspace Hardening

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Pre-Phase 4 hardening regression tests...');

// 1. Verify Address Bar webview focus restoration in modules/navigation.js
const navSource = fs.readFileSync(path.join(__dirname, '../modules/navigation.js'), 'utf8');

const applyTargetUrlMatch = navSource.match(/function applyTargetUrl\(targetUrl\) \{([\s\S]*?)\n\}/);
assert.ok(applyTargetUrlMatch, 'applyTargetUrl must be defined in modules/navigation.js');

const applyBody = applyTargetUrlMatch[1];
assert.ok(
    applyBody.includes('dismissAddressBar(addressBar);') && applyBody.includes('focusActiveWebview();'),
    'applyTargetUrl must invoke focusActiveWebview() after dismissAddressBar()'
);

// Functional test of applyTargetUrl focus restoration
{
    let focused = false;
    let dismissed = false;

    const mockState = {
        sessionState: {
            current_workspace: 'Workspace 1',
            workspaces: { 'Workspace 1': ['https://example.com'] }
        },
        activeViewsCache: {
            'Workspace 1': [{ setAttribute: () => {} }]
        }
    };

    const mockDoc = {
        getElementById: (id) => {
            if (id === 'WideAddressBar') return { style: {}, blur: () => {} };
            return null;
        },
        querySelector: (sel) => {
            if (sel === '#TabList li.selected') return { id: 'tab-0' };
            return null;
        },
        querySelectorAll: (sel) => {
            if (sel === '#TabList li') return [{ id: 'tab-0' }];
            return [];
        }
    };

    const mockWin = {
        miseAPI: { saveSession: () => {} }
    };

    const strippedNav = navSource
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
        `${strippedNav}\nreturn { applyTargetUrl };`
    );

    const { applyTargetUrl } = factory(
        mockState, mockDoc, mockWin, () => false, () => '', () => {},
        () => '', () => '', () => '',
        () => null, () => { focused = true; }, () => {}, () => {}
    );

    applyTargetUrl('https://example.org/docs');
    assert.equal(focused, true, 'applyTargetUrl must trigger focusActiveWebview upon navigation');
}
console.log('✓ Address Bar webview focus restoration verified');

// 2. Verify Hinter script injection decoupling in modules/webview.js
const webviewSource = fs.readFileSync(path.join(__dirname, '../modules/webview.js'), 'utf8');

const domReadyIndex = webviewSource.indexOf("webview.addEventListener('dom-ready'");
assert.ok(domReadyIndex !== -1, "modules/webview.js must register dom-ready listener");

const hinterCallIndex = webviewSource.indexOf('window.miseAPI.readHinterCode()', domReadyIndex);
const liveIdxGuardIndex = webviewSource.indexOf('if (liveIdx < 0) return;', domReadyIndex);

assert.ok(hinterCallIndex !== -1, 'readHinterCode must be invoked in dom-ready');
assert.ok(liveIdxGuardIndex !== -1, 'liveIdx guard must exist in dom-ready');
assert.ok(
    hinterCallIndex < liveIdxGuardIndex,
    'readHinterCode must execute prior to liveIdx < 0 guard so transferred and background tabs always receive hinter'
);

console.log('✓ Hinter script injection decoupling verified');

// 3. Verify Status Bar hint mode synchronisation in webview-preload.js
const preloadSource = fs.readFileSync(path.join(__dirname, '../webview-preload.js'), 'utf8');

assert.ok(
    preloadSource.includes('const targetNode = document.documentElement || document.body;'),
    'webview-preload.js must target document.documentElement or document.body for hint observer'
);

assert.ok(
    preloadSource.includes('observer.observe(targetNode, { childList: true });'),
    'webview-preload.js must observe targetNode childList mutations'
);

console.log('✓ Status Bar hint mode synchronisation verified');

// 4. Verify safe workspace deletion guards in modules/overlays/dashboard.js
const dashSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/dashboard.js'), 'utf8');

assert.ok(
    dashSource.includes('const nonPrivateWorkspaces = totalWorkspaces.filter(k => k !== \'Private\' && !isReservedWorkspaceName(k));') &&
    dashSource.includes('if (nonPrivateWorkspaces.length <= 1) return;'),
    'deleteWorkspace must protect the last surviving non-private workspace'
);

assert.ok(
    dashSource.includes('confirmWorkspaceDeletion(wsName);'),
    'Dashboard tree delete button must delegate to confirmWorkspaceDeletion'
);

assert.ok(
    dashSource.includes('const nonPrivateCount = wsKeys.filter(k => k !== \'Private\' && !isReservedWorkspaceName(k)).length;') &&
    dashSource.includes('if (nonPrivateCount > 1) {'),
    'Dashboard tree delete button must only appear when multiple non-private workspaces exist'
);

assert.ok(
    dashSource.includes('if (overlay && state.dashboardActive) overlay.focus();'),
    'confirmWorkspaceDeletion must re-focus DashboardOverlay when user cancels deletion prompt'
);

console.log('✓ Workspace Dashboard safe deletion and focus handling verified');

console.log('All Pre-Phase 4 hardening regression tests passed successfully!');
