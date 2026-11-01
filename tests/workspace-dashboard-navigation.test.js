// tests/workspace-dashboard-navigation.test.js
// Regression tests for Workspace Dashboard keyboard navigation, focus handling, and Command Palette actions

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Workspace Dashboard navigation & Command Palette regression tests...');

// 1. Verify keybinds.js ACTION_METADATA for Workspace & Dashboard group
const keybindsSource = fs.readFileSync(path.join(__dirname, '../keybinds.js'), 'utf8');

assert.ok(
    keybindsSource.includes("'toggle-dashboard': { label: 'Toggle Workspace Dashboard', category: 'Workspaces & Dashboard' }"),
    'toggle-dashboard must belong to Workspaces & Dashboard category in keybinds.js'
);

assert.ok(
    keybindsSource.includes("'create-workspace': { label: 'Create New Workspace', category: 'Workspaces & Dashboard' }"),
    'create-workspace must belong to Workspaces & Dashboard category in keybinds.js'
);

assert.ok(
    keybindsSource.includes("'rename-workspace': { label: 'Rename Current Workspace', category: 'Workspaces & Dashboard' }"),
    'rename-workspace must belong to Workspaces & Dashboard category in keybinds.js'
);

assert.ok(
    keybindsSource.includes("'delete-workspace': { label: 'Delete Current Workspace', category: 'Workspaces & Dashboard' }"),
    'delete-workspace must belong to Workspaces & Dashboard category in keybinds.js'
);

console.log('✓ keybinds.js metadata contains all 4 actions in Workspaces & Dashboard group');

// 2. Verify Command Palette definitions in commandPalette.js
const cpSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/commandPalette.js'), 'utf8');

assert.ok(
    cpSource.includes("id: 'create-workspace'") && cpSource.includes("category: 'Workspaces & Dashboard'"),
    'commandPalette.js must define create-workspace under Workspaces & Dashboard'
);

assert.ok(
    cpSource.includes("id: 'rename-workspace'"),
    'commandPalette.js must define rename-workspace'
);

assert.ok(
    cpSource.includes("id: 'delete-workspace'"),
    'commandPalette.js must define delete-workspace'
);

// 3. Verify index.html category chip
const htmlSource = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
assert.ok(
    htmlSource.includes('data-category="Workspaces & Dashboard"'),
    'index.html must include category chip for Workspaces & Dashboard'
);

console.log('✓ Command Palette definitions and filter chip verified');

// 4. Verify dashboard.js and workspaceController.js focus contracts
const dashSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/dashboard.js'), 'utf8');
const wcSource = fs.readFileSync(path.join(__dirname, '../modules/renderer/workspaceController.js'), 'utf8');

assert.ok(
    dashSource.includes('promptWorkspaceCreation') && dashSource.includes('promptWorkspaceRename') && dashSource.includes('confirmWorkspaceDeletion'),
    'dashboard.js must export promptWorkspaceCreation, promptWorkspaceRename, and confirmWorkspaceDeletion'
);

assert.ok(
    wcSource.includes("document.activeElement.tagName === 'BUTTON'"),
    'workspaceController.js must click focused button on Enter key'
);

assert.ok(
    wcSource.includes('e.stopPropagation()'),
    'workspaceController.js must stop Enter/Escape propagation on NewWorkspaceTitleInput'
);

console.log('✓ Dashboard focus contracts, button Enter delegation, and prompt propagation verified');

// 5. Verify CSS rules prevent chip layout shifts and list scrollbar jitter
const cpCss = fs.readFileSync(path.join(__dirname, '../styles/overlays/commandPalette.css'), 'utf8');
assert.ok(
    cpCss.includes('scrollbar-gutter: stable;'),
    'commandPalette.css must enforce scrollbar-gutter: stable on PaletteList'
);

assert.ok(
    cpCss.includes('.palette-filter-chip.active {\n    background-color: var(--accent);\n    color: var(--bg-main);\n    border-color: var(--accent);\n    font-weight: 500;\n}'),
    'palette-filter-chip.active must maintain font-weight: 500 to prevent text expansion layout jitter'
);

console.log('✓ CSS layout stability and chip anti-jitter rules verified');

// 6. Verify focus protection and active tab restoration contracts
assert.ok(
    cpSource.includes('state.dashboardActive') && cpSource.includes('returnFocusToWebview'),
    'returnFocusToWebview must avoid stealing focus when dashboard overlay is active'
);

assert.ok(
    dashSource.includes('state.sessionState.active_tabs?.[currentWS]'),
    'toggleDashboardView must restore active tab from sessionState.active_tabs'
);

console.log('✓ Command Palette focus protection and active tab restoration contracts verified');

// 7. Verify renderer.js line budget (<250 lines)
const rendererSource = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
const rendererLines = rendererSource.split('\n').length;
assert.ok(
    rendererLines <= 250,
    `renderer.js must remain under 250 lines (currently ${rendererLines})`
);

console.log(`✓ renderer.js line budget strictly preserved (${rendererLines} lines)`);
console.log('All Workspace Dashboard navigation & Command Palette tests passed successfully!');
