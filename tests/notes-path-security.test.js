// tests/notes-path-security.test.js
// Verification for notes external editor path containment and IPC isolation

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('Running Mise notes external editor path containment security tests...');

const storage = require('../main/storage.js');
const { resolveSafeNotesPath, openNotesInExternalApp } = storage;

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-notes-sec-'));

try {
    // 1. Verify resolveSafeNotesPath containment logic
    const defaultExpected = path.join(testDir, 'notes.md');

    // Default when no custom path is supplied
    assert.equal(resolveSafeNotesPath(null, testDir), defaultExpected);
    assert.equal(resolveSafeNotesPath(undefined, testDir), defaultExpected);
    assert.equal(resolveSafeNotesPath('', testDir), defaultExpected);

    // Valid relative path inside directory
    const validRelative = 'notes.md';
    assert.equal(resolveSafeNotesPath(validRelative, testDir), defaultExpected);

    // Path traversal attempts must be rejected and defaulted to notes.md
    assert.equal(resolveSafeNotesPath('../../etc/passwd', testDir), defaultExpected);
    assert.equal(resolveSafeNotesPath('../../../.bashrc', testDir), defaultExpected);
    assert.equal(resolveSafeNotesPath('/etc/shadow', testDir), defaultExpected);
    assert.equal(resolveSafeNotesPath('/tmp/evil_payload.sh', testDir), defaultExpected);

    console.log('✓ resolveSafeNotesPath confines paths strictly to configuration directory');

    // 2. Verify openNotesInExternalApp does not create files outside test directory
    const sensitiveFileTarget = path.join(testDir, '..', 'should_never_exist_' + Date.now() + '.txt');
    assert.equal(fs.existsSync(sensitiveFileTarget), false);

    // Pass malicious traversal into openNotesInExternalApp
    const res = openNotesInExternalApp('../' + path.basename(sensitiveFileTarget), testDir);
    assert.equal(fs.existsSync(sensitiveFileTarget), false, 'File must not be created outside target directory');
    assert.equal(fs.existsSync(defaultExpected), true, 'Safe default notes file should exist instead');

    console.log('✓ openNotesInExternalApp prevents file creation outside configuration directory');

    // 3. Verify IPC registration ignores arguments
    const storageSource = fs.readFileSync(path.join(__dirname, '../main/storage.js'), 'utf8');
    const ipcHandlerMatch = storageSource.includes("ipcMain.handle('open-notes-in-external-app', async () =>");
    assert.equal(ipcHandlerMatch, true, 'open-notes-in-external-app IPC handler must not accept arguments from renderer');

    // 4. Verify preload.js does not expose customPath parameter
    const preloadSource = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
    assert(preloadSource.includes("openNotesInExternalApp: () => ipcRenderer.invoke('open-notes-in-external-app')"), 'preload API must not take customPath');

    console.log('✓ IPC handler and preload bridge signature isolation verified');
} finally {
    try {
        fs.rmSync(testDir, { recursive: true, force: true });
    } catch (e) {}
}

console.log('All notes path containment security tests passed successfully!');
