// tests/userscript-token-lifecycle.test.js
// Verification for userscript bridge token lifecycle, sender binding, and shim hardening

const assert = require('assert');
const { EventEmitter } = require('events');
const userContent = require('../userContent.js');
const { buildUserScriptWrapper } = require('../modules/userScriptShim.js');

const {
    generateScriptToken,
    validateTokenSender,
    revokeTokensForSender,
    __test_activeTokens,
    __test_TOKEN_IDLE_MS,
    __test_MAX_TOKENS
} = userContent;

console.log('Running Mise userscript token lifecycle and bridge hardening tests...');

// 1. Idle expiry rejects and deletes; capacity cap evicts oldest entries
{
    __test_activeTokens.clear();

    const scriptId = 'test-idle';
    const token = generateScriptToken(scriptId, 'example.com', [], [], 'https://example.com');
    const tokenData = __test_activeTokens.get(token);
    assert(tokenData, 'Token must exist in activeTokens');

    const sender = { id: 1, getURL: () => 'https://example.com/start' };

    // Simulate idle timeout
    tokenData.lastUsedAt = Date.now() - (__test_TOKEN_IDLE_MS + 1000);

    assert.throws(() => {
        validateTokenSender(tokenData, { sender });
    }, /Unauthorized: Invalid or expired GM token/);

    assert.strictEqual(__test_activeTokens.has(token), false, 'Expired token must be deleted on access');

    // Capacity eviction down to 1500
    __test_activeTokens.clear();
    const tokenList = [];
    for (let i = 0; i < __test_MAX_TOKENS; i++) {
        const t = generateScriptToken(`test-${i}`, 'example.com', [], [], 'https://example.com');
        tokenList.push(t);
    }
    assert.strictEqual(__test_activeTokens.size, __test_MAX_TOKENS, 'Token map must reach MAX_TOKENS');

    // Generating one more token triggers eviction down to 1500
    const overflowToken = generateScriptToken('overflow-test', 'example.com', [], [], 'https://example.com');
    assert.strictEqual(__test_activeTokens.size, 1500, 'Token map size must drop to 1500 after exceeding cap');
    assert.strictEqual(__test_activeTokens.has(tokenList[0]), false, 'Oldest token must be evicted');
    assert.strictEqual(__test_activeTokens.has(overflowToken), true, 'Newest token must remain');

    console.log('✓ Token idle expiry and capacity cap eviction verified');
}

// 2. Origin checking rules
{
    __test_activeTokens.clear();

    // 2a. Exact web origin
    const tokenWeb = generateScriptToken('web-test', 'a.com', [], [], 'https://a.com');
    const dataWeb = __test_activeTokens.get(tokenWeb);

    // Permitted on exact origin
    validateTokenSender(dataWeb, { sender: { id: 10, getURL: () => 'https://a.com/x' } });

    // Subdomain rejected
    assert.throws(() => {
        validateTokenSender(dataWeb, { sender: { id: 10, getURL: () => 'https://sub.a.com/x' } });
    }, /Authorisation failure: Origin mismatch for GM token/);

    // Protocol mismatch rejected
    assert.throws(() => {
        validateTokenSender(dataWeb, { sender: { id: 10, getURL: () => 'http://a.com/x' } });
    }, /Authorisation failure: Origin mismatch for GM token/);

    // Port mismatch rejected
    assert.throws(() => {
        validateTokenSender(dataWeb, { sender: { id: 10, getURL: () => 'https://a.com:8443/x' } });
    }, /Authorisation failure: Origin mismatch for GM token/);

    // 2b. file: page origin
    const tokenFile = generateScriptToken('file-test', '', [], [], 'null');
    const dataFile = __test_activeTokens.get(tokenFile);

    validateTokenSender(dataFile, { sender: { id: 20, getURL: () => 'file:///home/user/test.html' } });

    assert.throws(() => {
        validateTokenSender(dataFile, { sender: { id: 20, getURL: () => 'https://example.com' } });
    }, /Authorisation failure: Origin mismatch for GM token/);

    // 2c. Backward compatibility when pageOrigin is undefined
    const tokenLegacy = generateScriptToken('legacy-test', 'a.com', [], []);
    const dataLegacy = __test_activeTokens.get(tokenLegacy);

    validateTokenSender(dataLegacy, { sender: { id: 30, getURL: () => 'https://a.com/x' } });
    validateTokenSender(dataLegacy, { sender: { id: 30, getURL: () => 'https://sub.a.com/x' } });

    assert.throws(() => {
        validateTokenSender(dataLegacy, { sender: { id: 30, getURL: () => 'https://other.com/x' } });
    }, /Authorisation failure: Origin mismatch for GM token/);

    console.log('✓ Strict origin verification, file protocol guard, and legacy fallback verified');
}

