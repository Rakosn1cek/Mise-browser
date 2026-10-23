// tests/userscript-storage-limits.test.js
// Verification for userscript storage quotas, deferred writes, corrupt recovery, and file permissions

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('Running Mise userscript storage limits, deferral, and recovery tests...');

// Mock minimal electron requirements if running in standalone Node
const Module = require('node:module');
const origRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'electron') {
        return {
            app: {
                getPath: () => path.join(__dirname, '..'),
                on: () => {}
            },
            ipcMain: {
                handle: () => {},
                on: () => {}
            }
        };
    }
    return origRequire.apply(this, arguments);
};

const userContent = require('../userContent.js');
const {
    setScriptValue,
    deleteScriptValue,
    loadScriptStorage,
    flushScriptStorage,
    __test_setStorageDir,
    __test_getStorageDir,
    __test_storageCache,
    __test_storageDebounceTimers
} = userContent;

// Prepare temporary directory for testing via test seam without initializeUserContent
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-storage-limit-test-'));
const originalStorageDir = __test_getStorageDir();
__test_setStorageDir(tempDir);

function cleanTempDir() {
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
    __test_setStorageDir(originalStorageDir);
}

process.on('exit', cleanTempDir);

async function runTests() {
    // 1. Oversize value rejection (> 1048576 chars)
    {
        const scriptId = 'limit-test-oversize';
        const oversizeVal = 'x'.repeat(1048577);
        assert.throws(() => {
            setScriptValue(scriptId, 'bigKey', oversizeVal);
        }, /Storage quota exceeded/);

        const store = loadScriptStorage(scriptId);
        assert.equal(store.bigKey, undefined, 'Oversize key must not be present in store');
        console.log('✓ Oversize value rejected and store remains clean');
    }

    // 2. 1001st key limit on new keys
    {
        const scriptId = 'limit-test-key-count';
        for (let i = 0; i < 1000; i++) {
            setScriptValue(scriptId, `k_${i}`, i);
        }

        // Updating an existing key at 1000 keys must succeed
        setScriptValue(scriptId, 'k_0', 9999);
        assert.equal(loadScriptStorage(scriptId).k_0, 9999);

        // Adding 1001st key must throw Storage quota exceeded
        assert.throws(() => {
            setScriptValue(scriptId, 'k_1000', 1000);
        }, /Storage quota exceeded/);

        const store = loadScriptStorage(scriptId);
        assert.equal(Object.keys(store).length, 1000, 'Store must cap at exactly 1000 keys');
        assert.equal(store.k_1000, undefined, '1001st key must not be stored');
        console.log('✓ 1000 key limit enforced on new keys while updates succeed');
    }

    // 3. Total store size limit (> 5 MB) with assignment reversion
    {
        const scriptId = 'limit-test-store-size';
        // Add 5 large values of 1,000,000 chars each (~5 MB total, 5 * 1024 * 1024 = 5242880)
        for (let i = 1; i <= 5; i++) {
            setScriptValue(scriptId, `chunk_${i}`, 'a'.repeat(1000000));
        }

        setScriptValue(scriptId, 'canary', 'initial_value');
        const storeBefore = loadScriptStorage(scriptId);
        const keysBefore = Object.keys(storeBefore).length;

        // Pushing total serialized store beyond 5 MB (5242880 chars) on an existing key
        assert.throws(() => {
            setScriptValue(scriptId, 'canary', 'b'.repeat(300000));
        }, /Storage quota exceeded/);

        const storeAfterUpdate = loadScriptStorage(scriptId);
        assert.equal(storeAfterUpdate.canary, 'initial_value', 'Store must revert assignment on quota breach');

        // Pushing total serialized store beyond 5 MB on a new key
        assert.throws(() => {
            setScriptValue(scriptId, 'new_chunk', 'c'.repeat(300000));
        }, /Storage quota exceeded/);

        const storeAfterNewKey = loadScriptStorage(scriptId);
        assert.equal(Object.keys(storeAfterNewKey).length, keysBefore, 'Key count must be unchanged after quota breach');
        assert.equal(storeAfterNewKey.new_chunk, undefined, 'New key must be deleted on quota breach');
        console.log('✓ Total store serialized > 5 MB quota enforced with assignment reversion');
    }

    // 4. Non-serialisable values (BigInt, function, undefined, cycles)
    {
        const scriptId = 'limit-test-types';
        assert.throws(() => setScriptValue(scriptId, 'k_bigint', 42n), /Unsupported storage value/);
        assert.throws(() => setScriptValue(scriptId, 'k_func', () => {}), /Unsupported storage value/);
        assert.throws(() => setScriptValue(scriptId, 'k_undef', undefined), /Unsupported storage value/);

        const cyclic = {};
        cyclic.self = cyclic;
        assert.throws(() => setScriptValue(scriptId, 'k_cycle', cyclic), /Unsupported storage value/);

        assert.throws(() => setScriptValue(scriptId, 'k_nested_bigint', { nested: 100n }), /Unsupported storage value/);
        console.log('✓ BigInt, function, undefined, and cyclic values throw Unsupported storage value');
    }

    // 5. Corrupt JSON file copied to .corrupt-* and not overwritten by subsequent write
    {
        const scriptId = 'limit-test-corrupt';
        const filePath = path.join(tempDir, `${scriptId}.json`);
        const corruptPayload = '{"broken": json... invalid content';
        fs.writeFileSync(filePath, corruptPayload, 'utf8');

        __test_storageCache.delete(scriptId);

        const loaded = loadScriptStorage(scriptId);
        assert.equal(Object.getPrototypeOf(loaded), null, 'Fallback must be null prototype');
        assert.equal(Object.keys(loaded).length, 0, 'Fallback store must be empty');

        const files = fs.readdirSync(tempDir);
        const corruptBackups = files.filter(f => f.startsWith(`${scriptId}.json.corrupt-`));
        assert.equal(corruptBackups.length, 1, 'Corrupt file must be copied aside');

        const backupContent = fs.readFileSync(path.join(tempDir, corruptBackups[0]), 'utf8');
        assert.equal(backupContent, corruptPayload, 'Corrupt backup must retain original payload');

        // Subsequent valid write must not overwrite the backup
        setScriptValue(scriptId, 'restoredKey', 'safe');
        const backupContentAfter = fs.readFileSync(path.join(tempDir, corruptBackups[0]), 'utf8');
        assert.equal(backupContentAfter, corruptPayload, 'Corrupt backup file must remain preserved');

        const newMainContent = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assert.equal(newMainContent.restoredKey, 'safe', 'Main file must hold the new valid data');
        console.log('✓ Corrupt file copied aside with timestamp and preserved on next write');
    }

    // 6. File mode 0o600 on POSIX systems
    {
        if (process.platform !== 'win32') {
            const scriptId = 'limit-test-perms';
            setScriptValue(scriptId, 'permKey', 'permValue');
            const filePath = path.join(tempDir, `${scriptId}.json`);
            const stat = fs.statSync(filePath);
            const mode = stat.mode & 0o777;
            assert.equal(mode, 0o600, `Storage file mode must be 0o600 on POSIX, got 0o${mode.toString(8)}`);
            console.log('✓ File mode 0o600 verified on POSIX');
        }
    }

    // 7. Three rapid deferred sets produce one write and flushScriptStorage() writes immediately
    {
        const scriptId = 'limit-test-deferred';
        const filePath = path.join(tempDir, `${scriptId}.json`);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        __test_storageCache.delete(scriptId);

        let writesCount = 0;
        const atomicFile = require('../main/atomicFile');
        const originalAtomicWrite = atomicFile.atomicWriteFileSync;
        atomicFile.atomicWriteFileSync = function(targetPath, data, options) {
            if (targetPath === filePath) {
                writesCount++;
            }
            return originalAtomicWrite.apply(this, arguments);
        };

        try {
            setScriptValue(scriptId, 'a', 1, { defer: true });
            setScriptValue(scriptId, 'b', 2, { defer: true });
            setScriptValue(scriptId, 'c', 3, { defer: true });

            assert.equal(writesCount, 0, 'No synchronous writes must occur when defer is true');
            assert.equal(fs.existsSync(filePath), false, 'Disk file must not exist before debounce or flush');

            flushScriptStorage();

            assert.equal(writesCount, 1, 'Exactly one write must occur upon flushScriptStorage');
            assert.equal(fs.existsSync(filePath), true, 'Disk file must exist after flush');

            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            assert.deepEqual(content, { a: 1, b: 2, c: 3 }, 'Disk content must reflect coalesced changes');

            // Wait 600 ms to confirm timer does not fire a second time
            await new Promise((resolve) => setTimeout(resolve, 600));
            assert.equal(writesCount, 1, 'No additional writes must occur after debounce timer expiration');
        } finally {
            atomicFile.atomicWriteFileSync = originalAtomicWrite;
        }
        console.log('✓ Rapid deferred sets coalesced into single write and flushScriptStorage writes immediately');
    }

    // 8. Default call writes immediately
    {
        const scriptId = 'limit-test-immediate';
        const filePath = path.join(tempDir, `${scriptId}.json`);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        __test_storageCache.delete(scriptId);

        setScriptValue(scriptId, 'immKey', 'immVal');
        assert.equal(fs.existsSync(filePath), true, 'Default setScriptValue must write to disk immediately');

        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assert.equal(content.immKey, 'immVal');

        deleteScriptValue(scriptId, 'immKey');
        const contentAfterDelete = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assert.equal(contentAfterDelete.immKey, undefined, 'Default deleteScriptValue must write to disk immediately');
        console.log('✓ Default calls without defer write immediately');
    }

    console.log('All userscript storage limits, deferral, and recovery tests passed successfully!');
}

runTests().catch((err) => {
    console.error('Test failure:', err);
    process.exit(1);
});
