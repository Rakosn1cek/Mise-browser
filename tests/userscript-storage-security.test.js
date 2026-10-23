// tests/userscript-storage-security.test.js
// Verification for userscript storage prototype pollution prevention and null prototype isolation

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('Running Mise userscript storage prototype pollution security tests...');

// Mock minimal electron requirements if running in standalone Node
const Module = require('node:module');
const origRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'electron') {
        return {
            app: {
                getPath: () => path.join(__dirname, '..')
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
const { isValidStorageKey, sanitizeStorageObject, setScriptValue, loadScriptStorage } = userContent;

// 1. Verify isValidStorageKey validation logic
{
    // Valid keys
    assert.equal(isValidStorageKey('theme_mode'), true);
    assert.equal(isValidStorageKey('counter'), true);
    assert.equal(isValidStorageKey('123'), true);
    assert.equal(isValidStorageKey(456), true);

    // Forbidden prototype pollution keys
    assert.equal(isValidStorageKey('__proto__'), false);
    assert.equal(isValidStorageKey('constructor'), false);
    assert.equal(isValidStorageKey('prototype'), false);

    // Invalid types and bounds
    assert.equal(isValidStorageKey(''), false);
    assert.equal(isValidStorageKey(null), false);
    assert.equal(isValidStorageKey(undefined), false);
    assert.equal(isValidStorageKey({}), false);
    assert.equal(isValidStorageKey('a'.repeat(2000)), false);

    console.log('✓ isValidStorageKey rejects forbidden prototype keys and malformed types');
}

// 2. Verify setScriptValue rejects prototype pollution and protects Object.prototype
{
    const scriptId = 'test-security-script';

    // Attempting to set __proto__ must throw and must not pollute Object.prototype
    assert.throws(() => {
        setScriptValue(scriptId, '__proto__', { polluted: true });
    }, /Invalid or forbidden userscript storage key/);

    const testObject = {};
    assert.equal(testObject.polluted, undefined, 'Object.prototype must not be polluted by __proto__ key');

    // Attempting to overwrite constructor must throw
    assert.throws(() => {
        setScriptValue(scriptId, 'constructor', 'compromised');
    }, /Invalid or forbidden userscript storage key/);

    assert.equal(testObject.constructor, Object, 'Object.prototype.constructor must remain unpolluted');

    // Attempting to set prototype must throw
    assert.throws(() => {
        setScriptValue(scriptId, 'prototype', 'compromised');
    }, /Invalid or forbidden userscript storage key/);

    console.log('✓ setScriptValue prevents prototype pollution on Object.prototype');
}

// 3. Verify loadScriptStorage returns null-prototype dictionary
{
    const scriptId = 'test-clean-script';
    setScriptValue(scriptId, 'alpha', 'first');
    setScriptValue(scriptId, 'beta', 2);

    const store = loadScriptStorage(scriptId);
    assert.equal(Object.getPrototypeOf(store), null, 'Userscript store must possess a null prototype');
    assert.equal(store.alpha, 'first');
    assert.equal(store.beta, 2);

    console.log('✓ loadScriptStorage enforces Object.create(null) store isolation');
}

// 4. Verify sanitizeStorageObject strips rogue prototype keys from raw input
{
    const maliciousInput = JSON.parse('{"__proto__": {"hacked": true}, "constructor": "bad", "cleanKey": "safe"}');
    const cleaned = sanitizeStorageObject(maliciousInput);

    assert.equal(Object.getPrototypeOf(cleaned), null);
    assert.equal(cleaned.cleanKey, 'safe');
    assert.equal(cleaned.constructor, undefined);
    assert.equal(({}).hacked, undefined, 'Object.prototype must remain untouched');

    console.log('✓ sanitizeStorageObject strips forbidden keys from parsed payloads');
}

console.log('All userscript storage prototype pollution security tests passed successfully!\n');

// 5. Run storage quota, deferral, and recovery limits test suite
const { execFileSync } = require('child_process');
execFileSync(process.execPath, [path.join(__dirname, 'userscript-storage-limits.test.js')], { stdio: 'inherit' });
