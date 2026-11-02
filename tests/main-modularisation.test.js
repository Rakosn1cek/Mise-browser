// tests/main-modularisation.test.js
// Verification for main process modularisation and subsystem architecture

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise main process modularisation regression tests...');

const mainDir = path.join(__dirname, '../main');
const mainFile = path.join(__dirname, '../main.js');

// 1. Verify existence and non-empty status of all 4 extracted subsystem modules
{
    const expectedModules = [
        'contextMenus.js',
        'systemIpc.js',
        'webContentsPolicy.js',
        'windowManager.js'
    ];

    expectedModules.forEach((file) => {
        const filePath = path.join(mainDir, file);
        assert(fs.existsSync(filePath), `main/${file} must exist on disk`);
        const stats = fs.statSync(filePath);
        assert(stats.size > 200, `main/${file} must be populated with implementation logic`);
    });

    console.log('✓ All 4 specialised main process subsystems exist and are populated on disk');
}

// 2. Verify subsystem module export signatures
{
    const contextMenus = require('../main/contextMenus');
    assert.equal(typeof contextMenus.buildSettingsSubmenu, 'function', 'contextMenus must export buildSettingsSubmenu');
    assert.equal(typeof contextMenus.openSettingsMenu, 'function', 'contextMenus must export openSettingsMenu');
    assert.equal(typeof contextMenus.buildWebviewContextMenu, 'function', 'contextMenus must export buildWebviewContextMenu');
    assert.equal(typeof contextMenus.showWebviewContextMenu, 'function', 'contextMenus must export showWebviewContextMenu');
    assert.equal(typeof contextMenus.setMainWindowGetter, 'function', 'contextMenus must export setMainWindowGetter');

    const systemIpc = require('../main/systemIpc');
    assert.equal(typeof systemIpc.registerSystemIpc, 'function', 'systemIpc must export registerSystemIpc');
    assert.equal(typeof systemIpc.initializeMemoryWatcher, 'function', 'systemIpc must export initializeMemoryWatcher');
    assert.equal(typeof systemIpc.compactMemory, 'function', 'systemIpc must export compactMemory');

    const webContentsPolicy = require('../main/webContentsPolicy');
    assert.equal(typeof webContentsPolicy.setupWebContentsPolicy, 'function', 'webContentsPolicy must export setupWebContentsPolicy');
    assert.equal(typeof webContentsPolicy.attachWebviewSecurityGuards, 'function', 'webContentsPolicy must export attachWebviewSecurityGuards');

    const windowManager = require('../main/windowManager');
    assert.equal(typeof windowManager.createMainWindow, 'function', 'windowManager must export createMainWindow');
    assert.equal(typeof windowManager.getMainWindow, 'function', 'windowManager must export getMainWindow');
    assert.equal(typeof windowManager.setRendererReady, 'function', 'windowManager must export setRendererReady');
    assert.equal(typeof windowManager.isWindowReady, 'function', 'windowManager must export isWindowReady');
    assert.equal(typeof windowManager.extractUrlsFromArgs, 'function', 'windowManager must export extractUrlsFromArgs');
    assert.equal(typeof windowManager.dispatchTabUrl, 'function', 'windowManager must export dispatchTabUrl');
    assert.equal(typeof windowManager.flushPendingUrls, 'function', 'windowManager must export flushPendingUrls');
    assert.equal(typeof windowManager.handleAppAction, 'function', 'windowManager must export handleAppAction');
    assert.equal(typeof windowManager.registerWindowIpc, 'function', 'windowManager must export registerWindowIpc');

    console.log('✓ Subsystem module export contracts and signatures verified');
}

// 3. Verify main.js line count reduction and bounded budget
{
    const content = fs.readFileSync(mainFile, 'utf8');
    const totalLines = content.split('\n').length;
    assert(
        totalLines <= 550,
        `main.js must remain bounded as a modular coordinator (currently ${totalLines} lines)`
    );

    console.log(`✓ main.js line count capped under budget (currently ${totalLines} lines, down from 1411 lines)`);
}

// 4. Verify main.js orchestrates all 4 extracted subsystems
{
    const content = fs.readFileSync(mainFile, 'utf8');

    assert(content.includes("./main/contextMenus"), 'main.js must import contextMenus');
    assert(content.includes("./main/systemIpc"), 'main.js must import systemIpc');
    assert(content.includes("./main/webContentsPolicy"), 'main.js must import webContentsPolicy');
    assert(content.includes("./main/windowManager"), 'main.js must import windowManager');

    assert(content.includes('contextMenus.setMainWindowGetter('), 'main.js must initialise contextMenus window getter');
    assert(content.includes('systemIpc.registerSystemIpc('), 'main.js must register systemIpc handlers');
    assert(content.includes('webContentsPolicy.setupWebContentsPolicy('), 'main.js must wire webContentsPolicy');
    assert(content.includes('registerWindowIpc('), 'main.js must register windowManager IPC');
    assert(content.includes('createMainWindow('), 'main.js must invoke createMainWindow in app bootstrap');

    console.log('✓ Subsystem orchestration and coordinator wiring verified');
}

// 5. Verify security invariants across coordinator and modules
{
    const mainContent = fs.readFileSync(mainFile, 'utf8');
    const policyContent = fs.readFileSync(path.join(mainDir, 'webContentsPolicy.js'), 'utf8');
    const systemContent = fs.readFileSync(path.join(mainDir, 'systemIpc.js'), 'utf8');
    const windowContent = fs.readFileSync(path.join(mainDir, 'windowManager.js'), 'utf8');

    // Partition boundary validation
    assert(mainContent.includes('security.isValidPartitionName'), 'main.js must validate partition names');
    assert(mainContent.includes('MisePrivateProfile'), 'main.js must enforce MisePrivateProfile partition isolation');

    // Guest webview attachment isolation
    assert(policyContent.includes('security.prepareWebviewAttach'), 'webContentsPolicy must enforce prepareWebviewAttach');

    // Navigation and URL safety guards
    assert(windowContent.includes('security.isSafeTabUrl'), 'windowManager must guard tab URLs with isSafeTabUrl');
    assert(policyContent.includes('security.isSafeTabUrl'), 'webContentsPolicy must guard navigation with isSafeTabUrl');
    assert(mainContent.includes('security.isSafeTabUrl'), 'main.js must guard external URL dispatch with isSafeTabUrl');

    // Terminal command sanitisation and PDF access validation
    assert(systemContent.includes('security.sanitiseTerminalCommand'), 'systemIpc must sanitise terminal commands');
    assert(systemContent.includes('security.validatePdfAccess'), 'systemIpc must validate PDF access tokens');

    console.log('✓ Security invariants and container isolation rules verified across modules');
}

console.log('All Mise main process modularisation regression tests passed successfully!');
