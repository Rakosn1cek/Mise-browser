// tests/find-in-page.test.js
// Regression test suite for Find-in-Page match counter and Vim-style navigation

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running Mise Find-in-Page match counter & Vim navigation tests...');

// 1. Verify formatMatchCount pluralisation and counter formatting
{
    const pageSearchPath = path.join(__dirname, '../modules/renderer/pageSearch.js');
    const pageSearchSource = fs.readFileSync(pageSearchPath, 'utf8');

    // Extract formatMatchCount implementation for isolated unit testing
    const formatMatchCountMatch = pageSearchSource.match(/export function formatMatchCount\([\s\S]*?^}/m);
    assert(formatMatchCountMatch, 'formatMatchCount must be exported from pageSearch.js');

    const formatMatchCount = new Function(
        'activeOrdinal = 0',
        'totalMatches = 0',
        'hasQuery = true',
        `${formatMatchCountMatch[0].replace('export function formatMatchCount', 'function formatMatchCount')}; return formatMatchCount(activeOrdinal, totalMatches, hasQuery);`
    );

    // Empty query verification
    assert.strictEqual(formatMatchCount(0, 0, false), '', 'Empty queries must return blank string');
    assert.strictEqual(formatMatchCount(1, 5, false), '', 'Queries flagged as empty must return blank string');

    // Zero matches verification
    assert.strictEqual(formatMatchCount(0, 0, true), '0 matches', 'Zero matches must output 0 matches');
    assert.strictEqual(formatMatchCount(1, 0, true), '0 matches', 'Zero total matches must always output 0 matches');

    // Single match verification (singular)
    assert.strictEqual(formatMatchCount(1, 1, true), '1 of 1 match', 'Single match must output 1 of 1 match (singular)');
    assert.strictEqual(formatMatchCount(0, 1, true), '1 of 1 match', 'Initial zero ordinal for single match must normalise to 1 of 1 match');

    // Multiple matches verification (plural)
    assert.strictEqual(formatMatchCount(4, 21, true), '4 of 21 matches', 'Multiple matches must output exact ordinal of total matches');
    assert.strictEqual(formatMatchCount(1, 21, true), '1 of 21 matches', 'First match ordinal must format correctly');
    assert.strictEqual(formatMatchCount(21, 21, true), '21 of 21 matches', 'Final match ordinal must format correctly');
    assert.strictEqual(formatMatchCount(0, 5, true), '1 of 5 matches', 'Zero ordinal with multiple matches must normalise to 1');

    console.log('✓ formatMatchCount pluralisation and match formatting verified');
}

// 2. Verify templates/find-bar.html structural markup and accessibility
{
    const templatePath = path.join(__dirname, '../templates/find-bar.html');
    assert(fs.existsSync(templatePath), 'find-bar.html must exist');
    const templateSource = fs.readFileSync(templatePath, 'utf8');

    assert(templateSource.includes('id="FindBarOverlay"'), 'Must contain FindBarOverlay container');
    assert(templateSource.includes('role="search"'), 'Must specify search role for accessibility');
    assert(templateSource.includes('id="FindInput"'), 'Must contain FindInput text input');
    assert(templateSource.includes('id="FindCaseBtn"'), 'Must contain FindCaseBtn match case button');
    assert(!templateSource.includes('Alt+'), 'Find bar controls must never bind or mention Alt modifier');
    assert(templateSource.includes('id="FindMatchCount"'), 'Must contain FindMatchCount element');
    assert(templateSource.includes('id="FindPrevBtn"'), 'Must contain FindPrevBtn previous button');
    assert(templateSource.includes('id="FindNextBtn"'), 'Must contain FindNextBtn next button');
    assert(templateSource.includes('id="FindCloseBtn"'), 'Must contain FindCloseBtn close button');
    assert(templateSource.includes('fa-chevron-up'), 'Must use chevron-up icon for previous match');
    assert(templateSource.includes('fa-chevron-down'), 'Must use chevron-down icon for next match');
    assert(templateSource.includes('fa-xmark'), 'Must use xmark icon for close button');

    console.log('✓ templates/find-bar.html markup, controls, and accessibility verified');
}

