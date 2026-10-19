// tests/config-partial-updates.test.js
// Regression tests for partial configuration patches and hook dispatching

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Running Mise config partial update and hook regression tests...');

// Ensure tests never touch the real user home directory
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-config-partial-test-'));
process.env.HOME = tmpHome;

const config = require('../main/config');

(async () => {
    try {
        // 1. Verify registerConfigIpc hook dispatching and unchanged payload gating
        {
            const handlers = {};
            const fakeIpcMain = {
                handle: (channel, fn) => {
                    handlers[channel] = fn;
                }
            };

            const calls = {
                trusted: [],
                spellchecker: [],
                diagnostics: []
            };

            const hooks = {
                onTrustedDomainsChange: (domains) => calls.trusted.push(domains),
                onSpellcheckerChange: (lang) => calls.spellchecker.push(lang),
                onDiagnosticsChange: (enabled) => calls.diagnostics.push(enabled)
            };

            config.registerConfigIpc(fakeIpcMain, hooks);
            const updateHandler = handlers['update-browser-settings'];
            assert.strictEqual(typeof updateHandler, 'function', 'update-browser-settings handler must be registered');

            // Initialise config file with defaults
            config.loadBrowserConfig();

            // update { theme: 'light' } -> none of the three hooks called
            await updateHandler(null, { theme: 'light' });
            assert.strictEqual(calls.trusted.length, 0, 'onTrustedDomainsChange should not be called');
            assert.strictEqual(calls.spellchecker.length, 0, 'onSpellcheckerChange should not be called');
            assert.strictEqual(calls.diagnostics.length, 0, 'onDiagnosticsChange should not be called');

            // update { trusted_domains: ['a.com'] } -> only onTrustedDomainsChange called, with ['a.com']
            await updateHandler(null, { trusted_domains: ['a.com'] });
            assert.strictEqual(calls.trusted.length, 1, 'onTrustedDomainsChange must be called once');
            assert.deepStrictEqual(calls.trusted[0], ['a.com'], 'onTrustedDomainsChange must receive new domains');
            assert.strictEqual(calls.spellchecker.length, 0, 'onSpellcheckerChange should not be called');
            assert.strictEqual(calls.diagnostics.length, 0, 'onDiagnosticsChange should not be called');

            // the same update again (unchanged value) -> no hook called
            await updateHandler(null, { trusted_domains: ['a.com'] });
            assert.strictEqual(calls.trusted.length, 1, 'onTrustedDomainsChange should not be called when value is unchanged');
            assert.strictEqual(calls.spellchecker.length, 0, 'onSpellcheckerChange should not be called');
            assert.strictEqual(calls.diagnostics.length, 0, 'onDiagnosticsChange should not be called');

            // update { spellchecker_language: 'de-DE' } -> only onSpellcheckerChange called
            await updateHandler(null, { spellchecker_language: 'de-DE' });
            assert.strictEqual(calls.trusted.length, 1, 'onTrustedDomainsChange count remains 1');
            assert.strictEqual(calls.spellchecker.length, 1, 'onSpellcheckerChange must be called once');
            assert.strictEqual(calls.spellchecker[0], 'de-DE', 'onSpellcheckerChange must receive updated language');
            assert.strictEqual(calls.diagnostics.length, 0, 'onDiagnosticsChange should not be called');

            // update { enable_diagnostics: true } -> only onDiagnosticsChange called
            await updateHandler(null, { enable_diagnostics: true });
            assert.strictEqual(calls.trusted.length, 1, 'onTrustedDomainsChange count remains 1');
            assert.strictEqual(calls.spellchecker.length, 1, 'onSpellcheckerChange count remains 1');
            assert.strictEqual(calls.diagnostics.length, 1, 'onDiagnosticsChange must be called once');
            assert.strictEqual(calls.diagnostics[0], true, 'onDiagnosticsChange must receive updated flag');

            // update with an invalid/non-object payload (null) returns without throwing
            let errorThrown = false;
            let result = null;
            try {
                result = await updateHandler(null, null);
            } catch (err) {
                errorThrown = true;
            }
            assert.strictEqual(errorThrown, false, 'update with null must not throw');
            assert.strictEqual(result, true, 'update with null returns true without dispatching hooks');

            console.log('✓ Hook dispatching and change detection verified');
        }

        // 2. Sequential partial updates leave all values present in config.json
        {
            const handlers = {};
            const fakeIpcMain = {
                handle: (channel, fn) => {
                    handlers[channel] = fn;
                }
            };
            config.registerConfigIpc(fakeIpcMain, {});
            const updateHandler = handlers['update-browser-settings'];

            await updateHandler(null, { theme: 'light' });
            await updateHandler(null, { trusted_domains: ['a.com'] });
            await updateHandler(null, { sidebar_auto_collapse: false });

            const savedConfig = JSON.parse(fs.readFileSync(config.CONFIG_PATH, 'utf8'));
            assert.strictEqual(savedConfig.theme, 'light', 'theme must be preserved in config.json');
            assert.deepStrictEqual(savedConfig.trusted_domains, ['a.com'], 'trusted_domains must be preserved in config.json');
            assert.strictEqual(savedConfig.sidebar_auto_collapse, false, 'sidebar_auto_collapse must be preserved in config.json');

            console.log('✓ Sequential partial updates preserve accumulated state in config.json');
        }

        // 3. Source regression check on buildSettingsSubmenu
        {
            const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
            const startMarker = 'function buildSettingsSubmenu';
            const endMarker = 'function openSettingsMenu';
            const startIndex = mainSource.indexOf(startMarker);
            const endIndex = mainSource.indexOf(endMarker);

            assert(startIndex !== -1, 'buildSettingsSubmenu must exist in main.js');
            assert(endIndex !== -1, 'openSettingsMenu must exist in main.js');
            assert(startIndex < endIndex, 'buildSettingsSubmenu must precede openSettingsMenu');

            const submenuSource = mainSource.slice(startIndex, endIndex);
            assert(!submenuSource.includes('writeConfigFile('), 'buildSettingsSubmenu must not contain writeConfigFile(');
            assert(!/\bcfg\.\w+\s*=[^=]/.test(submenuSource), 'buildSettingsSubmenu must not assign to cfg properties');

            console.log('✓ Source regression checks on buildSettingsSubmenu passed');
        }

        console.log('All partial config update tests passed successfully.\n');
    } finally {
        try {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        } catch (_) {}
    }
})();
