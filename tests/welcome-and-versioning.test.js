// tests/welcome-and-versioning.test.js
// Regression test suite for canonical versioning, version synchronisation,
// and the First Run Welcome onboarding experience

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Running Mise welcome guide and versioning regression tests...');

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const welcomeHtmlPath = path.join(rootDir, 'assets', 'welcome.html');
const syncScriptPath = path.join(rootDir, 'scripts', 'sync-version.js');
const preloadPath = path.join(rootDir, 'preload.js');
const mainPath = path.join(rootDir, 'main.js');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// 1. Verify assets/welcome.html integrity and content
{
    assert(fs.existsSync(welcomeHtmlPath), 'assets/welcome.html must exist');
    const welcomeHtml = fs.readFileSync(welcomeHtmlPath, 'utf8');

    assert(welcomeHtml.includes('<!DOCTYPE html>'), 'Must contain valid HTML doctype');
    assert(welcomeHtml.includes('Welcome to Mise Browser'), 'Must contain welcome header title');
    assert(welcomeHtml.includes('Address Bar &amp; Search Bangs') || welcomeHtml.includes('Address Bar & Search Bangs'), 'Must document address bar and bangs');
    assert(welcomeHtml.includes('Vim-Inspired Link Hints'), 'Must document Link Hints mode');
    assert(welcomeHtml.includes('Dual Split Comparison View'), 'Must document split view');
    assert(welcomeHtml.includes('Accidental Closure Guard'), 'Must document closure guard for pinned tabs');
    assert(welcomeHtml.includes('Essential Shortcut Reference'), 'Must include shortcut cheat sheet table');

    // Verify zero double dashes in welcome guide text
    const lines = welcomeHtml.split('\n');
    let inStyleBlock = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('<style>')) inStyleBlock = true;
        if (line.includes('</style>')) { inStyleBlock = false; continue; }
        if (inStyleBlock) continue;
        if (line.includes('<!--') && line.includes('-->')) continue;
        assert(!line.includes('--'), `Line ${i + 1} in welcome.html must not contain double dashes: "${line}"`);
    }

    console.log('✓ Welcome guide assets and content verified');
}

// 2. Verify IPC wiring for welcome path across main and preload
{
    const mainContent = fs.readFileSync(mainPath, 'utf8');
    const preloadContent = fs.readFileSync(preloadPath, 'utf8');

    assert(mainContent.includes("ipcMain.on('get-welcome-path'"), 'main.js must register get-welcome-path IPC handler');
    assert(mainContent.includes("path.join(__dirname, 'assets', 'welcome.html')"), 'main.js must resolve assets/welcome.html');
    assert(preloadContent.includes("getWelcomePath: () => ipcRenderer.sendSync('get-welcome-path')"), 'preload.js must expose getWelcomePath API');

    console.log('✓ First run welcome path IPC channels verified');
}

// 3. Verify Command Palette registration for welcome guide
{
    const commandPalettePath = path.join(rootDir, 'modules', 'overlays', 'commandPalette.js');
    const cpContent = fs.readFileSync(commandPalettePath, 'utf8');

    assert(cpContent.includes("id: 'show-welcome'"), 'Command Palette must register show-welcome command');
    assert(cpContent.includes("title: 'Show Welcome & Quick Start Guide'"), 'show-welcome must have human readable title');

    console.log('✓ Command Palette welcome guide action verified');
}

// 4. Verify userscript wrapper dynamic version injection
{
    const { buildUserScriptWrapper } = require('../modules/userScriptShim.js');
    const mockItem = {
        name: 'Test Script',
        scriptId: 'test-123',
        code: 'console.log("hello");',
        meta: { name: 'Test Script', version: '2.4.1' }
    };

    const wrapperWithDynamicVer = buildUserScriptWrapper(mockItem, '1.2.3');
    assert(wrapperWithDynamicVer.includes('"1.2.3"'), 'Wrapper must inject the supplied application version');
    assert(!wrapperWithDynamicVer.includes('"0.15.0"'), 'Wrapper must not contain hardcoded 0.15.0');

    const wrapperDefault = buildUserScriptWrapper(mockItem);
    assert(wrapperDefault.includes('"1.0.0"'), 'Wrapper without version must fallback gracefully');

    console.log('✓ Userscript shim dynamic versioning verified');
}

// 5. Verify scripts/sync-version.js execution and consistency
{
    assert(fs.existsSync(syncScriptPath), 'scripts/sync-version.js must exist');
    const output = execSync('node scripts/sync-version.js', { cwd: rootDir, encoding: 'utf8' });
    assert(output.includes(`Synchronising repository files to Mise Browser v${pkg.version}...`), 'sync-version must report current package.json version');

    const readmeContent = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
    assert(readmeContent.includes(`Download Packages (v${pkg.version})`), 'README must reflect current package version');
    assert(readmeContent.includes(`Latest Release**: [**v${pkg.version}**]`), 'README latest release badge must match package version');

    console.log('✓ Version synchronisation automation verified');
}

console.log('All welcome guide & versioning tests passed successfully!');