// 3. Verify styles/overlays/findBar.css rules and states
{
    const cssPath = path.join(__dirname, '../styles/overlays/findBar.css');
    assert(fs.existsSync(cssPath), 'findBar.css must exist');
    const cssSource = fs.readFileSync(cssPath, 'utf8');

    assert(cssSource.includes('#FindBarOverlay'), 'CSS must define #FindBarOverlay');
    assert(cssSource.includes('#FindInput'), 'CSS must define #FindInput');
    assert(cssSource.includes('#FindMatchCount'), 'CSS must define #FindMatchCount');
    assert(cssSource.includes('#FindMatchCount.no-matches'), 'CSS must define no-matches class');
    assert(cssSource.includes('.find-bar-btn'), 'CSS must define .find-bar-btn button styling');
    assert(cssSource.includes('.find-bar-btn:hover'), 'CSS must define hover state');
    assert(cssSource.includes('.find-case-btn'), 'CSS must define .find-case-btn styling');
    assert(cssSource.includes('.find-case-btn.active'), 'CSS must define .find-case-btn.active state');

    console.log('✓ styles/overlays/findBar.css styling rules and states verified');
}

// 4. Verify modules/renderer/pageSearch.js exports and controller logic
{
    const pageSearchPath = path.join(__dirname, '../modules/renderer/pageSearch.js');
    const pageSearchSource = fs.readFileSync(pageSearchPath, 'utf8');

    const expectedExports = [
        'export let findActive',
        'export function formatMatchCount',
        'export function updateFindMatchCount',
        'export function findInPageNext',
        'export function findInPagePrevious',
        'export function toggleInPageSearch',
        'export function setupPageSearchListeners',
        'export function isMatchCaseActive',
        'export function toggleMatchCase'
    ];

    for (const exp of expectedExports) {
        assert(pageSearchSource.includes(exp), `pageSearch.js must include: ${exp}`);
    }

    assert(pageSearchSource.includes('window.findInPageNext = findInPageNext'), 'Must expose findInPageNext on window');
    assert(pageSearchSource.includes('window.findInPagePrevious = findInPagePrevious'), 'Must expose findInPagePrevious on window');
    assert(pageSearchSource.includes('window.updateFindMatchCount = updateFindMatchCount'), 'Must expose updateFindMatchCount on window');

    // Extract isMatchCaseActive implementation for unit testing
    const isMatchCaseMatch = pageSearchSource.match(/export function isMatchCaseActive\([\s\S]*?^}/m);
    assert(isMatchCaseMatch, 'isMatchCaseActive must be extracted');
    const isMatchCaseActive = new Function(
        'matchCaseOverride',
        'query = ""',
        `let override = matchCaseOverride; ${isMatchCaseMatch[0].replace('export function isMatchCaseActive', 'function isMatchCaseActive').replace('matchCaseOverride !== null', 'override !== null').replace('return matchCaseOverride', 'return override')}; return isMatchCaseActive(query);`
    );

    // Vim SmartCase tests
    assert.strictEqual(isMatchCaseActive(null, 'mise'), false, 'All lowercase query must be case-insensitive (smartcase)');
    assert.strictEqual(isMatchCaseActive(null, 'mastodon'), false, 'All lowercase query must be case-insensitive');
    assert.strictEqual(isMatchCaseActive(null, 'Mise'), true, 'Query containing capital letter must be case-sensitive (smartcase)');
    assert.strictEqual(isMatchCaseActive(null, 'ELECTRON'), true, 'All uppercase query must be case-sensitive (smartcase)');
    assert.strictEqual(isMatchCaseActive(true, 'mise'), true, 'Forced matchCase override must take precedence');
    assert.strictEqual(isMatchCaseActive(false, 'Mise'), false, 'Forced case-insensitive override must take precedence');

    // Verify focus restoration to webview on Enter
    assert(pageSearchSource.includes('focusActiveWebview()'), 'Enter in FindInput must restore focus to active webview');

    // Functional mock test of updateFindMatchCount
    const mockElements = {
        FindMatchCount: { textContent: '', classList: new Set() },
        FindInput: { value: 'electron' }
    };
    mockElements.FindMatchCount.classList.add = (c) => mockElements.FindMatchCount.classList.add(c);
    mockElements.FindMatchCount.classList.remove = (c) => mockElements.FindMatchCount.classList.delete(c);

    console.log('✓ modules/renderer/pageSearch.js export contracts verified');
}

// 5. Verify webview-preload.js normal mode key mappings ('n' and 'N')
{
    const preloadPath = path.join(__dirname, '../webview-preload.js');
    const preloadSource = fs.readFileSync(preloadPath, 'utf8');

    assert(preloadSource.includes("case 'n':"), "webview-preload.js must handle 'n' in normal mode");
    assert(preloadSource.includes("'find-next'"), "webview-preload.js must dispatch 'find-next' on 'n'");
    assert(preloadSource.includes("case 'N':"), "webview-preload.js must handle 'N' in normal mode");
    assert(preloadSource.includes("'find-previous'"), "webview-preload.js must dispatch 'find-previous' on 'N'");
    assert(preloadSource.includes("case '/':"), "webview-preload.js must handle '/' in normal mode");
    assert(preloadSource.includes("'toggle-find'"), "webview-preload.js must dispatch 'toggle-find' on '/'");

    console.log('✓ webview-preload.js normal mode key mappings (n, N, /) verified');
}

