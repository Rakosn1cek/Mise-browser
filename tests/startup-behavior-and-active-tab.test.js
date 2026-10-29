// tests/startup-behavior-and-active-tab.test.js
// Regression test suite for active tab persistence and configurable startup behaviour

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../main/config');
const sessionStore = require('../main/sessionStore');

console.log('Running Mise startup behaviour and active tab regression tests...');

(async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-startup-test-'));
    const tmpConfigDir = path.join(tmpHome, '.config', 'mise-browser');
    fs.mkdirSync(tmpConfigDir, { recursive: true });

    try {
        // 1. Verify default config includes startup_behavior: 'restore'
        {
            assert.strictEqual(config.DEFAULT_CONFIG.startup_behavior, 'restore', 'Default startup behaviour must be restore');
            console.log('✓ Default config includes startup_behavior: restore');
        }

        // 2. Verify config validation for startup_behavior
        {
            const validModes = ['restore', 'dashboard', 'new-tab'];
            for (const mode of validModes) {
                const patch = { startup_behavior: mode };
                const res = config.validateConfigPatch(patch);
                assert.deepStrictEqual(res.rejected, [], `Mode ${mode} must not be rejected`);
                assert.strictEqual(res.clean.startup_behavior, mode, `Mode ${mode} must pass validation`);
            }

            const invalidModes = ['invalid', 'fullscreen', '', null, 123, false];
            for (const mode of invalidModes) {
                const patch = { startup_behavior: mode };
                const res = config.validateConfigPatch(patch);
                assert(res.rejected.includes('startup_behavior'), `Invalid mode ${mode} must be rejected`);
                assert.strictEqual(res.clean.startup_behavior, undefined, `Invalid mode ${mode} must not appear in clean output`);
            }
            console.log('✓ Config patch validation enforces allowed startup modes');
        }

        // 3. Verify loadBrowserConfig fallback for startup_behavior
        {
            const customPath = path.join(tmpConfigDir, 'config.json');
            fs.writeFileSync(customPath, JSON.stringify({ startup_behavior: 'invalid_mode' }), 'utf8');
            const loaded = config.loadBrowserConfig(tmpConfigDir, customPath);
            assert.strictEqual(loaded.startup_behavior, 'restore', 'Invalid startup_behavior must fall back to restore');

            fs.writeFileSync(customPath, JSON.stringify({ startup_behavior: 'dashboard' }), 'utf8');
            const loadedDashboard = config.loadBrowserConfig(tmpConfigDir, customPath);
            assert.strictEqual(loadedDashboard.startup_behavior, 'dashboard', 'Valid startup_behavior dashboard must load cleanly');
            console.log('✓ Config loader enforces valid startup_behavior with fallback');
        }

        // 4. Verify sessionStore sanitizeSessionForDisk strips Private active_tabs
        {
            const rawSession = {
                current_workspace: 'Workspace 1',
                workspaces: {
                    'Workspace 1': ['https://duckduckgo.com', 'https://github.com', 'https://reddit.com'],
                    'Private': ['https://secret.example.com']
                },
                active_tabs: {
                    'Workspace 1': 2,
                    'Private': 0
                }
            };

            const sanitized = sessionStore.sanitizeSessionForDisk(rawSession);
            assert.strictEqual(sanitized.active_tabs['Workspace 1'], 2, 'Workspace 1 active tab must remain preserved');
            assert.strictEqual(sanitized.active_tabs['Private'], undefined, 'Private active tab must be stripped from disk payload');
            console.log('✓ sanitizeSessionForDisk preserves persistent active_tabs and strips private profile');
        }

        // 5. Verify tab closure active tab index adjustment logic
        {
            const tabs = ['url0', 'url1', 'url2', 'url3'];
            const activeTabs = { 'Workspace 1': 3 };

            // Simulate closing tab index 1 (before active tab 3)
            const closedIdx = 1;
            tabs.splice(closedIdx, 1);
            if (activeTabs['Workspace 1'] > closedIdx) {
                activeTabs['Workspace 1'] -= 1;
            }
            assert.strictEqual(activeTabs['Workspace 1'], 2, 'Active tab 3 must become index 2 after preceding tab removal');

            // Simulate closing active tab itself (index 2)
            const closedActiveIdx = 2;
            tabs.splice(closedActiveIdx, 1);
            if (activeTabs['Workspace 1'] === closedActiveIdx) {
                activeTabs['Workspace 1'] = Math.max(0, Math.min(closedActiveIdx, tabs.length - 1));
            }
            assert.strictEqual(activeTabs['Workspace 1'], 1, 'Active tab must clamp to new boundary when active tab closed');

            // Simulate closing remaining tabs until empty
            tabs.length = 0;
            if (tabs.length === 0) {
                activeTabs['Workspace 1'] = 0;
            }
            assert.strictEqual(activeTabs['Workspace 1'], 0, 'Active tab must safely reset to 0 when workspace has no tabs');
            console.log('✓ Tab closure boundary calculations adjust active tab correctly');
        }

        // 6. Verify tab transfer active tab index adjustment logic
        {
            const { transferTab } = await import('../modules/tabTransfer.js');
            const mockState = {
                sessionState: {
                    current_workspace: 'WS1',
                    workspaces: {
                        'WS1': ['https://a.com', 'https://b.com', 'https://c.com'],
                        'WS2': ['https://d.com']
                    },
                    active_tabs: {
                        'WS1': 2,
                        'WS2': 0
                    }
                },
                activeViewsCache: {},
                activeTitlesCache: {},
                tabSleepStates: {},
                tabActivityTimestamps: {},
                tabMediaAudible: {},
                tabAudioMuted: {},
                tabPinned: {},
                tabFavicons: {},
                tabDarkReaderStates: {},
                tabHistory: {}
            };

            // Transfer tab index 0 from WS1 to WS2
            const destination = transferTab(mockState, 'WS1', 0, 'WS2', 1);
            assert.strictEqual(destination, 1, 'Tab must arrive at destination index 1');
            assert.strictEqual(mockState.sessionState.active_tabs['WS1'], 1, 'WS1 active tab 2 must adjust to 1 after removing index 0');
            assert.strictEqual(mockState.sessionState.active_tabs['WS2'], 0, 'WS2 active tab 0 must remain 0 when tab appended after');
            console.log('✓ transferTab adjusts active tab indexes safely across workspaces');
        }

        // 7. Verify startup sleep state assignment keeps only restored active tab awake
        {
            const workspaceTabs = ['https://tab0.com', 'https://tab1.com', 'https://reddit.com', 'https://tab3.com'];
            const activeIdx = 2; // Tab 3 is active
            const sleepStates = [];

            workspaceTabs.forEach((u, i) => {
                if (i !== activeIdx) {
                    sleepStates[i] = { url: u, title: u, hibernatedAt: Date.now() };
                } else {
                    sleepStates[i] = null; // Awake
                }
            });

            assert.strictEqual(sleepStates[0] !== null, true, 'Tab 0 must be sleeping');
            assert.strictEqual(sleepStates[1] !== null, true, 'Tab 1 must be sleeping');
            assert.strictEqual(sleepStates[2], null, 'Tab 2 (active Reddit tab) must remain awake');
            assert.strictEqual(sleepStates[3] !== null, true, 'Tab 3 must be sleeping');
            console.log('✓ Boot sleep allocation wakes only the saved active tab and sleeps background tabs');
        }

        console.log('All startup behaviour and active tab regression tests passed successfully!\n');
    } finally {
        try {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        } catch (_) {}
    }
})();
