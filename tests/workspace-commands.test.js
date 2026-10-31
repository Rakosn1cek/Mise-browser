// tests/workspace-commands.test.js
// Regression tests for the keyboard driven workspace management commands

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const keybinds = require('../keybinds.js');

console.log('Running Mise workspace command regression tests...');

const WORKSPACE_ACTIONS = ['create-workspace', 'rename-workspace', 'delete-workspace'];

const dashboardSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/dashboard.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
const paletteSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/commandPalette.js'), 'utf8');

// 1. Every command is a known keybind action so users can bind a chord to it
{
    const metadata = keybinds.getActionMetadata();
    for (const action of WORKSPACE_ACTIONS) {
        assert(metadata[action], `ACTION_METADATA must register ${action}`);
        assert.strictEqual(
            metadata[action].category,
            'Navigation & Workspaces',
            `${action} must sit in the Navigation & Workspaces category`
        );
    }

    console.log('✓ Workspace commands are registered as keybind actions');
}

// 2. The commands ship unbound and must not steal chords from existing actions
{
    const defaults = keybinds.DEFAULT_KEYBINDS;
    for (const action of WORKSPACE_ACTIONS) {
        assert.strictEqual(defaults[action], undefined, `${action} must not claim a default chord`);
    }

    const seen = new Map();
    for (const [action, binding] of Object.entries(defaults)) {
        const list = Array.isArray(binding) ? binding : [binding];
        for (const item of list) {
            if (!item) continue;
            const normalized = keybinds.normalizeKeyCombination(item);
            assert(!seen.has(normalized), `Chord "${normalized}" is bound to both "${seen.get(normalized)}" and "${action}"`);
            seen.set(normalized, action);
        }
    }

    console.log(`✓ Workspace commands are unbound by default and ${seen.size} default chords stay collision free`);
}

// 3. Each command reaches the dashboard through the shared dispatch and palette
{
    for (const action of WORKSPACE_ACTIONS) {
        assert(
            rendererSource.includes(`case '${action}':`),
            `renderer.js must dispatch ${action} from the master shortcut handler`
        );
        assert(
            paletteSource.includes(`actionId: '${action}'`),
            `Command Palette must publish ${action} so live keybinds resolve its badge`
        );
    }

    for (const exposed of ['promptWorkspaceCreation', 'promptWorkspaceRename', 'confirmWorkspaceDeletion']) {
        assert(
            rendererSource.includes(`window.${exposed} = ${exposed};`),
            `renderer.js must expose ${exposed} on the window bridge`
        );
        assert(
            new RegExp(`export function ${exposed}\\(`).test(dashboardSource),
            `dashboard.js must export ${exposed}`
        );
    }

    console.log('✓ Workspace commands are wired through keybind dispatch and the Command Palette');
}

// 4. The commands reuse the existing dashboard helpers rather than duplicating them
{
    assert(
        dashboardSource.includes('deleteWorkspace(target);'),
        'confirmWorkspaceDeletion must delegate removal to deleteWorkspace'
    );
    assert(
        dashboardSource.includes('renameWorkspace(renameTarget, name);'),
        'The shared name prompt must delegate renames to renameWorkspace'
    );
    assert(
        dashboardSource.includes('if (!state.sessionState.workspaces[name]) {'),
        'The create path must keep its original reservation and collision checks'
    );

    console.log('✓ Workspace commands delegate to the existing dashboard guards');
}

// 4b. Committing a name must not also move the dashboard selection
{
    const handlerStart = rendererSource.indexOf(`'NewWorkspaceTitleInput').addEventListener('keydown'`);
    assert(handlerStart > -1, 'renderer.js must keep a keydown handler for the workspace name prompt');
    const handler = rendererSource.slice(handlerStart, handlerStart + 700);
    const stopIdx = handler.indexOf('e.stopPropagation()');
    const commitIdx = handler.indexOf('processWorkspaceCreation()');
    assert(
        stopIdx > -1 && commitIdx > -1 && stopIdx < commitIdx,
        'The prompt must stop the keystroke before the dashboard tree navigation sees it'
    );

    console.log('✓ Committing a workspace name cannot double fire the dashboard tree');
}