// 6. Verify modules/webview.js action routing and tab isolation
{
    const webviewPath = path.join(__dirname, '../modules/webview.js');
    const webviewSource = fs.readFileSync(webviewPath, 'utf8');

    assert(webviewSource.includes("case 'find-next':"), "modules/webview.js must handle 'find-next' action");
    assert(webviewSource.includes("window.findInPageNext()"), "modules/webview.js must invoke window.findInPageNext()");
    assert(webviewSource.includes("case 'find-previous':"), "modules/webview.js must handle 'find-previous' action");
    assert(webviewSource.includes("window.findInPagePrevious()"), "modules/webview.js must invoke window.findInPagePrevious()");

    // Verify found-in-page isolation guard
    assert(
        webviewSource.includes('if (webview !== getActiveWebview()) return;'),
        'found-in-page listener must verify active webview to prevent background tab match count leak'
    );
    assert(
        webviewSource.includes('window.updateFindMatchCount('),
        'found-in-page listener must delegate to window.updateFindMatchCount'
    );

    console.log('✓ modules/webview.js action routing and active tab isolation verified');
}

// 7. Verify keybinds, Command Palette, and Preferences [Help & Shortcut Reference] integration
{
    const keybindsPath = path.join(__dirname, '../keybinds.js');
    const keybindsSource = fs.readFileSync(keybindsPath, 'utf8');

    assert(keybindsSource.includes("'toggle-find': 'Ctrl+Shift+F'"), 'Ctrl+Shift+F must remain bound to toggle-find');
    assert(keybindsSource.includes("'find-next': { label: 'Find Next Match'"), 'find-next metadata must be registered');
    assert(keybindsSource.includes("'find-previous': { label: 'Find Previous Match'"), 'find-previous metadata must be registered');

    const cpPath = path.join(__dirname, '../modules/overlays/commandPalette.js');
    const cpSource = fs.readFileSync(cpPath, 'utf8');

    assert(cpSource.includes("id: 'find-next'"), 'Command Palette must list find-next action');
    assert(cpSource.includes("id: 'find-previous'"), 'Command Palette must list find-previous action');

    const prefPath = path.join(__dirname, '../templates/preferences.html');
    const prefSource = fs.readFileSync(prefPath, 'utf8');

    assert(prefSource.includes('data-action="find-next"'), 'Preferences [Help & Shortcut Reference] must include find-next');
    assert(prefSource.includes('data-action="find-previous"'), 'Preferences [Help & Shortcut Reference] must include find-previous');
    assert(prefSource.includes('Find next / previous match'), 'Preferences [Help & Shortcut Reference] must include Vim n/N match navigation');

    // Verify Find Bar overlay circular tab trap and button focus restoration in pageSearch.js
    const pageSearchPath = path.join(__dirname, '../modules/renderer/pageSearch.js');
    const pageSearchSource = fs.readFileSync(pageSearchPath, 'utf8');
    assert(pageSearchSource.includes("overlay.addEventListener('keydown'"), 'FindBarOverlay must register keyboard trap');
    assert(pageSearchSource.includes('caseBtn.addEventListener(\'keydown\''), 'FindCaseBtn must register keydown handler');

    console.log('✓ keybinds.js, Command Palette, and Preferences [Help & Shortcut Reference] integration verified');
}

// 8. Verify strict line budgets across core files
{
    const rendererPath = path.join(__dirname, '../renderer.js');
    const rendererLines = fs.readFileSync(rendererPath, 'utf8').split('\n').length;
    assert(rendererLines <= 250, `renderer.js must remain under 250 lines (currently ${rendererLines})`);

    const mainPath = path.join(__dirname, '../main.js');
    const mainLines = fs.readFileSync(mainPath, 'utf8').split('\n').length;
    assert(mainLines <= 550, `main.js must remain under 550 lines (currently ${mainLines})`);

    const indexPath = path.join(__dirname, '../index.html');
    const indexLines = fs.readFileSync(indexPath, 'utf8').split('\n').length;
    assert(indexLines <= 260, `index.html must remain under 260 lines (currently ${indexLines})`);

    console.log(`✓ Strict line budgets verified (renderer.js: ${rendererLines}/250, main.js: ${mainLines}/550, index.html: ${indexLines}/260)`);
}

console.log('All Mise Find-in-Page match counter & Vim navigation tests passed successfully!');
