// tests/atomic-file.test.js
// Regression tests for atomic file writes, backup rotation, and safe JSON reading

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { atomicWriteFileSync, backupCorruptFile, readJsonFileOrBackup } = require('../main/atomicFile');

console.log('Running Mise atomic file & corrupt backup regression tests...');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-atomic-file-test-'));

try {
    // 1. Verify atomicWriteFileSync content, tmp cleanup, and permissions
    {
        const targetPath = path.join(tmpDir, 'atomic-target.json');
        const content = JSON.stringify({ key: 'test-value' }, null, 4);

        atomicWriteFileSync(targetPath, content);

        assert(fs.existsSync(targetPath), 'Target file must exist after atomic write');
        assert.strictEqual(fs.readFileSync(targetPath, 'utf8'), content, 'File content must match written payload');

        const tmpFiles = fs.readdirSync(tmpDir).filter((name) => name.endsWith('.tmp'));
        assert.strictEqual(tmpFiles.length, 0, 'No temporary files should remain after successful write');

        if (process.platform !== 'win32') {
            const stats = fs.statSync(targetPath);
            const permissions = stats.mode & 0o777;
            assert.strictEqual(permissions, 0o600, `File permissions must be 0o600 on POSIX, got 0o${permissions.toString(8)}`);
        }

        console.log('✓ atomicWriteFileSync payload, tmp cleanup, and permissions verified');
    }

    // 2. Verify atomicWriteFileSync failure behaviour and target preservation
    {
        const blockedDir = path.join(tmpDir, 'blocked-parent-file');
        fs.writeFileSync(blockedDir, 'blocking-file-content', 'utf8');

        const impossiblePath = path.join(blockedDir, 'nested', 'target.json');
        let threwError = false;

        try {
            atomicWriteFileSync(impossiblePath, 'should-fail');
        } catch (_) {
            threwError = true;
        }

        assert.strictEqual(threwError, true, 'atomicWriteFileSync must rethrow when parent path cannot be created');
        assert.strictEqual(fs.readFileSync(blockedDir, 'utf8'), 'blocking-file-content', 'Existing file must remain untouched');

        const tmpFiles = fs.readdirSync(tmpDir).filter((name) => name.endsWith('.tmp'));
        assert.strictEqual(tmpFiles.length, 0, 'No temporary files should remain after failed write');

        console.log('✓ atomicWriteFileSync error handling and target preservation verified');
    }

    // 3. Verify backupCorruptFile pruning: 5 corrupt versions retain only 3 newest backups
    {
        const corruptPath = path.join(tmpDir, 'sample-corrupt.json');
        const baseName = path.basename(corruptPath);
        const corruptPrefix = `${baseName}.corrupt-`;

        for (let i = 1; i <= 5; i++) {
            // Write distinct content and set distinct mtime
            fs.writeFileSync(corruptPath, `broken-version-${i}`, 'utf8');
            const newMtime = new Date(Date.now() + i * 2000);
            fs.utimesSync(corruptPath, newMtime, newMtime);

            const backupResult = backupCorruptFile(corruptPath, 3);
            assert(backupResult !== null, `Backup ${i} must succeed`);
        }

        const remainingBackups = fs.readdirSync(tmpDir).filter((name) => name.startsWith(corruptPrefix));
        assert.strictEqual(remainingBackups.length, 3, 'Exactly 3 newest backups must be kept when maxKeep is 3');

        // Confirm retained backups correspond to the latest versions
        const retainedContents = remainingBackups
            .map((name) => fs.readFileSync(path.join(tmpDir, name), 'utf8'))
            .sort();

        assert(retainedContents.includes('broken-version-3'), 'Retained backups must include version 3');
        assert(retainedContents.includes('broken-version-4'), 'Retained backups must include version 4');
        assert(retainedContents.includes('broken-version-5'), 'Retained backups must include version 5');
        assert(!retainedContents.includes('broken-version-1'), 'Oldest version 1 must have been pruned');
        assert(!retainedContents.includes('broken-version-2'), 'Oldest version 2 must have been pruned');

        console.log('✓ backupCorruptFile rotation and maxKeep limit verified');
    }

    // 4. Verify readJsonFileOrBackup behaviour across missing, corrupt, invalid, and valid states
    {
        const testFile = path.join(tmpDir, 'read-test.json');

        // Missing file returns fallback without backup
        const missingResult = readJsonFileOrBackup(testFile, Array.isArray, () => ['fallback']);
        assert.deepStrictEqual(missingResult, ['fallback'], 'Missing file must return fallback');
        const missingBackups = fs.readdirSync(tmpDir).filter((name) => name.includes('read-test.json.corrupt'));
        assert.strictEqual(missingBackups.length, 0, 'Missing file must not generate corrupt backup');

        // Corrupt JSON generates backup and returns fallback
        fs.writeFileSync(testFile, '{corrupted-json', 'utf8');
        const corruptResult = readJsonFileOrBackup(testFile, Array.isArray, () => []);
        assert.deepStrictEqual(corruptResult, [], 'Corrupt JSON must return fallback');
        const corruptBackups = fs.readdirSync(tmpDir).filter((name) => name.includes('read-test.json.corrupt'));
        assert.strictEqual(corruptBackups.length, 1, 'Corrupt file must trigger backup');

        // Second read on unchanged corrupt file creates no additional backup
        const repeatResult = readJsonFileOrBackup(testFile, Array.isArray, () => []);
        assert.deepStrictEqual(repeatResult, [], 'Repeat read must return fallback');
        const repeatBackups = fs.readdirSync(tmpDir).filter((name) => name.includes('read-test.json.corrupt'));
        assert.strictEqual(repeatBackups.length, 1, 'Repeat read on unchanged corrupt file must not duplicate backup');

        // Valid JSON that fails validator generates backup and returns fallback
        fs.writeFileSync(testFile, JSON.stringify({ unexpected: 'object' }), 'utf8');
        const invalidTypeResult = readJsonFileOrBackup(testFile, Array.isArray, () => []);
        assert.deepStrictEqual(invalidTypeResult, [], 'Type mismatch must return fallback');
        const invalidTypeBackups = fs.readdirSync(tmpDir).filter((name) => name.includes('read-test.json.corrupt'));
        assert.strictEqual(invalidTypeBackups.length, 2, 'Validator mismatch must trigger backup');

        // Valid JSON passing validator returns parsed object without backup
        const validPayload = ['valid', 'array', 'data'];
        fs.writeFileSync(testFile, JSON.stringify(validPayload), 'utf8');
        const validResult = readJsonFileOrBackup(testFile, Array.isArray, () => []);
        assert.deepStrictEqual(validResult, validPayload, 'Valid payload must return parsed data');
        const afterValidBackups = fs.readdirSync(tmpDir).filter((name) => name.includes('read-test.json.corrupt'));
        assert.strictEqual(afterValidBackups.length, 2, 'Valid payload must not create new backups');

        console.log('✓ readJsonFileOrBackup missing, corrupt, validation, and parsing verified');
    }

    console.log('All atomic file & corrupt backup regression tests passed successfully!');
} finally {
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
}