// 5. Behavioural verification against a minimal document stub
(async () => {
    function fakeElement(id) {
        const element = {
            id,
            style: {},
            dataset: {},
            className: '',
            title: '',
            textContent: '',
            innerHTML: '',
            value: '',
            children: [],
            classList: {
                add() {},
                remove() {},
                toggle() {},
                contains: () => false
            },
            appendChild(child) { this.children.push(child); return child; },
            replaceChild(next) { return next; },
            removeChild(child) { return child; },
            setAttribute() {},
            getAttribute: () => null,
            addEventListener() {},
            removeEventListener() {},
            focus() {},
            blur() {},
            select() {},
            scrollIntoView() {},
            click() {},
            querySelector: () => null,
            querySelectorAll: () => []
        };
        return element;
    }

    const registry = new Map();
    function byId(id) {
        if (!registry.has(id)) registry.set(id, fakeElement(id));
        return registry.get(id);
    }

    globalThis.document = {
        readyState: 'complete',
        body: fakeElement('body'),
        documentElement: fakeElement('html'),
        activeElement: null,
        getElementById: (id) => (id ? byId(id) : null),
        createElement: (tag) => fakeElement(tag),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {}
    };

    let confirmAnswer = true;
    let saveCount = 0;
    const miseAPI = {
        saveSession: () => { saveCount += 1; },
        getKeybinds: () => ({}),
        getSettings: () => ({}),
        getWorkspacePartition: (name) => `persist:${String(name).toLowerCase()}`
    };
    // Renderer modules call assorted bridge helpers while repainting; any of them
    // answering with an empty string is enough for a state level test.
    globalThis.window = {
        miseAPI: new Proxy(miseAPI, {
            get: (target, property) => (property in target ? target[property] : () => ''),
            has: () => true
        }),
        confirm: () => confirmAnswer,
        toggleCommandPaletteView() {},
        togglePreferencesView() {}
    };
    globalThis.miseAllowWebviewFocus = false;

    const dashboard = await import('../modules/overlays/dashboard.js');
    const { state } = await import('../modules/state.js');

    function seedSession(currentWorkspace, workspaces) {
        state.sessionState = {
            current_workspace: currentWorkspace,
            workspaces,
            active_tabs: {}
        };
        state.dashboardActive = false;
        state.dashboardItems = [];
        state.dashboardSelectionIdx = 0;
        state.activeViewsCache = {};
        state.activeTitlesCache = {};
        state.tabSleepStates = {};
        state.tabPinned = {};
    }

    // 5a. Creating a workspace through the command registers and activates it
    {
        seedSession('Work', { 'Work': ['https://archlinux.org'], 'Private': [] });
        dashboard.promptWorkspaceCreation();
        assert.strictEqual(byId('WorkspaceInputBox').style.display, 'flex', 'The create command must reveal the name prompt');
        assert.strictEqual(state.dashboardActive, true, 'The create command must open the dashboard behind the prompt');

        byId('NewWorkspaceTitleInput').value = 'Research';
        dashboard.processWorkspaceCreation();

        assert(state.sessionState.workspaces['Research'], 'Submitting the prompt must create the workspace');
        assert(saveCount > 0, 'A new workspace must be persisted to the session');
        assert.strictEqual(state.sessionState.current_workspace, 'Research', 'A new workspace must become the active one');
        console.log('✓ The create command registers a workspace and switches to it');
    }

    // 5b. Reserved names are refused by the prompt itself
    {
        seedSession('Work', { 'Work': ['https://archlinux.org'], 'Private': [] });
        dashboard.promptWorkspaceCreation();
        byId('NewWorkspaceTitleInput').value = 'Private';
        dashboard.processWorkspaceCreation();

        assert.strictEqual(state.sessionState.workspaces['Private'].length, 0, 'Creating a reserved name must not add tabs');
        assert.strictEqual(state.sessionState.current_workspace, 'Work', 'A reserved name must not switch workspaces');
        console.log('✓ The create prompt refuses the reserved Private namespace');
    }

    // 5c. Renaming migrates the workspace under a new name
    {
        seedSession('Work', { 'Work': ['https://archlinux.org'], 'Play': [] });
        dashboard.promptWorkspaceRename('Work');
        assert.strictEqual(byId('NewWorkspaceTitleInput').value, 'Work', 'The rename prompt must prefill the current name');

        byId('NewWorkspaceTitleInput').value = 'Primary';
        dashboard.processWorkspaceCreation();

        assert.strictEqual(state.sessionState.workspaces['Work'], undefined, 'The old name must be retired');
        assert.deepStrictEqual(state.sessionState.workspaces['Primary'], ['https://archlinux.org'], 'Tabs must migrate to the renamed workspace');
        assert.strictEqual(state.sessionState.current_workspace, 'Primary', 'The renamed workspace must stay active');
        console.log('✓ The rename command migrates tabs to the new workspace name');
    }

    // 5d. Renaming into the reserved namespace, or to a blank name, is refused
    {
        seedSession('Work', { 'Work': ['https://archlinux.org'], 'Play': [] });
        dashboard.promptWorkspaceRename('Work');
        byId('NewWorkspaceTitleInput').value = 'private';
        dashboard.processWorkspaceCreation();
        assert(state.sessionState.workspaces['Work'], 'A rename into the reserved namespace must be rejected');

        dashboard.promptWorkspaceRename('Work');
        byId('NewWorkspaceTitleInput').value = '   ';
        dashboard.processWorkspaceCreation();
        assert(!Object.keys(state.sessionState.workspaces).some((name) => !name.trim()), 'A blank rename must not create a nameless workspace');
        assert(state.sessionState.workspaces['Work'], 'A blank rename must leave the workspace name alone');
        console.log('✓ Blank and reserved rename targets are rejected without side effects');
    }

    // 5e. The Private workspace cannot be renamed
    {
        seedSession('Private', { 'Private': ['https://secret.example.com'], 'Work': [] });
        byId('WorkspaceInputBox').style.display = 'none';
        byId('NewWorkspaceTitleInput').value = '';
        dashboard.promptWorkspaceRename();
        assert.notStrictEqual(byId('WorkspaceInputBox').style.display, 'flex', 'Renaming Private must not open the prompt');
        assert.strictEqual(byId('NewWorkspaceTitleInput').value, '', 'The reserved workspace name must never reach the prompt');
        assert(state.sessionState.workspaces['Private'], 'The Private workspace must survive a rename command');
        console.log('✓ The Private workspace is protected from renaming');
    }

    // 5f. Deletion guards: reserved namespace, last workspace, declined prompt
    {
        seedSession('Private', { 'Private': ['https://secret.example.com'], 'Work': [] });
        assert.strictEqual(dashboard.confirmWorkspaceDeletion(), false, 'Private must be protected from deletion');
        assert(state.sessionState.workspaces['Private'], 'The Private workspace must survive a deletion command');

        seedSession('Work', { 'Work': ['https://archlinux.org'] });
        assert.strictEqual(dashboard.confirmWorkspaceDeletion(), false, 'The last workspace must not be deletable');
        assert(state.sessionState.workspaces['Work'], 'The sole workspace must remain in the session');

        seedSession('Work', { 'Work': ['https://archlinux.org'], 'Play': ['https://duckduckgo.com'] });
        confirmAnswer = false;
        assert.strictEqual(dashboard.confirmWorkspaceDeletion(), false, 'Declining the prompt must abort the deletion');
        assert(state.sessionState.workspaces['Work'], 'An aborted deletion must leave the workspace intact');
        assert.strictEqual(state.sessionState.current_workspace, 'Work', 'An aborted deletion must not switch workspaces');
        confirmAnswer = true;
        console.log('✓ Deletion refuses Private, the last workspace, and a declined prompt');
    }

    // 5g. An accepted deletion removes the workspace and falls back
    {
        seedSession('Work', { 'Work': [], 'Play': ['https://duckduckgo.com'] });
        assert.strictEqual(dashboard.confirmWorkspaceDeletion(), true, 'Deleting an empty workspace must succeed');
        assert.strictEqual(state.sessionState.workspaces['Work'], undefined, 'The deleted workspace must leave the session');
        assert.strictEqual(state.sessionState.current_workspace, 'Play', 'The active workspace must fall back to a survivor');
        console.log('✓ An accepted deletion removes the workspace and falls back to another');
    }

    console.log('All workspace command regression tests passed successfully!');
})();
