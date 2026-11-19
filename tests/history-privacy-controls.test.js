// tests/history-privacy-controls.test.js
// Regression tests for Milestone 5 History privacy toggle, single-item deletion, sanitisation, and ephemeral exclusion

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');

console.log('Running Mise History privacy controls & hardening regression tests...');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-history-privacy-test-'));
const origHome = process.env.HOME;
process.env.HOME = tmpHome;

const mockPartitions = new Map();
const origRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'electron') {
        return {
            app: {
                getPath: (name) => name === 'home' ? tmpHome : path.join(tmpHome, name)
            },
            ipcMain: {
                handle: () => {},
                on: () => {}
            },
            dialog: {
                showMessageBox: async () => ({ response: 0 })
            },
            shell: {
                openPath: async () => ''
            },
            session: {
                fromPartition: (name) => {
                    if (!mockPartitions.has(name)) {
                        mockPartitions.set(name, { partition: name });
                    }
                    return mockPartitions.get(name);
                }
            }
        };
    }
    return origRequire.apply(this, arguments);
};

const config = require('../main/config');
const storage = require('../main/storage');
const webContentsPolicy = require('../main/webContentsPolicy');

(async () => {
    try {
        // 1. Config schema, validation, and IPC hook for keep_history
        {
            assert.strictEqual(config.DEFAULT_CONFIG.keep_history, true, 'keep_history must default to true');

            const tmpCfgDir = path.join(tmpHome, 'cfg-check');
            const tmpCfgPath = path.join(tmpCfgDir, 'config.json');
            const initialCfg = config.loadBrowserConfig(tmpCfgDir, tmpCfgPath);
            assert.strictEqual(initialCfg.keep_history, true, 'Loaded default config must have keep_history: true');

            config.writeConfigFile({ keep_history: false }, tmpCfgPath);
            const disabledCfg = config.loadBrowserConfig(tmpCfgDir, tmpCfgPath);
            assert.strictEqual(disabledCfg.keep_history, false, 'keep_history: false must persist across loads');

            config.writeConfigFile({ keep_history: 'not-a-boolean' }, tmpCfgPath);
            const fallbackCfg = config.loadBrowserConfig(tmpCfgDir, tmpCfgPath);
            assert.strictEqual(fallbackCfg.keep_history, true, 'Invalid keep_history type must fall back to true');

            const validFalse = config.validateConfigPatch({ keep_history: false });
            assert.deepStrictEqual(validFalse.clean, { keep_history: false });
            assert.strictEqual(validFalse.rejected.length, 0);

            const invalidVal = config.validateConfigPatch({ keep_history: 'false' });
            assert.deepStrictEqual(invalidVal.clean, {});
            assert.deepStrictEqual(invalidVal.rejected, ['keep_history']);

            const handlers = {};
            const hookCalls = [];
            config.registerConfigIpc(
                { handle: (ch, fn) => { handlers[ch] = fn; } },
                { onKeepHistoryChange: (val) => hookCalls.push(val) }
            );
            config.loadBrowserConfig();
            await handlers['update-browser-settings'](null, { keep_history: false });
            await handlers['update-browser-settings'](null, { keep_history: false });
            await handlers['update-browser-settings'](null, { keep_history: true });
            assert.deepStrictEqual(hookCalls, [false, true], 'onKeepHistoryChange must fire only on actual state changes');

            console.log('✓ Config schema, validation, and onKeepHistoryChange hook verified');
        }

        // 2. Storage hardening: keep_history gating, credential rejection, title sanitisation, title updates, single-item delete
        {
            const testHistoryPath = path.join(tmpHome, 'history-hardening.json');
            storage.setInMemoryHistory([]);
            storage.setKeepHistoryEnabled(true);

            // Reject embedded HTTP Basic Auth credentials
            assert.strictEqual(storage.isRecordableHistoryUrl('https://user:secret@example.com/path'), false, 'User+pass URL must be rejected');
            assert.strictEqual(storage.isRecordableHistoryUrl('https://token@example.com/path'), false, 'Username-only URL must be rejected');
            assert.strictEqual(storage.isRecordableHistoryUrl('https://example.com/path?q=1'), true, 'Standard HTTPS URL must be accepted');

            storage.logVisit('Credential Leak', 'https://admin:hunter2@example.com/login', 500, testHistoryPath);
            assert.strictEqual(storage.getHistoryCache(testHistoryPath).length, 0, 'Credentialed URL must never be logged');

            // Sanitise control characters, BiDi overrides, whitespace, and oversized titles
            const dirtyTitle = `Evil\u202E\u200E\u0007\n\tTitle ${'A'.repeat(600)}`;
            const cleanTitle = storage.sanitiseHistoryTitle(dirtyTitle, 'https://fallback.example');
            assert.strictEqual(cleanTitle.includes('\u202E'), false, 'BiDi override characters must be stripped');
            assert.strictEqual(cleanTitle.includes('\u200E'), false, 'BiDi directional mark must be stripped');
            assert.strictEqual(cleanTitle.includes('\u0007'), false, 'Control characters must be stripped');
            assert.strictEqual(cleanTitle.includes('\n'), false, 'Newlines must be collapsed');
            assert.strictEqual(cleanTitle.length, storage.MAX_HISTORY_TITLE_LENGTH, 'Title length must be capped at 512 chars');

            // Log initial visit with empty title, then refine via updateVisitTitle
            storage.logVisit('', 'https://docs.example.org/guide', 500, testHistoryPath);
            const cacheAfterLog = storage.getHistoryCache(testHistoryPath);
            assert.strictEqual(cacheAfterLog.length, 1);
            assert.strictEqual(cacheAfterLog[0].title, 'https://docs.example.org/guide', 'Fallback title uses URL initially');

            const updated = storage.updateVisitTitle('Guide \u202EDocs\nPage', 'https://docs.example.org/guide', testHistoryPath);
            assert.strictEqual(updated, true, 'updateVisitTitle must update matching entry');
            assert.strictEqual(storage.getHistoryCache(testHistoryPath)[0].title, 'Guide Docs Page', 'Updated title must be sanitised');

            // Disable keep_history: stops future visits whilst retaining existing entries
            storage.setKeepHistoryEnabled(false);
            storage.logVisit('Blocked Page', 'https://should-not-record.example', 500, testHistoryPath);
            const titleUpdatedWhileDisabled = storage.updateVisitTitle('Changed', 'https://docs.example.org/guide', testHistoryPath);
            assert.strictEqual(titleUpdatedWhileDisabled, false, 'updateVisitTitle must not mutate when keep_history is false');
            assert.strictEqual(storage.getHistoryCache(testHistoryPath).length, 1, 'Existing history stays readable when keep_history is false');
            assert.strictEqual(storage.searchHistory('Guide', testHistoryPath).length, 1, 'Search still returns existing history when keep_history is false');

            // Re-enable and test single-item deletion targeting exact timestamp
            storage.setKeepHistoryEnabled(true);
            storage.flushHistoryToDisk(testHistoryPath);

            storage.setInMemoryHistory([
                { title: 'Newest Duplicate', url: 'https://repeat.example', timestamp: 3000 },
                { title: 'Middle Entry', url: 'https://middle.example', timestamp: 2000 },
                { title: 'Older Duplicate', url: 'https://repeat.example', timestamp: 1000 }
            ]);
            storage.flushHistoryToDisk(testHistoryPath);

            const deleted = storage.deleteHistoryItem({ url: 'https://repeat.example', timestamp: 1000 }, testHistoryPath);
            assert.strictEqual(deleted, true, 'deleteHistoryItem must remove matching entry');
            const afterDelete = storage.getHistoryCache(testHistoryPath);
            assert.strictEqual(afterDelete.length, 2, 'Only one entry should be removed');
            assert.strictEqual(afterDelete[0].timestamp, 3000, 'Newer duplicate must remain intact');
            assert.strictEqual(afterDelete[1].url, 'https://middle.example', 'Unrelated entry must remain intact');

            const diskAfterDelete = JSON.parse(fs.readFileSync(testHistoryPath, 'utf8'));
            assert.strictEqual(diskAfterDelete.length, 2, 'Deletion must flush atomically to disk');

            assert.strictEqual(storage.deleteHistoryItem({ url: 'https://missing.example' }, testHistoryPath), false, 'Missing entry returns false');
            assert.strictEqual(storage.deleteHistoryItem(null, testHistoryPath), false, 'Invalid payload returns false');

            console.log('✓ History gating, credential rejection, title sanitisation, and single-item deletion verified');
        }

        // 3. webContentsPolicy: stale title prevention, page-title-updated, subframe guard, Private & Ephemeral exclusion
        {
            const testHistoryPath = path.join(tmpHome, 'policy-history.json');
            storage.setInMemoryHistory([]);
            storage.setKeepHistoryEnabled(true);

            const appListeners = {};
            const mockApp = {
                on: (evt, fn) => {
                    if (!appListeners[evt]) appListeners[evt] = [];
                    appListeners[evt].push(fn);
                }
            };

            webContentsPolicy.setupWebContentsPolicy(mockApp, {
                getMainWindow: () => null,
                configureAndHardenSession: () => {},
                handleAppAction: () => {}
            });

            function createMockWebContents(sessionObj) {
                const listeners = {};
                let currentUrl = '';
                let currentTitle = '';
                return {
                    session: sessionObj,
                    getType: () => 'webview',
                    setMaxListeners: () => {},
                    setWindowOpenHandler: () => {},
                    getURL: () => currentUrl,
                    getTitle: () => currentTitle,
                    setState: (u, t) => { currentUrl = u; currentTitle = t; },
                    on: (evt, fn) => {
                        if (!listeners[evt]) listeners[evt] = [];
                        listeners[evt].push(fn);
                    },
                    emit: (evt, ...args) => {
                        for (const fn of (listeners[evt] || [])) fn(...args);
                    }
                };
            }

            const { session } = require('electron');
            const standardSession = session ? session.fromPartition('persist:work') : { id: 'standard' };
            const privateSession = session ? session.fromPartition('MisePrivateProfile') : { id: 'private' };

            // 3a. Normal webview: stale title cleared when URL changes, then updated on page-title-updated
            const standardWc = createMockWebContents(standardSession);
            for (const fn of appListeners['web-contents-created']) fn({}, standardWc);

            standardWc.setState('https://first.example', 'First Page Title');
            standardWc.emit('did-navigate', {}, 'https://first.example');
            standardWc.emit('page-title-updated', {}, 'First Page Title');
            assert.strictEqual(storage.getHistoryCache()[0].title, 'First Page Title');

            // Simulate did-navigate where getTitle() still returns previous page title
            standardWc.setState('https://second.example', 'First Page Title');
            standardWc.emit('did-navigate', {}, 'https://second.example');
            assert.strictEqual(storage.getHistoryCache()[0].url, 'https://second.example');
            assert.strictEqual(storage.getHistoryCache()[0].title, 'https://second.example', 'Stale title from previous page must not stick');

            standardWc.setState('https://second.example', 'Second Page Loaded');
            standardWc.emit('page-title-updated', {}, 'Second Page Loaded');
            assert.strictEqual(storage.getHistoryCache()[0].title, 'Second Page Loaded', 'page-title-updated must refine committed entry title');

            // Subframe in-page navigation must be ignored
            standardWc.emit('did-navigate-in-page', {}, 'https://tracker-iframe.example', false);
            assert.strictEqual(storage.getHistoryCache().length, 2, 'Subframe navigation must not log to history');

            // 3b. Ephemeral webview (Peek / Share modal) must never log to history
            const countBeforeEphemeral = storage.getHistoryCache().length;
            webContentsPolicy.markNextWebviewEphemeral();
            const ephemeralWc = createMockWebContents(standardSession);
            for (const fn of appListeners['web-contents-created']) fn({}, ephemeralWc);
            assert.strictEqual(webContentsPolicy.isEphemeralWebContents(ephemeralWc), true, 'Next webview must be tagged ephemeral');

            ephemeralWc.setState('https://peek-secret.example', 'Peek Secret');
            ephemeralWc.emit('did-navigate', {}, 'https://peek-secret.example');
            ephemeralWc.emit('did-navigate-in-page', {}, 'https://peek-secret.example#hash', true);
            ephemeralWc.emit('page-title-updated', {}, 'Peek Secret Updated');
            assert.strictEqual(storage.getHistoryCache().length, countBeforeEphemeral, 'Ephemeral webviews must never log history');

            // 3c. Private partition webview must never log to history
            const privateWc = createMockWebContents(privateSession);
            for (const fn of appListeners['web-contents-created']) fn({}, privateWc);
            assert.strictEqual(webContentsPolicy.isEphemeralWebContents(privateWc), false, 'Ephemeral mark must apply only to one webview');

            privateWc.setState('https://private-only.example', 'Private Tab');
            privateWc.emit('did-navigate', {}, 'https://private-only.example');
            privateWc.emit('page-title-updated', {}, 'Private Tab');
            assert.strictEqual(storage.getHistoryCache().length, countBeforeEphemeral, 'Private partition must never log history');

            storage.setInMemoryHistory([]);
            console.log('✓ Stale title guard, title updates, subframe guard, and ephemeral/private exclusion verified');
        }

        // 4. History overlay UI: disabled banner, empty disabled state, x and Delete key handling, delete button
        {
            class MockElement {
                constructor(id = '', tagName = 'div') {
                    this.id = id;
                    this.tagName = tagName;
                    this.style = {};
                    this.classList = {
                        classes: new Set(),
                        add: (c) => this.classList.classes.add(c),
                        remove: (c) => this.classList.classes.delete(c),
                        contains: (c) => this.classList.classes.has(c)
                    };
                    this.children = [];
                    this.innerHTML = '';
                    this.textContent = '';
                    this.value = '';
                    this.selectionStart = 0;
                    this.selectionEnd = 0;
                    this._listeners = {};
                }
                addEventListener(event, fn) {
                    if (!this._listeners[event]) this._listeners[event] = [];
                    this._listeners[event].push(fn);
                }
                removeEventListener(event, fn) {
                    if (!this._listeners[event]) return;
                    this._listeners[event] = this._listeners[event].filter(cb => cb !== fn);
                }
                focus() { global.document.activeElement = this; }
                scrollIntoView() {}
                setAttribute(k, v) { this[k] = v; }
                getAttribute(k) { return this[k] || null; }
                appendChild(child) { this.children.push(child); }
                querySelectorAll(sel) {
                    if (sel === '.history-item') {
                        return this.children.filter(c => c.className && c.className.includes('history-item'));
                    }
                    return this.children;
                }
                querySelector(sel) {
                    if (sel === '.history-item-delete-btn') {
                        if (!this._deleteBtn) this._deleteBtn = new MockElement('', 'button');
                        return this._deleteBtn;
                    }
                    return null;
                }
            }

            const historyOverlay = new MockElement('HistoryOverlay');
            const historySearchInput = new MockElement('HistorySearchInput', 'input');
            const purgeHistoryBtn = new MockElement('PurgeHistoryBtn', 'button');
            const closeHistoryBtn = new MockElement('CloseHistoryBtn', 'button');
            const historyResultsList = new MockElement('HistoryResultsList');

            const elements = {
                'HistoryOverlay': historyOverlay,
                'HistorySearchInput': historySearchInput,
                'PurgeHistoryBtn': purgeHistoryBtn,
                'CloseHistoryBtn': closeHistoryBtn,
                'HistoryResultsList': historyResultsList,
                'WorkspaceLabel': new MockElement('WorkspaceLabel'),
                'WorkspaceBadge': new MockElement('WorkspaceBadge'),
                'WorkspaceHeader': new MockElement('WorkspaceHeader'),
                'TabList': new MockElement('TabList'),
                'webview-container': new MockElement('webview-container')
            };

            global.document = {
                readyState: 'complete',
                getElementById: (id) => elements[id] || null,
                querySelector: () => null,
                querySelectorAll: () => [],
                createElement: (tag) => new MockElement('', tag),
                addEventListener: () => {},
                removeEventListener: () => {},
                activeElement: historySearchInput
            };

            let mockKeepHistory = false;
            let mockHistoryData = [];
            const deletedPayloads = [];

            global.window = {
                addEventListener: () => {},
                removeEventListener: () => {},
                miseAPI: {
                    searchHistory: async () => [...mockHistoryData],
                    getBrowserSettings: async () => ({ keep_history: mockKeepHistory }),
                    deleteHistoryItem: async (target) => {
                        deletedPayloads.push(target);
                        mockHistoryData = mockHistoryData.filter(item => !(item.url === target.url && item.timestamp === target.timestamp));
                        return true;
                    },
                    saveSession: () => {},
                    getWebviewPreloadPath: () => '/fake/preload.js'
                }
            };

            const historyModule = await import('../modules/overlays/history.js');
            const { state } = await import('../modules/state.js');

            // 4a. Disabled state with empty history displays notice
            mockKeepHistory = false;
            mockHistoryData = [];
            await historyModule.filterHistoryItems('');
            assert(
                historyResultsList.innerHTML.includes('History recording is disabled in Preferences.'),
                'Empty history with keep_history false must show disabled message'
            );

            // 4b. Disabled state with existing history displays banner AND items
            mockHistoryData = [
                { title: 'Alpha Site', url: 'https://alpha.example', timestamp: 111 },
                { title: 'Beta Site', url: 'https://beta.example', timestamp: 222 },
                { title: 'Gamma Site', url: 'https://gamma.example', timestamp: 333 }
            ];
            await historyModule.filterHistoryItems('');
            assert.strictEqual(historyResultsList.children[0].className, 'history-disabled-banner', 'Banner must be prepended when keep_history is false and items exist');
            assert.strictEqual(historyResultsList.children[0].textContent, 'History recording is disabled in Preferences.');
            assert.strictEqual(historyResultsList.querySelectorAll('.history-item').length, 3, 'Existing history items must remain visible');

            // 4c. Typing 'x' into non-empty search input without navigating list must NOT delete
            state.historyActive = true;
            historySearchInput.value = 'alp';
            historySearchInput.selectionStart = 3;
            historySearchInput.selectionEnd = 3;
            global.document.activeElement = historySearchInput;

            let preventedOnTypingX = false;
            historyModule.handleHistoryKeyDown({
                key: 'x',
                ctrlKey: false,
                metaKey: false,
                altKey: false,
                preventDefault: () => { preventedOnTypingX = true; },
                stopPropagation: () => {}
            });
            assert.strictEqual(preventedOnTypingX, false, 'Typing x into active search query must not trigger deletion');
            assert.strictEqual(state.historyResults.length, 3, 'No item should be deleted when typing x in query');

            // 4d. Navigating with ArrowDown then pressing 'x' deletes highlighted item
            historyModule.handleHistoryKeyDown({ key: 'ArrowDown', preventDefault: () => {}, stopPropagation: () => {} });
            assert.strictEqual(state.historySelectionIdx, 1);

            let preventedOnNavX = false;
            historyModule.handleHistoryKeyDown({
                key: 'x',
                ctrlKey: false,
                metaKey: false,
                altKey: false,
                preventDefault: () => { preventedOnNavX = true; },
                stopPropagation: () => {}
            });
            assert.strictEqual(preventedOnNavX, true, 'Pressing x after list navigation must delete selected item');
            await new Promise(resolve => setTimeout(resolve, 10));
            assert.strictEqual(deletedPayloads.length, 1);
            assert.deepStrictEqual(deletedPayloads[0], { url: 'https://beta.example', timestamp: 222 });
            assert.strictEqual(state.historyResults.length, 2);

            // 4e. Pressing Delete when search input is empty deletes selected item (now index 1 -> Gamma)
            historySearchInput.value = '';
            historySearchInput.selectionStart = 0;
            historySearchInput.selectionEnd = 0;
            let preventedOnDelete = false;
            historyModule.handleHistoryKeyDown({
                key: 'Delete',
                preventDefault: () => { preventedOnDelete = true; },
                stopPropagation: () => {}
            });
            assert.strictEqual(preventedOnDelete, true, 'Delete key must delete highlighted entry when not editing input text');
            await new Promise(resolve => setTimeout(resolve, 10));
            assert.strictEqual(deletedPayloads.length, 2);
            assert.deepStrictEqual(deletedPayloads[1], { url: 'https://gamma.example', timestamp: 333 });
            assert.strictEqual(state.historyResults.length, 1);

            // 4f. Pressing Delete mid-input does not delete history entry
            historySearchInput.value = 'abc';
            historySearchInput.selectionStart = 1;
            historySearchInput.selectionEnd = 1;
            let preventedMidEditDelete = false;
            historyModule.handleHistoryKeyDown({
                key: 'Delete',
                preventDefault: () => { preventedMidEditDelete = true; },
                stopPropagation: () => {}
            });
            assert.strictEqual(preventedMidEditDelete, false, 'Delete inside search text must edit text rather than delete history');
            assert.strictEqual(state.historyResults.length, 1);

            // 4g. Delete button click invokes deleteHistoryEntry
            const remainingItems = historyResultsList.querySelectorAll('.history-item');
            const deleteBtn = remainingItems[0].querySelector('.history-item-delete-btn');
            const clickHandlers = deleteBtn._listeners['click'] || [];
            assert.strictEqual(clickHandlers.length, 1, 'Delete button must register click listener');
            clickHandlers[0]({ stopPropagation: () => {} });
            await new Promise(resolve => setTimeout(resolve, 10));
            assert.strictEqual(deletedPayloads.length, 3);
            assert.strictEqual(state.historyResults.length, 0);
            assert(
                historyResultsList.innerHTML.includes('History recording is disabled in Preferences.'),
                'Deleting last entry while disabled must display disabled notice'
            );

            console.log('✓ History overlay disabled notice, x/Delete shortcuts, and per-item delete button verified');
        }

        // 5. Static wiring and line budget checks
        {
            const prefHtml = fs.readFileSync(path.join(__dirname, '../templates/preferences.html'), 'utf8');
            const historyHtml = fs.readFileSync(path.join(__dirname, '../templates/history.html'), 'utf8');
            const historyJs = fs.readFileSync(path.join(__dirname, '../modules/overlays/history.js'), 'utf8');
            const preloadJs = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
            const paletteJs = fs.readFileSync(path.join(__dirname, '../modules/overlays/commandPalette.js'), 'utf8');
            const peekJs = fs.readFileSync(path.join(__dirname, '../modules/overlays/peekModal.js'), 'utf8');
            const shareJs = fs.readFileSync(path.join(__dirname, '../modules/overlays/shareModal.js'), 'utf8');

            assert(prefHtml.includes('id="setting-keep-history-toggle"'), 'Preferences template must include Keep History toggle');
            assert(historyHtml.includes('id="PurgeHistoryBtn"'), 'History template must retain Purge All History button');
            assert(!historyJs.includes('toggleHelpMenuWindow'), 'History overlay must not retain dead toggleHelpMenuWindow reference');
            assert(!paletteJs.includes('stored locally in SQLite'), 'Command Palette must not falsely claim SQLite history storage');
            assert(preloadJs.includes('deleteHistoryItem:'), 'preload.js must expose deleteHistoryItem');
            assert(preloadJs.includes('markNextWebviewEphemeral:'), 'preload.js must expose markNextWebviewEphemeral');
            assert(peekJs.includes('markNextWebviewEphemeral'), 'peekModal.js must mark ephemeral preview webviews');
            assert(shareJs.includes('markNextWebviewEphemeral'), 'shareModal.js must mark ephemeral share webviews');

            const rendererLines = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8').split('\n').length;
            const mainLines = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8').split('\n').length;
            const indexLines = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').split('\n').length;
            assert(rendererLines <= 250, `renderer.js exceeds 250-line budget (${rendererLines})`);
            assert(mainLines <= 550, `main.js exceeds 550-line budget (${mainLines})`);
            assert(indexLines <= 260, `index.html exceeds 260-line budget (${indexLines})`);

            console.log(`✓ Static wiring and line budgets verified (renderer: ${rendererLines}/250, main: ${mainLines}/550, index: ${indexLines}/260)`);
        }

        console.log('\nAll History privacy controls & hardening regression tests passed successfully!');
    } finally {
        process.env.HOME = origHome;
        try {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        } catch (_) {}
    }
})();
