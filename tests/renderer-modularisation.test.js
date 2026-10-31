// tests/renderer-modularisation.test.js
// Verification for renderer process modularisation and orchestrator architecture

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise renderer process modularisation regression tests...');

const rendererDir = path.join(__dirname, '../modules/renderer');
const rendererFile = path.join(__dirname, '../renderer.js');

// 1. Verify existence and non-empty status of all 5 domain controllers
{
    const expectedControllers = [
        'browserInit.js',
        'sidebarController.js',
        'workspaceController.js',
        'themeController.js',
        'pageSearch.js'
    ];

    expectedControllers.forEach((file) => {
        const filePath = path.join(rendererDir, file);
        assert(fs.existsSync(filePath), `modules/renderer/${file} must exist on disk`);
        const stats = fs.statSync(filePath);
        assert(stats.size > 200, `modules/renderer/${file} must be populated with implementation logic`);
    });

    console.log('✓ All 5 specialised renderer controllers exist and are populated on disk');
}

// 2. Verify controller export signatures and declarations
{
    const themeSource = fs.readFileSync(path.join(rendererDir, 'themeController.js'), 'utf8');
    assert(themeSource.includes('export function updateWebviewThemeButtonUI'), 'themeController must export updateWebviewThemeButtonUI');
    assert(themeSource.includes('export function toggleWebviewTheme'), 'themeController must export toggleWebviewTheme');
    assert(themeSource.includes('export function toggleInterfaceTheme'), 'themeController must export toggleInterfaceTheme');
    assert(themeSource.includes('export function initThemeState'), 'themeController must export initThemeState');

    const searchSource = fs.readFileSync(path.join(rendererDir, 'pageSearch.js'), 'utf8');
    assert(searchSource.includes('export function toggleInPageSearch'), 'pageSearch must export toggleInPageSearch');
    assert(searchSource.includes('export function setupPageSearchListeners'), 'pageSearch must export setupPageSearchListeners');

    const workspaceSource = fs.readFileSync(path.join(rendererDir, 'workspaceController.js'), 'utf8');
    assert(workspaceSource.includes('export function togglePrivateWorkspace'), 'workspaceController must export togglePrivateWorkspace');
    assert(workspaceSource.includes('export function handlePrivateBrowsingStateShift'), 'workspaceController must export handlePrivateBrowsingStateShift');
    assert(workspaceSource.includes('export async function executeSurgicalCookieWipe'), 'workspaceController must export executeSurgicalCookieWipe');
    assert(workspaceSource.includes('export async function executeGlobalCacheWipe'), 'workspaceController must export executeGlobalCacheWipe');
    assert(workspaceSource.includes('export async function testCleanGoogleSignIn'), 'workspaceController must export testCleanGoogleSignIn');
    assert(workspaceSource.includes('export function setupWorkspaceListeners'), 'workspaceController must export setupWorkspaceListeners');

    const sidebarSource = fs.readFileSync(path.join(rendererDir, 'sidebarController.js'), 'utf8');
    assert(sidebarSource.includes('export function applySidebarMode'), 'sidebarController must export applySidebarMode');
    assert(sidebarSource.includes('export function toggleSidebarExpansion'), 'sidebarController must export toggleSidebarExpansion');
    assert(sidebarSource.includes('export async function toggleSidebarPin'), 'sidebarController must export toggleSidebarPin');
    assert(sidebarSource.includes('export function focusSidebar'), 'sidebarController must export focusSidebar');
    assert(sidebarSource.includes('export function setupSidebarListeners'), 'sidebarController must export setupSidebarListeners');
    assert(sidebarSource.includes('export const defaultOverlayIds'), 'sidebarController must export defaultOverlayIds');

    const initSource = fs.readFileSync(path.join(rendererDir, 'browserInit.js'), 'utf8');
    assert(initSource.includes('export async function initializeBrowser'), 'browserInit must export initializeBrowser');
    assert(initSource.includes('export function setupCoreUIListeners'), 'browserInit must export setupCoreUIListeners');

    console.log('✓ Specialised controller export contracts and signatures verified');
}

// 3. Verify renderer.js line budget (<250 lines)
{
    const content = fs.readFileSync(rendererFile, 'utf8');
    const totalLines = content.split('\n').length;
    assert(
        totalLines <= 250,
        `renderer.js must remain under 250 lines as a lean orchestrator (currently ${totalLines} lines)`
    );

    console.log(`✓ renderer.js line count capped under 250 lines (currently ${totalLines} lines)`);
}

// 4. Verify renderer.js imports and orchestrates all 5 controllers
{
    const content = fs.readFileSync(rendererFile, 'utf8');

    assert(content.includes('./modules/renderer/themeController.js'), 'renderer.js must import themeController');
    assert(content.includes('./modules/renderer/pageSearch.js'), 'renderer.js must import pageSearch');
    assert(content.includes('./modules/renderer/workspaceController.js'), 'renderer.js must import workspaceController');
    assert(content.includes('./modules/renderer/sidebarController.js'), 'renderer.js must import sidebarController');
    assert(content.includes('./modules/renderer/browserInit.js'), 'renderer.js must import browserInit');

    assert(content.includes("document.addEventListener('DOMContentLoaded', initializeBrowser);"), 'renderer.js must hook DOMContentLoaded to initializeBrowser');

    console.log('✓ Subsystem controller aggregation and lifecycle orchestration verified');
}

// 5. Verify preservation of critical static test contracts in renderer.js
{
    const content = fs.readFileSync(rendererFile, 'utf8');

    assert(content.includes("'PeekModalOverlay'"), 'renderer.js must retain PeekModalOverlay in overlay list');
    assert(content.includes('function triggerGlanceHints()'), 'renderer.js must retain function triggerGlanceHints()');
    assert(content.includes('export async function triggerUpdateCheck'), 'renderer.js must retain export async function triggerUpdateCheck');
    assert(content.includes("case 'cycle-webrtc-policy':"), 'renderer.js must retain cycle-webrtc-policy shortcut');
    assert(content.includes("case 'toggle-webrtc-protection':"), 'renderer.js must retain toggle-webrtc-protection shortcut');
    assert(content.includes("case 'webrtc-policy-changed':"), 'renderer.js must retain webrtc-policy-changed shortcut');

    console.log('✓ Static test contracts and shortcut routes in renderer.js verified');
}

console.log('All Mise renderer process modularisation regression tests passed successfully!');
