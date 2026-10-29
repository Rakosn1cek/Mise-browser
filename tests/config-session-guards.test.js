// tests/config-session-guards.test.js
// Regression test suite for config patch validation and session payload guards

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Running Mise config validation and session payload guard regression tests...');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-config-guards-test-'));
process.env.HOME = tmpHome;

const config = require('../main/config');
const sessionStore = require('../main/sessionStore');

(async () => {
    try {
        // 1. Verify valid configuration patches pass untouched
        {
            const validPatch = {
                disable_gpu: true,
                background_throttling: false,
                sidebar_auto_collapse: false,
                show_status_bar: false,
                show_clock: false,
                enable_diagnostics: true,
                show_window_controls: true,
                process_limit: 8,
                tab_sleep_timeout_minutes: 120,
                theme: 'light',
                webview_theme: 'light',
                clock_format: 'seconds',
                email_handler: 'https://mail.google.com/mail/?view=cm&fs=1&to=%s',
                spellchecker_language: 'en-GB',
                last_seen_version: '1.2.0',
                search_engine: 'https://duckduckgo.com/?q=%s',
                trusted_domains: ['accounts.google.com', 'github.com'],
                theme_colors: {
                    dark: {
                        accent: '#7aa2f7',
                        bg_main: '#1a1b26',
                        bg_sidebar: '#16161e',
                        text: '#c0caf5',
                        sidebar_opacity: 85,
                        overlay_opacity: 90
                    }
                },
                custom_search_aliases: {
                    gh: 'https://github.com/search?q=%s',
                    aur: 'https://aur.archlinux.org/packages?K=%s'
                },
                startup_behavior: 'dashboard'
            };

            const result = config.validateConfigPatch(validPatch);
            assert.deepStrictEqual(result.rejected, [], 'No keys should be rejected for a valid patch');
            assert.deepStrictEqual(result.clean, validPatch, 'All valid keys must pass untouched');
            console.log('✓ Valid patches pass untouched');
        }

        // 2. Verify rejection rules for invalid types
        {
            const wrongTypePatch = {
                disable_gpu: 'true',
                background_throttling: 1,
                process_limit: '4',
                tab_sleep_timeout_minutes: '15',
                trusted_domains: 'https://single-domain.org',
                last_seen_version: 102,
                theme_colors: 'dark-palette',
                custom_search_aliases: ['array-instead-of-object'],
                startup_behavior: 'invalid-mode'
            };

            const result = config.validateConfigPatch(wrongTypePatch);
            assert.strictEqual(Object.keys(result.clean).length, 0, 'Clean object must be empty when all types invalid');
            for (const key of Object.keys(wrongTypePatch)) {
                assert(result.rejected.includes(key), `Key ${key} must be reported in rejected list`);
            }
            console.log('✓ Rejection rule: wrong types rejected');
        }

        // 3. Verify rejection rules for out of range numbers
        {
            const outOfRangePatch = {
                process_limit: 0,
                tab_sleep_timeout_minutes: 1441,
                theme_colors: {
                    dark: {
                        sidebar_opacity: 105,
                        overlay_opacity: -5
                    }
                }
            };

            const result = config.validateConfigPatch(outOfRangePatch);
            assert.strictEqual(Object.keys(result.clean).length, 0, 'Out of range values must be dropped');
            assert(result.rejected.includes('process_limit'), 'process_limit 0 must be rejected');
            assert(result.rejected.includes('tab_sleep_timeout_minutes'), 'tab_sleep_timeout_minutes 1441 must be rejected');
            assert(result.rejected.includes('theme_colors'), 'theme_colors with invalid opacity must be rejected');

            const boundaryCheck = config.validateConfigPatch({
                process_limit: 16,
                tab_sleep_timeout_minutes: 0
            });
            assert.strictEqual(boundaryCheck.rejected.length, 0, 'Boundary limits 16 and 0 must be accepted');
            console.log('✓ Rejection rule: out of range numbers rejected');
        }

        // 4. Verify rejection rules for bad colours
        {
            const badColours = [
                { theme_colors: { dark: { accent: 'blue' } } },
                { theme_colors: { dark: { bg_main: '#12345' } } },
                { theme_colors: { dark: { text: '#1234567' } } },
                { theme_colors: { dark: { bg_sidebar: '#gggggg' } } },
                { theme_colors: { custom_mode: { accent: '#ffffff' } } },
                { theme_colors: { dark: { unknown_prop: '#ffffff' } } }
            ];

            for (const patch of badColours) {
                const res = config.validateConfigPatch(patch);
                assert(res.rejected.includes('theme_colors'), 'Invalid theme colour or mode must be rejected');
                assert.strictEqual(res.clean.theme_colors, undefined, 'Invalid theme colour must not enter clean');
            }
            console.log('✓ Rejection rule: bad colours rejected');
        }

        // 5. Verify rejection rules for javascript: search engine and URL templates
        {
            const jsPatch = {
                search_engine: 'javascript:alert(1)',
                email_handler: 'javascript:steal_cookies()',
                custom_search_aliases: {
                    evil: 'javascript:exploit()'
                }
            };

            const result = config.validateConfigPatch(jsPatch);
            assert(result.rejected.includes('search_engine'), 'javascript: search engine must be rejected');
            assert(result.rejected.includes('email_handler'), 'javascript: email handler must be rejected');
            assert(result.rejected.includes('custom_search_aliases'), 'javascript: search alias must be rejected');
            assert.strictEqual(Object.keys(result.clean).length, 0, 'Disallowed schemes must not enter clean');

            const missingPlaceholderSearch = config.validateConfigPatch({
                search_engine: 'https://duckduckgo.com/no-placeholder'
            });
            assert(missingPlaceholderSearch.rejected.includes('search_engine'), 'Search engine lacking %s must be rejected');

            console.log('✓ Rejection rule: javascript: URL schemes rejected');
        }

        // 6. Verify rejection rules for unknown keys
        {
            const unknownPatch = {
                theme: 'light',
                unrecognised_option: true,
                arbitrary_injection: { nested: 'data' }
            };

            const result = config.validateConfigPatch(unknownPatch);
            assert.strictEqual(result.clean.theme, 'light', 'Valid known key must be preserved');
            assert(result.rejected.includes('unrecognised_option'), 'Unknown key must be reported in rejected');
            assert(result.rejected.includes('arbitrary_injection'), 'Arbitrary injection key must be reported in rejected');
            console.log('✓ Rejection rule: unknown keys rejected');
        }

        // 7. Verify external_notes_command is rejected by validateConfigPatch
        {
            const notesPatch = {
                external_notes_command: 'rm -rf /'
            };

            const result = config.validateConfigPatch(notesPatch);
            assert.strictEqual(result.clean.external_notes_command, undefined, 'external_notes_command must be dropped from clean');
            assert(result.rejected.includes('external_notes_command'), 'external_notes_command must be reported in rejected');
            console.log('✓ Rejection rule: external_notes_command dropped by validateConfigPatch');
        }

        // 8. Verify two sequential partial patches keep both values
        {
            const handlers = {};
            const fakeIpcMain = {
                handle: (channel, fn) => {
                    handlers[channel] = fn;
                }
            };

            config.registerConfigIpc(fakeIpcMain, {});
            const updateHandler = handlers['update-browser-settings'];

            // Initialise configuration
            config.loadBrowserConfig();

            // First partial update
            await updateHandler(null, { theme: 'light' });
            // Second partial update
            await updateHandler(null, { process_limit: 6 });

            const saved = JSON.parse(fs.readFileSync(config.CONFIG_PATH, 'utf8'));
            assert.strictEqual(saved.theme, 'light', 'First patch value must be preserved');
            assert.strictEqual(saved.process_limit, 6, 'Second patch value must be preserved');
            console.log('✓ Two sequential partial patches keep both values');
        }

        // 9. Verify external_notes_command confirmation dialog behaviour
        {
            const handlers = {};
            const fakeIpcMain = {
                handle: (channel, fn) => {
                    handlers[channel] = fn;
                }
            };

            let dialogShown = false;
            let capturedOptions = null;
            let mockResponse = 0; // Cancel by default

            const mockDialog = {
                showMessageBox: async (opts) => {
                    dialogShown = true;
                    capturedOptions = opts;
                    return { response: mockResponse };
                }
            };

            config.registerConfigIpc(fakeIpcMain, { dialog: mockDialog });
            const updateHandler = handlers['update-browser-settings'];

            // Test 9a: User selects Cancel (button index 0)
            mockResponse = 0;
            dialogShown = false;
            await updateHandler(null, { external_notes_command: 'kate %s' });

            assert(dialogShown, 'Confirmation dialog must be shown when external command is configured');
            assert.strictEqual(capturedOptions.type, 'warning', 'Dialog type must be warning');
            assert.deepStrictEqual(capturedOptions.buttons, ['Cancel', 'Allow'], 'Buttons must be Cancel and Allow');
            assert(capturedOptions.message.includes('kate %s'), 'Dialog message must contain the exact command string');

            let saved = JSON.parse(fs.readFileSync(config.CONFIG_PATH, 'utf8'));
            assert.notStrictEqual(saved.external_notes_command, 'kate %s', 'Command must not be saved when cancelled');

            // Test 9b: User selects Allow (button index 1)
            mockResponse = 1;
            dialogShown = false;
            await updateHandler(null, { external_notes_command: 'kate %s' });

            assert(dialogShown, 'Confirmation dialog must be shown');
            saved = JSON.parse(fs.readFileSync(config.CONFIG_PATH, 'utf8'));
            assert.strictEqual(saved.external_notes_command, 'kate %s', 'Command must be saved when allowed by user');

            console.log('✓ External notes command requires user confirmation before saving');
        }

        // 10. Verify save-session IPC handler accepts normal session and rejects malformed/oversized ones
        {
            const sessionHandlers = {};
            const fakeIpcMain = {
                handle: (channel, fn) => {
                    sessionHandlers[channel] = fn;
                }
            };

            sessionStore.registerSessionIpc(fakeIpcMain);
            const saveSessionHandler = sessionHandlers['save-session'];
            assert.strictEqual(typeof saveSessionHandler, 'function', 'save-session handler must be registered');

            // 10a: Normal valid session accepted
            const validSession = {
                current_workspace: 'Workspace 1',
                workspaces: {
                    'Workspace 1': ['https://duckduckgo.com', 'https://github.com'],
                    'Workspace 2': ['https://archlinux.org']
                }
            };
            const validRes = await saveSessionHandler(null, validSession);
            assert.strictEqual(validRes, true, 'Valid normal session must be accepted');

            // 10b: Non-object payloads rejected
            assert.strictEqual(await saveSessionHandler(null, null), false, 'null payload must be rejected');
            assert.strictEqual(await saveSessionHandler(null, undefined), false, 'undefined payload must be rejected');
            assert.strictEqual(await saveSessionHandler(null, 'string-payload'), false, 'string payload must be rejected');
            assert.strictEqual(await saveSessionHandler(null, 12345), false, 'numeric payload must be rejected');
            assert.strictEqual(await saveSessionHandler(null, [validSession]), false, 'array payload must be rejected');

            // 10c: Malformed current_workspace rejected
            assert.strictEqual(await saveSessionHandler(null, {
                current_workspace: null,
                workspaces: { 'Workspace 1': [] }
            }), false, 'Non-string current_workspace must be rejected');

            const longWsName = 'a'.repeat(201);
            assert.strictEqual(await saveSessionHandler(null, {
                current_workspace: longWsName,
                workspaces: { 'Workspace 1': [] }
            }), false, 'current_workspace > 200 chars must be rejected');

            // 10d: Malformed workspaces rejected
            assert.strictEqual(await saveSessionHandler(null, {
                current_workspace: 'Workspace 1',
                workspaces: null
            }), false, 'Null workspaces must be rejected');

            assert.strictEqual(await saveSessionHandler(null, {
                current_workspace: 'Workspace 1',
                workspaces: ['not-an-object']
            }), false, 'Array workspaces must be rejected');

            assert.strictEqual(await saveSessionHandler(null, {
                current_workspace: 'Workspace 1',
                workspaces: { 'Workspace 1': 'not-an-array' }
            }), false, 'Workspace tabs that are not an array must be rejected');

            assert.strictEqual(await saveSessionHandler(null, {
                current_workspace: 'Workspace 1',
                workspaces: { 'Workspace 1': [123, null] }
            }), false, 'Non-string tab URL must be rejected');

            const longTabUrl = 'https://example.com/' + 'x'.repeat(16385);
            assert.strictEqual(await saveSessionHandler(null, {
                current_workspace: 'Workspace 1',
                workspaces: { 'Workspace 1': [longTabUrl] }
            }), false, 'Tab URL > 16384 chars must be rejected');

            // 10e: Invalid active_tabs rejected
            assert.strictEqual(await saveSessionHandler(null, {
                current_workspace: 'Workspace 1',
                workspaces: { 'Workspace 1': [] },
                active_tabs: 'not-an-object'
            }), false, 'Non-object active_tabs must be rejected');

            assert.strictEqual(await saveSessionHandler(null, {
                current_workspace: 'Workspace 1',
                workspaces: { 'Workspace 1': [] },
                active_tabs: { 'Workspace 1': -1 }
            }), false, 'Negative active_tabs index must be rejected');

            assert.strictEqual(await saveSessionHandler(null, {
                current_workspace: 'Workspace 1',
                workspaces: { 'Workspace 1': [] },
                active_tabs: { 'Workspace 1': 'zero' }
            }), false, 'Non-integer active_tabs index must be rejected');

            // 10f: Valid active_tabs accepted
            assert.strictEqual(await saveSessionHandler(null, {
                current_workspace: 'Workspace 1',
                workspaces: { 'Workspace 1': ['https://duckduckgo.com', 'https://reddit.com'] },
                active_tabs: { 'Workspace 1': 1 }
            }), true, 'Valid active_tabs payload must be accepted');

            // 10g: Oversized session payload (> 5 MB) rejected
            const largeTabList = [];
            for (let i = 0; i < 600; i++) {
                largeTabList.push('https://example.com/item/' + 'z'.repeat(10000));
            }
            const oversizedSession = {
                current_workspace: 'Workspace 1',
                workspaces: {
                    'Workspace 1': largeTabList
                }
            };
            const jsonSize = JSON.stringify(oversizedSession).length;
            assert(jsonSize > 5 * 1024 * 1024, 'Session payload must exceed 5 MB for this test');
            assert.strictEqual(await saveSessionHandler(null, oversizedSession), false, 'Oversized session payload must be rejected');

            console.log('✓ save-session accepts normal session and rejects malformed or oversized payloads');
        }

        console.log('All config validation and session payload guard regression tests passed successfully.\n');
    } finally {
        try {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        } catch (_) {}
    }
})();
