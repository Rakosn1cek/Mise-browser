// tests/sleep-snapshot.test.js
// Regression and security verification for tab sleep session snapshots

const assert = require('node:assert/strict');
const { originOf, sanitizeSnapshot, attachSnapshot, snapshotForRestore } = require('../modules/sleepSnapshot.js');

console.log('Running Mise sleep snapshot and origin isolation regression tests...');

// 1. Verify originOf extraction and protocol filtering
{
    assert.equal(originOf('https://a.com/x'), 'https://a.com', 'https origin should be extracted');
    assert.equal(originOf('http://a.com:8080/'), 'http://a.com:8080', 'http origin with port should be extracted');
    assert.equal(originOf('file:///x'), null, 'file scheme must return null');
    assert.equal(originOf('about:blank'), null, 'about scheme must return null');
    assert.equal(originOf('data:text/html,x'), null, 'data scheme must return null');
    assert.equal(originOf('garbage'), null, 'malformed URL string must return null');
    assert.equal(originOf(null), null, 'null input must return null');
    assert.equal(originOf(undefined), null, 'undefined input must return null');
    assert.equal(originOf(123), null, 'non-string input must return null');
    console.log('✓ originOf valid URLs and restricted schemes verified');
}

// 2. Verify sanitizeSnapshot validation and structural constraints
{
    assert.equal(sanitizeSnapshot('{"a":"b"}'), '{"a":"b"}', 'valid single key-value JSON string must pass');
    assert.equal(sanitizeSnapshot('[]'), null, 'array JSON must return null');
    assert.equal(sanitizeSnapshot('null'), null, 'null JSON literal must return null');
    assert.equal(sanitizeSnapshot('{"a":1}'), null, 'non-string value must return null');
    assert.equal(sanitizeSnapshot('{"a":{"b":"c"}}'), null, 'nested object must return null');
    assert.equal(sanitizeSnapshot(''), null, 'empty string must return null');
    assert.equal(sanitizeSnapshot(123), null, 'non-string input must return null');

    // Bounds checking: maxChars length limit
    const longString = '{"a":"' + 'x'.repeat(100) + '"}';
    assert.equal(sanitizeSnapshot(longString, 50), null, 'payload exceeding maxChars must return null');

    // Bounds checking: maximum 500 keys
    const obj501 = {};
    for (let i = 0; i < 501; i++) {
        obj501['k' + i] = 'val';
    }
    assert.equal(sanitizeSnapshot(JSON.stringify(obj501)), null, 'payload with over 500 keys must return null');

    const obj500 = {};
    for (let i = 0; i < 500; i++) {
        obj500['k' + i] = 'val';
    }
    assert.notEqual(sanitizeSnapshot(JSON.stringify(obj500)), null, 'payload with 500 keys should pass');
    console.log('✓ sanitizeSnapshot schema enforcement and boundary caps verified');
}

// 3. Verify attachSnapshot non-enumerable property and serialization hygiene
{
    const record = {
        url: 'https://a.com/dashboard',
        title: 'Dashboard',
        scrollX: 120,
        scrollY: 450
    };
    const canary = '{"canary":"secret123"}';
    attachSnapshot(record, 'https://a.com', canary);

    // Serialization checks
    const serialized = JSON.stringify(record);
    assert.equal(serialized.includes('secret123'), false, 'JSON.stringify must not include snapshot secrets');
    assert.equal(serialized.includes('sessionSnapshot'), false, 'JSON.stringify must not include sessionSnapshot key');

    // Enumerable keys and cloning checks
    const ownKeys = Object.keys(record);
    assert.equal(ownKeys.includes('sessionSnapshot'), false, 'sessionSnapshot must not be enumerable');

    const cloned = structuredClone(record);
    assert.equal('sessionSnapshot' in cloned, false, 'structuredClone must not copy non-enumerable sessionSnapshot');
    assert.equal(cloned.sessionSnapshot, undefined, 'cloned sessionSnapshot must be undefined');

    // In-memory data accessibility
    assert.equal(record.sessionSnapshot.data, canary, 'snapshot data must remain readable in memory');
    assert.equal(record.sessionSnapshot.origin, 'https://a.com', 'snapshot origin must match');

    // Invalid input safety checks
    assert.equal(attachSnapshot(null, 'https://a.com', canary), null, 'null record must return null');
    assert.equal(attachSnapshot({}, '', canary).sessionSnapshot, undefined, 'empty origin must be ignored');
    assert.equal(attachSnapshot({}, 'https://a.com', '').sessionSnapshot, undefined, 'empty data must be ignored');
    console.log('✓ attachSnapshot non-enumerable definition and isolation verified');
}

// 4. Verify snapshotForRestore cross-origin protection
{
    const record = {};
    const testData = '{"auth":"token-xyz"}';
    attachSnapshot(record, 'https://a.com', testData);

    // Same origin
    assert.equal(snapshotForRestore(record, 'https://a.com/profile'), testData, 'same origin request must return data');
    assert.equal(snapshotForRestore(record, 'https://a.com:443/'), testData, 'default port match must return data');

    // Different host
    assert.equal(snapshotForRestore(record, 'https://b.com/profile'), null, 'different host must be rejected');

    // Different port
    assert.equal(snapshotForRestore(record, 'https://a.com:8443/'), null, 'different port must be rejected');

    // Scheme mismatch (http vs https)
    assert.equal(snapshotForRestore(record, 'http://a.com/profile'), null, 'http vs https mismatch must be rejected');

    // Redirect to another domain
    assert.equal(snapshotForRestore(record, 'https://evil.com/landing'), null, 'redirect to another domain must be rejected');

    // about:blank
    assert.equal(snapshotForRestore(record, 'about:blank'), null, 'about:blank must be rejected');

    // Record without snapshot
    assert.equal(snapshotForRestore({}, 'https://a.com/profile'), null, 'record without snapshot must return null');
    assert.equal(snapshotForRestore(null, 'https://a.com/profile'), null, 'null record must return null');
    console.log('✓ snapshotForRestore origin matching and redirect rejection verified');
}

console.log('All sleep snapshot and origin isolation tests passed successfully!');
