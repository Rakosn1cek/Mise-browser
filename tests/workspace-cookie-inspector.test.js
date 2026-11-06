// tests/workspace-cookie-inspector.test.js
// Automated verification for workspace container cookie inspector and purge controls

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise workspace cookie inspector regression tests...');

// 1. Static verification of preload.js API exposure
{
    const preloadSource = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
    assert.ok(
        preloadSource.includes("getWorkspaceCookieCounts: (workspaces) => ipcRenderer.invoke('get-workspace-cookie-counts', workspaces)"),
        'preload.js must expose getWorkspaceCookieCounts'
    );
    assert.ok(
        preloadSource.includes("clearWorkspaceCookies: (workspace) => ipcRenderer.invoke('clear-workspace-cookies', workspace)"),
        'preload.js must expose clearWorkspaceCookies'
    );
    console.log('✓ preload.js API methods for workspace cookie inspection and purging verified');
}

// 2. Static verification of main.js IPC handlers
{
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    assert.ok(
        mainSource.includes("ipcMain.handle('get-workspace-cookie-counts'"),
        'main.js must register get-workspace-cookie-counts IPC handler'
    );
    assert.ok(
        mainSource.includes("ipcMain.handle('clear-workspace-cookies'"),
        'main.js must register clear-workspace-cookies IPC handler'
    );
    assert.ok(
        mainSource.includes("getSessionForContext({ workspace: ws })"),
        'get-workspace-cookie-counts must route via getSessionForContext'
    );
    assert.ok(
        mainSource.includes("targetSession.clearStorageData({ storages: ['cookies'] })"),
        'clear-workspace-cookies must clear cookie storages on targetSession'
    );
    console.log('✓ main.js IPC handler registrations and isolation logic verified');
}

// 3. Verification of workspaceController.js exports
{
    const wcSource = fs.readFileSync(path.join(__dirname, '../modules/renderer/workspaceController.js'), 'utf8');
    assert.ok(
        wcSource.includes('export async function fetchWorkspaceCookieCounts'),
        'workspaceController.js must export fetchWorkspaceCookieCounts'
    );
    assert.ok(
        wcSource.includes('export async function purgeWorkspaceCookies'),
        'workspaceController.js must export purgeWorkspaceCookies'
    );
    console.log('✓ workspaceController.js controller exports verified');
}

// 4. Verification of dashboard.js integration
{
    const dashSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/dashboard.js'), 'utf8');
    assert.ok(
        dashSource.includes('workspace-cookie-tag'),
        'dashboard.js must create workspace-cookie-tag element'
    );
    assert.ok(
        dashSource.includes('workspace-purge-btn'),
        'dashboard.js must render workspace-purge-btn in actionsDiv'
    );
    assert.ok(
        dashSource.includes('purgeCookiesBtn.blur()') && dashSource.includes('overlay.focus()'),
        'dashboard.js must blur purge button and restore overlay focus'
    );
    assert.ok(
        dashSource.includes('export async function updateDashboardCookieCounts'),
        'dashboard.js must export updateDashboardCookieCounts'
    );
    console.log('✓ dashboard.js cookie badge, purge button, focus release, and counter updater verified');
}

// 5. Verification of arrow key focus release in workspaceController.js
{
    const wcSource = fs.readFileSync(path.join(__dirname, '../modules/renderer/workspaceController.js'), 'utf8');
    assert.ok(
        wcSource.includes("document.activeElement.tagName === 'BUTTON'") && wcSource.includes('document.activeElement.blur()'),
        'workspaceController.js must blur active button on arrow navigation to avoid trapping Enter'
    );
    console.log('✓ workspaceController.js arrow navigation button focus release verified');
}

// 5. Verification of Preferences template description
{
    const prefSource = fs.readFileSync(path.join(__dirname, '../templates/preferences.html'), 'utf8');
    assert.ok(
        prefSource.includes("active tab's domain"),
        'preferences.html must clearly distinguish active tab domain site data'
    );
    console.log('✓ preferences.html domain scope clarification verified');
}

// 6. Functional simulation of purgeWorkspaceCookies confirmation and IPC dispatch
{
    const { purgeWorkspaceCookies, fetchWorkspaceCookieCounts } = require('../modules/renderer/workspaceController.js');

    // Mock global window and miseAPI
    let lastClearedWorkspace = null;
    let confirmPromptCalled = false;
    let confirmResponse = true;

    global.window = {
        confirm: (msg) => {
            confirmPromptCalled = true;
            assert.ok(msg.includes('Work'), 'Confirmation prompt must include workspace name');
            return confirmResponse;
        },
        miseAPI: {
            clearWorkspaceCookies: async (ws) => {
                lastClearedWorkspace = ws;
                return true;
            },
            getWorkspaceCookieCounts: async (workspaces) => {
                return { 'Work': 12, 'Personal': 48, 'Private': 0 };
            }
        }
    };

    (async () => {
        // Test confirmation cancellation
        confirmResponse = false;
        const cancelResult = await purgeWorkspaceCookies('Work');
        assert.strictEqual(cancelResult, false, 'Cancelled purge must return false');
        assert.strictEqual(lastClearedWorkspace, null, 'Cancelled purge must not dispatch IPC');

        // Test confirmation approval
        confirmResponse = true;
        const approveResult = await purgeWorkspaceCookies('Work');
        assert.strictEqual(approveResult, true, 'Approved purge must return true');
        assert.strictEqual(lastClearedWorkspace, 'Work', 'Approved purge must dispatch IPC for Work workspace');

        // Test cookie count fetching
        const counts = await fetchWorkspaceCookieCounts(['Work', 'Personal', 'Private']);
        assert.deepStrictEqual(counts, { 'Work': 12, 'Personal': 48, 'Private': 0 });

        console.log('✓ Functional simulation of purge confirmation and IPC dispatch verified');
        console.log('All workspace cookie inspector regression tests passed successfully!\n');
    })();
}