// 3. Sender binding and senderFrame verification
{
    __test_activeTokens.clear();

    const tokenBound = generateScriptToken('bind-test', 'a.com', [], [], 'https://a.com');
    const dataBound = __test_activeTokens.get(tokenBound);

    // Bind to sender 1 on first use
    validateTokenSender(dataBound, { sender: { id: 101, getURL: () => 'https://a.com/page' } });
    assert.strictEqual(dataBound.boundSenderId, 101, 'Token must bind to sender 1');

    // Reuse from sender 1 permitted
    validateTokenSender(dataBound, { sender: { id: 101, getURL: () => 'https://a.com/page' } });

    // Reuse from sender 2 rejected
    assert.throws(() => {
        validateTokenSender(dataBound, { sender: { id: 102, getURL: () => 'https://a.com/page' } });
    }, /Authorisation failure: token bound to another webContents/);

    // Frame validation checks
    const mainFrame = { frameId: 'main-frame' };
    const childFrame = { frameId: 'child-iframe' };

    const tokenFrame = generateScriptToken('frame-test', 'a.com', [], [], 'https://a.com');
    const dataFrame = __test_activeTokens.get(tokenFrame);
    const hostSender = { id: 201, mainFrame, getURL: () => 'https://a.com/page' };

    // Null senderFrame rejected when mainFrame exists
    assert.throws(() => {
        validateTokenSender(dataFrame, { sender: hostSender, senderFrame: null });
    }, /Authorisation failure: Sender frame mismatch/);

    // Undefined senderFrame rejected when mainFrame exists
    assert.throws(() => {
        validateTokenSender(dataFrame, { sender: hostSender, senderFrame: undefined });
    }, /Authorisation failure: Sender frame mismatch/);

    // Child iframe rejected
    assert.throws(() => {
        validateTokenSender(dataFrame, { sender: hostSender, senderFrame: childFrame });
    }, /Authorisation failure: Sender frame mismatch/);

    // Main frame permitted
    validateTokenSender(dataFrame, { sender: hostSender, senderFrame: mainFrame });

    console.log('✓ First sender binding and main frame enforcement verified');
}

// 4. Navigation event revocation lifecycle
{
    __test_activeTokens.clear();

    class FakeWebContents extends EventEmitter {
        constructor(id, url) {
            super();
            this.id = id;
            this.url = url;
        }
        getURL() {
            return this.url;
        }
    }

    const sender = new FakeWebContents(301, 'https://example.com/app');

    const token1 = generateScriptToken('nav-test-1', 'example.com', [], [], 'https://example.com');
    const data1 = __test_activeTokens.get(token1);

    const token2 = generateScriptToken('nav-test-2', 'example.com', [], [], 'https://example.com');
    const data2 = __test_activeTokens.get(token2);

    // Bind token 1 to sender; leave token 2 unbound
    validateTokenSender(data1, { sender });
    assert.strictEqual(data1.boundSenderId, 301);
    assert.strictEqual(data2.boundSenderId, null);

    // In-page navigation does not revoke bound tokens
    sender.emit('did-navigate-in-page', {}, 'https://example.com/app#route');
    assert.strictEqual(__test_activeTokens.has(token1), true, 'did-navigate-in-page must not revoke tokens');

    // Full navigation revokes bound tokens but leaves unbound tokens untouched
    sender.emit('did-navigate', {}, 'https://example.com/new-page');
    assert.strictEqual(__test_activeTokens.has(token1), false, 'did-navigate must revoke bound tokens');
    assert.strictEqual(__test_activeTokens.has(token2), true, 'did-navigate must not affect unbound tokens');

    // Token minted after navigation works with sender
    const token3 = generateScriptToken('nav-test-3', 'example.com', [], [], 'https://example.com');
    const data3 = __test_activeTokens.get(token3);
    validateTokenSender(data3, { sender });
    assert.strictEqual(data3.boundSenderId, 301);

    // Destroy event revokes remaining bound tokens
    sender.emit('destroyed');
    assert.strictEqual(__test_activeTokens.has(token3), false, 'destroyed must revoke bound tokens');

    console.log('✓ Token revocation on did-navigate and destroyed verified');
}

// 5. Shim one-time capture verification
{
    const item = {
        name: 'Shim Security Script',
        scriptId: 'shim-sec-1',
        code: 'console.log("running");'
    };

    const output = buildUserScriptWrapper(item, '1.2.0');

    assert(output.includes('var __gm_bridge = window.__miseGMBridge;'), 'Wrapper must capture window.__miseGMBridge once');
    assert(output.includes('var __gm_request = __gm_bridge && __gm_bridge.request;'), 'Wrapper must capture request once');
    assert(output.includes('var __gm_setStorageValue = __gm_bridge && __gm_bridge.setStorageValue;'), 'Wrapper must capture setStorageValue once');
    assert(output.includes('var __gm_deleteStorageValue = __gm_bridge && __gm_bridge.deleteStorageValue;'), 'Wrapper must capture deleteStorageValue once');

    // Verify bridge methods are invoked via .call(__gm_bridge, ...)
    assert(output.includes('__gm_setStorageValue.call(__gm_bridge,'), 'setStorageValue must use .call');
    assert(output.includes('__gm_deleteStorageValue.call(__gm_bridge,'), 'deleteStorageValue must use .call');
    assert(output.includes('__gm_request.call(__gm_bridge,'), 'request must use .call');

    // Verify no direct lookup outside the initial variable declarations
    assert(!output.includes('window.__miseGMBridge.request('), 'No dynamic window lookup for request');
    assert(!output.includes('window.__miseGMBridge.setStorageValue('), 'No dynamic window lookup for setStorageValue');
    assert(!output.includes('window.__miseGMBridge.deleteStorageValue('), 'No dynamic window lookup for deleteStorageValue');

    console.log('✓ Userscript wrapper one-time bridge capture verified');
}

console.log('All userscript token lifecycle and bridge hardening tests passed successfully!\n');
