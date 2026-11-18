// tests/zoom-controls.test.js
// Automated verification for webview zoom controls, factor mathematics, keybinds, and line budgets

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise webview zoom controls regression tests...');

// 1. Verify keybinds.js default keybindings and metadata
{
    const keybinds = require('../keybinds.js');
    const defaults = keybinds.DEFAULT_KEYBINDS;
    const metadata = keybinds.ACTION_METADATA;

    assert.ok(defaults['zoom-in'], 'zoom-in must be defined in DEFAULT_KEYBINDS');
    assert.ok(defaults['zoom-out'], 'zoom-out must be defined in DEFAULT_KEYBINDS');
    assert.ok(defaults['zoom-reset'], 'zoom-reset must be defined in DEFAULT_KEYBINDS');

    const zoomInList = Array.isArray(defaults['zoom-in']) ? defaults['zoom-in'] : [defaults['zoom-in']];
    assert.ok(zoomInList.includes('Ctrl+='), 'zoom-in must include Ctrl+=');

    const zoomOutList = Array.isArray(defaults['zoom-out']) ? defaults['zoom-out'] : [defaults['zoom-out']];
    assert.ok(zoomOutList.includes('Ctrl+-'), 'zoom-out must include Ctrl+-');

    assert.equal(defaults['zoom-reset'], 'Ctrl+0', 'zoom-reset default must be Ctrl+0');

    // Strict Alt modifier guard
    for (const [action, binding] of Object.entries(defaults)) {
        const list = Array.isArray(binding) ? binding : [binding];
        for (const item of list) {
            assert.ok(!item.includes('Alt+'), `Default keybind for ${action} must not use Alt modifier: ${item}`);
        }
    }

    // Action metadata verification
    assert.ok(metadata['zoom-in'], 'zoom-in must have action metadata');
    assert.equal(metadata['zoom-in'].category, 'Web Interaction');
    assert.ok(metadata['zoom-out'], 'zoom-out must have action metadata');
    assert.equal(metadata['zoom-out'].category, 'Web Interaction');
    assert.ok(metadata['zoom-reset'], 'zoom-reset must have action metadata');
    assert.equal(metadata['zoom-reset'].category, 'Web Interaction');

    // Input matching verification across key variations
    const equalInput = { type: 'keyDown', control: true, key: '=', code: 'Equal' };
    assert.equal(keybinds.getActionForInput(equalInput), 'zoom-in', 'Ctrl+= must map to zoom-in');

    const plusInput = { type: 'keyDown', control: true, shift: true, key: '+', code: 'Equal' };
    assert.equal(keybinds.getActionForInput(plusInput), 'zoom-in', 'Ctrl+Shift++ must map to zoom-in');

    const numpadAddInput = { type: 'keyDown', control: true, key: '+', code: 'NumpadAdd' };
    assert.equal(keybinds.getActionForInput(numpadAddInput), 'zoom-in', 'Ctrl+NumpadAdd must map to zoom-in');

    const minusInput = { type: 'keyDown', control: true, key: '-', code: 'Minus' };
    assert.equal(keybinds.getActionForInput(minusInput), 'zoom-out', 'Ctrl+- must map to zoom-out');

    const numpadSubInput = { type: 'keyDown', control: true, key: '-', code: 'NumpadSubtract' };
    assert.equal(keybinds.getActionForInput(numpadSubInput), 'zoom-out', 'Ctrl+NumpadSubtract must map to zoom-out');

    const zeroInput = { type: 'keyDown', control: true, key: '0', code: 'Digit0' };
    assert.equal(keybinds.getActionForInput(zeroInput), 'zoom-reset', 'Ctrl+0 must map to zoom-reset');

    console.log('✓ keybinds.js defaults, Alt modifier guards, and input mapping verified');
}

// 2. Functional test of zoom factor progression and boundaries
{
    const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0];

    function calculateNextZoom(current) {
        return ZOOM_STEPS.find(step => step > current + 0.01) || 5.0;
    }

    function calculatePrevZoom(current) {
        let prev = 0.25;
        for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
            if (ZOOM_STEPS[i] < current - 0.01) {
                prev = ZOOM_STEPS[i];
                break;
            }
        }
        return prev;
    }

    // Step up from 100%
    assert.equal(calculateNextZoom(1.0), 1.1);
    assert.equal(calculateNextZoom(1.1), 1.25);
    assert.equal(calculateNextZoom(4.0), 5.0);
    assert.equal(calculateNextZoom(5.0), 5.0, 'Zoom-in at maximum 5.0 must clamp to 5.0');

    // Step down from 100%
    assert.equal(calculatePrevZoom(1.0), 0.9);
    assert.equal(calculatePrevZoom(0.9), 0.8);
    assert.equal(calculatePrevZoom(0.33), 0.25);
    assert.equal(calculatePrevZoom(0.25), 0.25, 'Zoom-out at minimum 0.25 must clamp to 0.25');

    console.log('✓ Zoom factor progression and boundary clamping verified');
}

// 3. Static verification of modules and Command Palette integration
{
    const commandPaletteSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/commandPalette.js'), 'utf8');
    assert.ok(commandPaletteSource.includes("id: 'zoom-in'"), 'Command Palette must register zoom-in command');
    assert.ok(commandPaletteSource.includes("id: 'zoom-out'"), 'Command Palette must register zoom-out command');
    assert.ok(commandPaletteSource.includes("id: 'zoom-reset'"), 'Command Palette must register zoom-reset command');

    const webviewSource = fs.readFileSync(path.join(__dirname, '../modules/webview.js'), 'utf8');
    assert.ok(webviewSource.includes('zoomInActiveTab'), 'modules/webview.js must import and re-export zoomInActiveTab');
    assert.ok(webviewSource.includes('zoomOutActiveTab'), 'modules/webview.js must import and re-export zoomOutActiveTab');
    assert.ok(webviewSource.includes('zoomResetActiveTab'), 'modules/webview.js must import and re-export zoomResetActiveTab');
    assert.ok(webviewSource.includes('guest-zoom-action'), 'modules/webview.js must handle guest-zoom-action IPC');

    const rendererSource = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
    assert.ok(rendererSource.includes("case 'zoom-in':"), 'renderer.js must route zoom-in master shortcut');
    assert.ok(rendererSource.includes("case 'zoom-out':"), 'renderer.js must route zoom-out master shortcut');
    assert.ok(rendererSource.includes("case 'zoom-reset':"), 'renderer.js must route zoom-reset master shortcut');

    console.log('✓ Command Palette, webview.js, and renderer.js integration verified');
}

// 4. Strict line budgets verification
{
    const rendererLines = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8').trim().split('\n').length;
    assert.ok(rendererLines <= 250, `renderer.js line count (${rendererLines}) must not exceed 250 lines`);

    const mainLines = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8').trim().split('\n').length;
    assert.ok(mainLines <= 550, `main.js line count (${mainLines}) must not exceed 550 lines`);

    const indexLines = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').trim().split('\n').length;
    assert.ok(indexLines <= 260, `index.html line count (${indexLines}) must not exceed 260 lines`);

    console.log(`✓ Strict line budgets verified (renderer.js: ${rendererLines}/250, main.js: ${mainLines}/550, index.html: ${indexLines}/260)`);
}

console.log('All webview zoom controls regression tests passed successfully!');
