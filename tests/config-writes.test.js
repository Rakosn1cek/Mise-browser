// tests/config-writes.test.js
// Guards against config.json being read half-written and reset to defaults

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../main/config');

console.log('Running Mise config write safety tests...');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const configSource = fs.readFileSync(path.join(__dirname, '..', 'main', 'config.js'), 'utf8');

// 1. Verify that direct un-atomic writes to CONFIG_PATH are prevented
{
    const directWrites = (mainSource + configSource).match(/(writeFileSync|writeFile)\(CONFIG_PATH/g) || [];
    assert.strictEqual(directWrites.length, 0, 'config.json must only be written through writeConfigFile');
    assert(/function writeConfigFile\(cfg[\s\S]*?renameSync\(tmpPath, targetPath\)/.test(configSource), 'writeConfigFile writes a temporary file and renames it into place');
    console.log('✓ config.json is replaced atomically');
}

// 2. Functional atomic write verification in a temporary directory
{
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-config-test-'));
    const testConfigPath = path.join(tmpDir, 'config.json');

    try {
        const testPayload = { theme: 'light', tab_sleep_timeout_minutes: 20 };
        config.writeConfigFile(testPayload, testConfigPath);

        assert(fs.existsSync(testConfigPath), 'Configuration file must exist after atomic write');
        const readBack = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
        assert.strictEqual(readBack.theme, 'light');
        assert.strictEqual(readBack.tab_sleep_timeout_minutes, 20);

        // Verify loadBrowserConfig fallback and theme colors
        const loaded = config.loadBrowserConfig(tmpDir, testConfigPath);
        assert.strictEqual(loaded.theme, 'light');
        assert.strictEqual(loaded.spellchecker_language, 'en-GB');
        assert(loaded.theme_colors.dark.accent, 'Must inherit theme colors defaults');
        console.log('✓ Functional atomic write and schema parsing verified');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// 3. Corrupt config handling: loadBrowserConfig returns defaults and preserves corrupt copy
{
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-config-corrupt-'));
    const testConfigPath = path.join(tmpDir, 'config.json');

    try {
        fs.writeFileSync(testConfigPath, '{bad-json-payload', 'utf8');

        const loaded = config.loadBrowserConfig(tmpDir, testConfigPath);
        assert.strictEqual(loaded.theme, 'dark', 'Must return default config on corrupt file');
        assert.strictEqual(loaded.spellchecker_language, 'en-GB', 'Must return default spellchecker language');

        const corruptBackups = fs.readdirSync(tmpDir).filter((name) => name.startsWith('config.json.corrupt-'));
        assert.strictEqual(corruptBackups.length, 1, 'Corrupt config must leave a .corrupt-* copy');
        assert.strictEqual(fs.readFileSync(path.join(tmpDir, corruptBackups[0]), 'utf8'), '{bad-json-payload', 'Backup must contain exact corrupt payload');

        // Reading again on unchanged corrupt file must not duplicate backup
        const loadedAgain = config.loadBrowserConfig(tmpDir, testConfigPath);
        assert.strictEqual(loadedAgain.theme, 'dark');
        const corruptBackupsAgain = fs.readdirSync(tmpDir).filter((name) => name.startsWith('config.json.corrupt-'));
        assert.strictEqual(corruptBackupsAgain.length, 1, 'Repeat load on unchanged corrupt config must not duplicate backup');

        console.log('✓ Corrupt config recovery and backup preservation verified');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

console.log('All config write safety tests passed.\n');
