// tests/task-manager-overlay.test.js
// Automated regression test suite for Milestone 5: Task Manager Overlay (Tab Resource Inspector)

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Mock Electron runtime before loading main process modules
try {
    const electronResolved = require.resolve('electron');
    require.cache[electronResolved] = {
        id: electronResolved,
        filename: electronResolved,
        loaded: true,
        exports: {
            app: {
                getPath: () => '/tmp',
                getAppMetrics: () => []
            },
            dialog: {},
            clipboard: { writeText: () => {} },
            session: { defaultSession: {} },
            net: { fetch: async () => ({ ok: false }) },
            webContents: {
                fromId: () => null,
                getAllWebContents: () => []
            }
        }
    };
} catch (_) {}

console.log('Running Mise Task Manager Overlay regression tests...');

(async () => {
    // 1. Template and templateLoader registration verification
    {
        const tplPath = path.join(__dirname, '../templates/task-manager.html');
        assert(fs.existsSync(tplPath), 'templates/task-manager.html must exist on disk');
        const content = fs.readFileSync(tplPath, 'utf8');

        const requiredIds = [
            'TaskManagerOverlay',
            'TaskManagerTotalPss',
            'TaskManagerTotalRss',
            'TaskManagerTotalUss',
            'TaskManagerTotalCpu',
            'TaskManagerProcessCount',
            'TaskManagerHibernateAllBtn',
            'TaskManagerRefreshBtn',
            'CloseTaskManagerBtn',
            'TaskManagerTabList'
        ];
        for (const id of requiredIds) {
            assert(content.includes(`id="${id}"`), `Template must define #${id}`);
        }

        const loaderSource = fs.readFileSync(path.join(__dirname, '../modules/templateLoader.js'), 'utf8');
        assert(
            loaderSource.includes("'task-manager': 'templates/task-manager.html'"),
            'modules/templateLoader.js must register task-manager in REGISTERED_TEMPLATES'
        );

        console.log('✓ Task Manager template structure and templateLoader registration verified');
    }

    // 2. Stylesheet and overlays.css aggregation verification
    {
        const cssPath = path.join(__dirname, '../styles/overlays/taskManager.css');
        assert(fs.existsSync(cssPath), 'styles/overlays/taskManager.css must exist on disk');
        const cssContent = fs.readFileSync(cssPath, 'utf8');

        assert(cssContent.includes('#TaskManagerOverlay'), 'CSS must define #TaskManagerOverlay');
        assert(
            cssContent.includes('background-color: color-mix(in srgb, var(--bg-main) var(--overlay-opacity, 100%), transparent);'),
            'CSS must style #TaskManagerOverlay as a unified full-page webview overlay'
        );
        assert(cssContent.includes('.task-manager-card'), 'CSS must define .task-manager-card');
        assert(cssContent.includes('.task-manager-totals-grid'), 'CSS must define .task-manager-totals-grid');
        assert(cssContent.includes('.task-manager-row'), 'CSS must define .task-manager-row');
        assert(cssContent.includes('body.light-mode'), 'CSS must define light mode overrides');

        const overlaysCss = fs.readFileSync(path.join(__dirname, '../styles/overlays.css'), 'utf8');
        assert(
            overlaysCss.includes("@import './overlays/taskManager.css';"),
            'styles/overlays.css must import ./overlays/taskManager.css'
        );

        console.log('✓ Tokyo Night stylesheet, light mode overrides, and overlays.css import verified');
    }

    // 3. Keybinds, Command Palette, Preferences, and Documentation verification
    {
        const keybinds = require('../keybinds.js');
        assert.equal(keybinds.DEFAULT_KEYBINDS['toggle-task-manager'], 'Ctrl+Shift+T', 'Default keybind must be Ctrl+Shift+T');
        assert.ok(keybinds.ACTION_METADATA['toggle-task-manager'], 'ACTION_METADATA must include toggle-task-manager');
        assert.equal(keybinds.ACTION_METADATA['toggle-task-manager'].category, 'System');

        // Enforce strict Alt modifier ban across all default keybinds
        for (const [action, bind] of Object.entries(keybinds.DEFAULT_KEYBINDS)) {
            const list = Array.isArray(bind) ? bind : [bind];
            for (const chord of list) {
                assert(!String(chord).toLowerCase().includes('alt'), `Keybind for ${action} must not use Alt modifier`);
            }
        }

        const paletteSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/commandPalette.js'), 'utf8');
        assert(paletteSource.includes("id: 'toggle-task-manager'"), 'Command Palette must include toggle-task-manager entry');
        assert(paletteSource.includes("shortcut: 'Ctrl+Shift+T'"), 'Command Palette must document Ctrl+Shift+T shortcut');

        const prefSource = fs.readFileSync(path.join(__dirname, '../templates/preferences.html'), 'utf8');
        assert(prefSource.includes('data-action="toggle-task-manager"'), 'Preferences must include data-action="toggle-task-manager"');
        assert(prefSource.includes('Ctrl + Shift + T'), 'Preferences must display Ctrl + Shift + T shortcut');

        const keybindDocs = fs.readFileSync(path.join(__dirname, '../docs/reference/keybinds.md'), 'utf8');
        assert(keybindDocs.includes('toggle-task-manager'), 'docs/reference/keybinds.md must document toggle-task-manager');

        const paletteDocs = fs.readFileSync(path.join(__dirname, '../docs/reference/command-palette.md'), 'utf8');
        assert(paletteDocs.includes('toggle-task-manager'), 'docs/reference/command-palette.md must document toggle-task-manager');

        console.log('✓ Keybinds, Command Palette, Preferences, and reference docs verified');
    }

    // 4. Main process readProcSmapsRollup and gatherTaskManagerMetrics unit tests
    {
        const systemIpc = require('../main/systemIpc.js');
        assert.equal(typeof systemIpc.readProcSmapsRollup, 'function');
        assert.equal(typeof systemIpc.gatherTaskManagerMetrics, 'function');

        const mockProcContents = {
            '/proc/101/smaps_rollup': [
                '55a1-55a2 ---p 00000000 00:00 0 [rollup]',
                'Rss:              204800 kB',
                'Pss:              102400 kB',
                'Shared_Clean:      90000 kB',
                'Shared_Dirty:      12400 kB',
                'Private_Clean:     20480 kB',
                'Private_Dirty:     81920 kB'
            ].join('\n'),
            '/proc/202/smaps_rollup': [
                'Rss:               51200 kB',
                'Pss:               25600 kB',
                'Shared_Clean:      20000 kB',
                'Shared_Dirty:       5600 kB',
                'Private_Clean:      5120 kB',
                'Private_Dirty:     20480 kB'
            ].join('\n')
        };

        const mockFs = {
            promises: {
                readFile: async (filePath) => {
                    if (mockProcContents[filePath]) return mockProcContents[filePath];
                    throw new Error('ENOENT');
                }
            }
        };

        const parsed101 = await systemIpc.readProcSmapsRollup(101, mockFs, { platform: 'linux' });
        assert.deepEqual(parsed101, {
            rssKB: 204800,
            pssKB: 102400,
            ussKB: 102400,
            sharedKB: 102400
        });

        // Graceful fallback when /proc entry is missing or non-Linux platform
        const missingProc = await systemIpc.readProcSmapsRollup(999, mockFs, { platform: 'linux' });
        assert.equal(missingProc, null, 'Missing procfs file must return null cleanly');
        const nonLinux = await systemIpc.readProcSmapsRollup(101, mockFs, { platform: 'darwin' });
        assert.equal(nonLinux, null, 'Non-Linux platform must return null cleanly');

        // Verify totals across unique processes without double counting shared PIDs
        const mockApp = {
            getAppMetrics: () => [
                { pid: 101, type: 'Tab', cpu: { percentCPUUsage: 12.44 }, memory: { residentSet: 210000 } },
                { pid: 101, type: 'Tab', cpu: { percentCPUUsage: 12.44 }, memory: { residentSet: 210000 } },
                { pid: 202, type: 'Browser', cpu: { percentCPUUsage: 3.12 }, memory: { residentSet: 55000 } },
                { pid: 303, type: 'GPU', cpu: { percentCPUUsage: 4.0 }, memory: { residentSet: 40960, privateBytes: 20480 } }
            ]
        };

        const mockWebContents = {
            getAllWebContents: () => [
                {
                    id: 11,
                    isDestroyed: () => false,
                    getOSProcessId: () => 101,
                    getType: () => 'webview',
                    getURL: () => 'https://example.com',
                    getTitle: () => 'Example Domain'
                },
                {
                    id: 12,
                    isDestroyed: () => false,
                    getOSProcessId: () => 101,
                    getType: () => 'webview',
                    getURL: () => 'https://archlinux.org',
                    getTitle: () => 'Arch Linux'
                },
                {
                    id: 13,
                    isDestroyed: () => true,
                    getOSProcessId: () => { throw new Error('Destroyed'); }
                }
            ]
        };

        const gathered = await systemIpc.gatherTaskManagerMetrics({
            app: mockApp,
            webContents: mockWebContents,
            fs: mockFs,
            platform: 'linux'
        });

        assert.equal(gathered.totals.processCount, 3, 'Duplicate PID entries must be deduplicated');
        // PSS: (102400 + 25600 + 20480) / 1024 = 145.0 MB
        assert.equal(gathered.totals.pssMB, 145);
        // RSS: (204800 + 51200 + 40960) / 1024 = 290.0 MB
        assert.equal(gathered.totals.rssMB, 290);
        // USS: (102400 + 25600 + 20480) / 1024 = 145.0 MB
        assert.equal(gathered.totals.ussMB, 145);
        assert.equal(gathered.totals.cpuPercent, 19.5);
        assert.equal(gathered.webContentsMap[11].pssMB, 100);
        assert.equal(gathered.webContentsMap[12].pid, 101);
        assert.equal(gathered.webContentsMap[13], undefined, 'Destroyed webContents must be excluded');

        console.log('✓ Main process smaps_rollup parser and resource aggregator verified');
    }

    // 5. Frontend Controller: Safe Webview Guarding, Multi-Workspace Ordering, Hotkeys, Actions, and XSS Escaping
    {
        class MockClassList {
            constructor() {
                this.classes = new Set();
            }
            add(c) { this.classes.add(c); }
            remove(c) { this.classes.delete(c); }
            contains(c) { return this.classes.has(c); }
            toggle(c, force) {
                if (force === undefined) {
                    if (this.classes.has(c)) this.classes.delete(c);
                    else this.classes.add(c);
                } else if (force) {
                    this.classes.add(c);
                } else {
                    this.classes.delete(c);
                }
            }
        }

        class MockElement {
            constructor(id = '', tagName = 'div') {
                this.id = id;
                this.tagName = tagName.toUpperCase();
                this.style = { display: id === 'TaskManagerOverlay' ? 'none' : '' };
                this.classList = new MockClassList();
                this.className = '';
                this.children = [];
                this.innerHTML = '';
                this.textContent = '';
                this.title = '';
                this.scrollTop = 0;
                this.disabled = false;
                this.dataset = {};
                this.attrs = {};
                this._listeners = {};
            }
            addEventListener(type, fn) {
                if (!this._listeners[type]) this._listeners[type] = [];
                this._listeners[type].push(fn);
            }
            removeEventListener(type, fn) {
                if (!this._listeners[type]) return;
                this._listeners[type] = this._listeners[type].filter((cb) => cb !== fn);
            }
            dispatchEvent(evt) {
                const handlers = this._listeners[evt.type] || [];
                handlers.forEach((fn) => fn(evt));
            }
            focus() { global.document.activeElement = this; }
            blur() {}
            scrollIntoView() {}
            setAttribute(k, v) { this.attrs[k] = String(v); }
            getAttribute(k) { return this.attrs[k] || null; }
            appendChild(child) { this.children.push(child); return child; }
            contains(el) { return el === this || this.children.includes(el); }
            querySelector(sel) {
                if (sel.startsWith('#')) {
                    const id = sel.slice(1);
                    return elements[id] || null;
                }
                if (sel === '#TabList li.selected') {
                    return tabListLiItems.find((li) => li.classList.contains('selected')) || null;
                }
                return null;
            }
            querySelectorAll(sel) {
                if (sel === 'webview') return [];
                if (sel === '#TaskManagerHibernateAllBtn, #TaskManagerRefreshBtn, #CloseTaskManagerBtn') {
                    return [elements['TaskManagerHibernateAllBtn'], elements['TaskManagerRefreshBtn'], elements['CloseTaskManagerBtn']];
                }
                if (sel === '.task-manager-row') {
                    return mockRenderedRows;
                }
                return [];
            }
        }

        let mockRenderedRows = [];
        let tabListLiItems = [];

        const elements = {
            'TaskManagerOverlay': new MockElement('TaskManagerOverlay', 'div'),
            'TaskManagerTotalPss': new MockElement('TaskManagerTotalPss', 'span'),
            'TaskManagerTotalRss': new MockElement('TaskManagerTotalRss', 'span'),
            'TaskManagerTotalUss': new MockElement('TaskManagerTotalUss', 'span'),
            'TaskManagerTotalCpu': new MockElement('TaskManagerTotalCpu', 'span'),
            'TaskManagerProcessCount': new MockElement('TaskManagerProcessCount', 'span'),
            'TaskManagerHibernateAllBtn': new MockElement('TaskManagerHibernateAllBtn', 'button'),
            'TaskManagerRefreshBtn': new MockElement('TaskManagerRefreshBtn', 'button'),
            'CloseTaskManagerBtn': new MockElement('CloseTaskManagerBtn', 'button'),
            'TaskManagerTabList': new MockElement('TaskManagerTabList', 'div'),
            'TaskManagerEmptyState': new MockElement('TaskManagerEmptyState', 'div'),
            'webview-container': new MockElement('webview-container', 'div'),
            'TabList': new MockElement('TabList', 'ul'),
            'Sidebar': new MockElement('Sidebar', 'div'),
            'WorkspaceLabel': new MockElement('WorkspaceLabel', 'span'),
            'WorkspaceBadge': new MockElement('WorkspaceBadge', 'div'),
            'WorkspaceHeader': new MockElement('WorkspaceHeader', 'div'),
            'EmptyWorkspaceWelcome': new MockElement('EmptyWorkspaceWelcome', 'div'),
            'StatusBarMode': new MockElement('StatusBarMode', 'span'),
            'StatusBarUrl': new MockElement('StatusBarUrl', 'span'),
            'StatusBarPartition': new MockElement('StatusBarPartition', 'span'),
            'StatusBarSecurity': new MockElement('StatusBarSecurity', 'span')
        };

        // Keep mockRenderedRows synced whenever TaskManagerTabList.innerHTML updates
        let rawListHtml = '';
        Object.defineProperty(elements['TaskManagerTabList'], 'innerHTML', {
            get: () => rawListHtml,
            set: (val) => {
                rawListHtml = String(val || '');
                const matches = [...rawListHtml.matchAll(/class="task-manager-row([^"]*)" data-idx="(\d+)"/g)];
                mockRenderedRows = matches.map((m) => {
                    const rowEl = new MockElement('', 'div');
                    if (m[1].includes('selected')) rowEl.classList.add('selected');
                    rowEl.dataset.idx = m[2];
                    return rowEl;
                });
            }
        });

        const buildSidebarLis = (count, activeIdx = 0) => {
            tabListLiItems = [];
            for (let i = 0; i < count; i++) {
                const li = new MockElement('', 'li');
                if (i === activeIdx) li.classList.add('selected');
                tabListLiItems.push(li);
            }
        };

        global.document = {
            readyState: 'complete',
            activeElement: null,
            body: new MockElement('body', 'body'),
            getElementById: (id) => elements[id] || null,
            querySelector: (sel) => {
                if (sel === '#TabList li.selected') {
                    return tabListLiItems.find((li) => li.classList.contains('selected')) || null;
                }
                if (sel.startsWith('#')) return elements[sel.slice(1)] || null;
                return null;
            },
            querySelectorAll: (sel) => {
                if (sel === '#TabList li') return tabListLiItems;
                return [];
            },
            createElement: (tag) => {
                const el = new MockElement('', tag);
                if (tag.toLowerCase() === 'li') {
                    tabListLiItems.push(el);
                }
                return el;
            },
            addEventListener: () => {},
            removeEventListener: () => {}
        };

        let savedSessions = [];
        let compactMemoryCalls = 0;
        let metricsFetchCount = 0;

        let mockMetricsPayload = {
            timestamp: Date.now(),
            totals: {
                pssMB: 215.4,
                rssMB: 412.8,
                ussMB: 189.2,
                cpuPercent: 14.3,
                processCount: 4
            },
            processes: [
                { pid: 4001, type: 'Tab', cpuPercent: 2.1, pssMB: 84.5, rssMB: 140.0, ussMB: 72.0 },
                { pid: 4002, type: 'Tab', cpuPercent: 11.4, pssMB: 112.2, rssMB: 190.0, ussMB: 99.0 }
            ],
            webContentsMap: {
                501: { webContentsId: 501, pid: 4001, type: 'webview', url: 'https://active.example', cpuPercent: 2.1, pssMB: 84.5, rssMB: 140.0, ussMB: 72.0 },
                502: { webContentsId: 502, pid: 4002, type: 'webview', url: 'https://heavy.example', cpuPercent: 11.4, pssMB: 112.2, rssMB: 190.0, ussMB: 99.0 }
            }
        };

        global.window = {
            miseAllowWebviewFocus: false,
            addEventListener: () => {},
            removeEventListener: () => {},
            miseAPI: {
                getTaskManagerMetrics: async () => {
                    metricsFetchCount++;
                    return mockMetricsPayload;
                },
                compactMemory: async () => {
                    compactMemoryCalls++;
                    return true;
                },
                saveSession: async (sess) => {
                    savedSessions.push(JSON.parse(JSON.stringify(sess)));
                    return true;
                },
                flushSessionStore: async () => true,
                getBrowserSettings: async () => ({ trusted_domains: [] }),
                getWebviewPreloadPath: () => '/tmp/webview-preload.js'
            }
        };

        const { state } = await import('../modules/state.js');
        const taskManager = await import('../modules/overlays/taskManager.js');

        taskManager.resetTaskManagerState();

        // Populate multi-workspace session state (with malicious XSS title and unready throwing webview)
        let focusedActiveWv = false;
        const makeMockWebview = ({ wcId, url, title, throwGetWcId = false, audible = false }) => ({
            style: { display: 'flex' },
            __miseDestroyed: false,
            __miseAbortController: new AbortController(),
            getWebContentsId: () => {
                if (throwGetWcId) {
                    throw new Error('The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.');
                }
                return wcId;
            },
            getOSProcessId: () => {
                if (throwGetWcId) {
                    throw new Error('Not ready');
                }
                return wcId === 501 ? 4001 : 4002;
            },
            getURL: () => url,
            getTitle: () => title,
            isCurrentlyAudible: () => audible,
            executeJavaScript: async () => '[0, 0]',
            setAudioMuted: () => {},
            stop: () => {},
            remove: () => {},
            focus: () => { focusedActiveWv = true; },
            blur: () => {}
        });

        const wvActive = makeMockWebview({ wcId: 501, url: 'https://active.example', title: 'Active Tab' });
        const wvBackgroundHeavy = makeMockWebview({ wcId: 502, url: 'https://heavy.example', title: '<script>alert("xss")</script> Heavy' });
        const wvLoadingUnready = makeMockWebview({ wcId: null, url: 'https://loading.example', title: 'Loading Tab', throwGetWcId: true });
        const wvOtherWs = makeMockWebview({ wcId: 502, url: 'https://other-ws.example', title: 'Research Doc' });

        state.sessionState = {
            current_workspace: 'Work',
            workspaces: {
                'Research': ['https://other-ws.example', 'https://sleeping-other.example'],
                'Work': ['https://active.example', 'https://heavy.example', 'https://loading.example', 'https://pinned.example'],
                'Private': []
            },
            active_tabs: { 'Work': 0, 'Research': 0 },
            workspace_visuals: {
                'Work': { color: '#7aa2f7', glyph: 'W' },
                'Research': { color: '#9ece6a', glyph: 'R' }
            }
        };

        state.activeViewsCache = {
            'Work': [wvActive, wvBackgroundHeavy, wvLoadingUnready, null],
            'Research': [wvOtherWs, null]
        };
        state.activeTitlesCache = {
            'Work': ['Active Tab', '<script>alert("xss")</script> Heavy', 'Loading Tab', 'Pinned Sleeping Tab'],
            'Research': ['Research Doc', 'Sleeping Research']
        };
        state.tabSleepStates = {
            'Work': [null, null, null, { url: 'https://pinned.example', title: 'Pinned Sleeping Tab', hibernatedAt: Date.now() }],
            'Research': [null, { url: 'https://sleeping-other.example', title: 'Sleeping Research', hibernatedAt: Date.now() }]
        };
        state.tabPinned = {
            'Work': [false, false, false, true],
            'Research': [false, false]
        };
        state.tabMediaAudible = { 'Work': [false, false, false, false], 'Research': [false, false] };
        state.tabAudioMuted = { 'Work': [false, false, false, false], 'Research': [false, false] };
        state.tabDarkReaderStates = { 'Work': [false, false, false, false], 'Research': [false, false] };
        state.tabFavicons = { 'Work': [], 'Research': [] };
        state.tabActivityTimestamps = { 'Work': [Date.now(), Date.now(), Date.now(), 0], 'Research': [Date.now(), 0] };
        state.splitStates = {};

        buildSidebarLis(4, 0);

        taskManager.setupTaskManagerListeners(elements['TaskManagerOverlay']);
        const opened = taskManager.openTaskManagerOverlay();
        assert.equal(opened, true, 'openTaskManagerOverlay must return true');
        assert.equal(state.taskManagerActive, true, 'state.taskManagerActive must be true when open');

        // Allow initial async refreshTaskManagerMetrics() to complete
        await new Promise((resolve) => setTimeout(resolve, 25));

        assert.equal(elements['TaskManagerTotalPss'].textContent, '215.4 MB');
        assert.equal(elements['TaskManagerTotalRss'].textContent, '412.8 MB');
        assert.equal(elements['TaskManagerTotalUss'].textContent, '189.2 MB');
        assert.equal(elements['TaskManagerTotalCpu'].textContent, '14.3%');
        assert.equal(elements['TaskManagerProcessCount'].textContent, '4');

        // Verify workspace ordering (active workspace 'Work' first, 'Research' second, empty 'Private' omitted)
        const rows = taskManager.getTaskManagerRows();
        assert.equal(rows.length, 6, 'Must list 4 tabs in Work and 2 tabs in Research');
        assert.equal(rows[0].workspace, 'Work', 'Active workspace must be listed first');
        assert.equal(rows[0].statusLabel, 'Active');
        assert.equal(rows[1].memoryMB, 112.2, 'Heavy background tab must display PSS memory');
        assert.equal(rows[1].cpuPercent, 11.4, 'Heavy background tab must display CPU utilisation');
        assert.equal(rows[2].title, 'Loading Tab', 'Throwing getWebContentsId() must be guarded safely');
        assert.equal(rows[3].isSleeping, true, 'Hibernated tab must report sleeping');
        assert.equal(rows[3].memoryMB, 0, 'Hibernated tab must report 0 MB');
        assert.equal(rows[4].workspace, 'Research', 'Secondary workspace tabs must follow active workspace');

        // Verify XSS escaping on rendered HTML
        assert(!elements['TaskManagerTabList'].innerHTML.includes('<script>alert'), 'Rendered markup must escape HTML tags');
        assert(elements['TaskManagerTabList'].innerHTML.includes('&lt;script&gt;alert'), 'Escaped title must appear safely');

        const dispatchKey = (key, opts = {}) => {
            elements['TaskManagerOverlay'].dispatchEvent({
                type: 'keydown',
                key,
                ctrlKey: false,
                altKey: false,
                metaKey: false,
                shiftKey: !!opts.shiftKey,
                preventDefault: () => {},
                stopPropagation: () => {}
            });
        };

        // Navigate down with 'j' to heavy background tab (index 1)
        dispatchKey('j');
        assert.equal(taskManager.getSelectedTaskManagerIndex(), 1);
        dispatchKey('ArrowDown');
        assert.equal(taskManager.getSelectedTaskManagerIndex(), 2);
        dispatchKey('k');
        assert.equal(taskManager.getSelectedTaskManagerIndex(), 1);
        dispatchKey('ArrowUp');
        assert.equal(taskManager.getSelectedTaskManagerIndex(), 0);
        dispatchKey('j');
        assert.equal(taskManager.getSelectedTaskManagerIndex(), 1);

        // Press 'z' to hibernate heavy background tab (index 1)
        dispatchKey('z');
        await new Promise((resolve) => setTimeout(resolve, 40));
        assert.ok(state.tabSleepStates['Work'][1], 'z key must hibernate selected background tab immediately');
        assert.equal(state.activeViewsCache['Work'][1], null, 'Hibernated tab webview cache must be detached');
        assert(compactMemoryCalls >= 1, 'Single-key hibernation must trigger compactMemory');

        // Press 'r' to refresh metrics manually
        const prevFetches = metricsFetchCount;
        dispatchKey('r');
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert(metricsFetchCount > prevFetches, 'r key must refresh Task Manager metrics');

        // Navigate to pinned tab (index 3) and confirm 'x' protects pinned tabs
        dispatchKey('j');
        dispatchKey('j');
        assert.equal(taskManager.getSelectedTaskManagerIndex(), 3);
        const tabsBeforeProtectedClose = state.sessionState.workspaces['Work'].length;
        dispatchKey('x');
        assert.equal(state.sessionState.workspaces['Work'].length, tabsBeforeProtectedClose, 'Pinned tab must not be closed by x');

        // Navigate to unpinned loading tab (index 2) and close it with 'x'
        dispatchKey('k');
        assert.equal(taskManager.getSelectedTaskManagerIndex(), 2);
        tabListLiItems = [];
        buildSidebarLis(4, 0);
        dispatchKey('x');
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(state.sessionState.workspaces['Work'].length, 3, 'Unpinned tab must be closed by x');

        // Click Hibernate All button to hibernate all remaining background awake tabs across workspaces
        elements['TaskManagerHibernateAllBtn'].dispatchEvent({ type: 'click' });
        await new Promise((resolve) => setTimeout(resolve, 40));
        assert.ok(state.tabSleepStates['Research'][0], 'Hibernate All must hibernate background tabs in other workspaces');

        // Navigate to Research tab (now index 3) and press Enter to jump across workspaces
        const updatedRows = taskManager.getTaskManagerRows();
        const researchRowIdx = updatedRows.findIndex((r) => r.workspace === 'Research');
        assert(researchRowIdx !== -1);
        taskManager.setSelectedTaskManagerIndex(researchRowIdx);
        tabListLiItems = [];
        dispatchKey('Enter');
        await new Promise((resolve) => setTimeout(resolve, 80));

        assert.equal(state.taskManagerActive, false, 'Enter jump must close Task Manager overlay');
        assert.equal(state.sessionState.current_workspace, 'Research', 'Enter on cross-workspace row must switch active workspace');

        // Reopen and verify Escape closes cleanly and stops polling
        taskManager.openTaskManagerOverlay();
        assert.equal(state.taskManagerActive, true);
        focusedActiveWv = false;
        dispatchKey('Escape');
        assert.equal(state.taskManagerActive, false, 'Escape must close Task Manager overlay');
        assert.equal(elements['TaskManagerOverlay'].style.display, 'none');

        taskManager.resetTaskManagerState();
        console.log('✓ Task Manager UI, multi-workspace ordering, webview guards, hotkeys, and XSS escaping verified');
    }

    // 6. Line budgets and zero double dashes check
    {
        const rendererLines = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8').split('\n').length;
        const mainLines = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8').split('\n').length;
        const indexLines = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').split('\n').length;

        assert(rendererLines < 250, `renderer.js must be under 250 lines (currently ${rendererLines})`);
        assert(mainLines < 550, `main.js must be under 550 lines (currently ${mainLines})`);
        assert(indexLines <= 260, `index.html must be <= 260 lines (currently ${indexLines})`);

        const touchedFiles = [
            'modules/overlays/taskManager.js',
            'templates/task-manager.html',
            'styles/overlays/taskManager.css',
            'docs/reference/keybinds.md',
            'tests/task-manager-overlay.test.js'
        ];
        for (const rel of touchedFiles) {
            const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
            assert(!text.includes('\u2014'), `${rel} must not contain em-dashes`);
            // Check prose lines outside JS decrement/CSS custom properties for double hyphens
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (rel.endsWith('.md') || rel.endsWith('.html')) {
                    const stripped = line.replace(/<!--|-->|---+/g, '');
                    assert(!stripped.includes('--'), `${rel}:${i + 1} must not contain double dashes`);
                }
            }
        }

        console.log(`✓ Line budgets and style rules verified (renderer.js: ${rendererLines}/250, main.js: ${mainLines}/550, index.html: ${indexLines}/260)`);
    }

    console.log('All Mise Task Manager Overlay regression tests passed successfully!');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
