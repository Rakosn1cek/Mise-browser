// tests/trusted-domains.test.js
// Automated regression tests for trusted domains normalisation and permission scoping

const assert = require('assert');
const path = require('path');

// Mock minimal electron requirements if running in standalone Node
const Module = require('module');
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

const security = require('../security.js');
const {
    isTrustedDomain,
    isPermissionTrustedRequest,
    normalizeTrustedDomains,
    setTrustedDomains
} = security;

console.log('Running Mise trusted domains regression tests...');

// 1. Verify isTrustedDomain with built-in Google infra and UGC exclusions
{
    setTrustedDomains([]);

    const trueDomains = [
        'accounts.google.com',
        'www.google.com',
        'ssl.gstatic.com',
        'www.youtube.com',
        'www.recaptcha.net',
        'gvt1.com'
    ];

    for (const host of trueDomains) {
        assert.strictEqual(
            isTrustedDomain(host),
            true,
            `Expected ${host} to be trusted`
        );
    }

    const falseDomains = [
        'sites.google.com',
        'a.sites.google.com',
        'storage.googleapis.com',
        'evil.googleusercontent.com',
        'script.googleusercontent.com',
        'notgoogle.com',
        'google.com.evil.com',
        'example.com',
        '',
        null
    ];

    for (const host of falseDomains) {
        assert.strictEqual(
            isTrustedDomain(host),
            false,
            `Expected ${host} not to be trusted`
        );
    }

    // Adding to user trusted domains must allow the domain
    setTrustedDomains(['sites.google.com']);
    assert.strictEqual(
        isTrustedDomain('sites.google.com'),
        true,
        'Expected sites.google.com to be trusted after explicit user addition'
    );

    console.log('✓ isTrustedDomain infrastructure and UGC exclusion verified');
}

// 2. Verify isPermissionTrustedRequest with frame hierarchy and user trust scoping
{
    setTrustedDomains(['bank.com']);

    // Main frame requests
    assert.strictEqual(
        isPermissionTrustedRequest({
            requestingUrl: 'https://bank.com/x',
            topLevelUrl: 'https://bank.com/x',
            isMainFrame: true
        }),
        true,
        'Main frame on bank.com/x must be trusted'
    );

    assert.strictEqual(
        isPermissionTrustedRequest({
            requestingUrl: 'https://www.bank.com',
            topLevelUrl: 'https://www.bank.com',
            isMainFrame: true
        }),
        true,
        'Main frame on www.bank.com subdomain must be trusted'
    );

    // Google infrastructure must not receive automatic permission trust
    assert.strictEqual(
        isPermissionTrustedRequest({
            requestingUrl: 'https://accounts.google.com',
            topLevelUrl: 'https://accounts.google.com',
            isMainFrame: true
        }),
        false,
        'accounts.google.com must not be permission trusted'
    );

    assert.strictEqual(
        isPermissionTrustedRequest({
            requestingUrl: 'https://www.youtube.com',
            topLevelUrl: 'https://www.youtube.com',
            isMainFrame: true
        }),
        false,
        'youtube.com must not be permission trusted'
    );

    // Iframe scenarios
    assert.strictEqual(
        isPermissionTrustedRequest({
            requestingUrl: 'https://evil.com',
            topLevelUrl: 'https://bank.com',
            isMainFrame: false
        }),
        false,
        'Untrusted iframe on trusted top-level page must be denied'
    );

    assert.strictEqual(
        isPermissionTrustedRequest({
            requestingUrl: 'https://bank.com',
            topLevelUrl: 'https://evil.com',
            isMainFrame: false
        }),
        false,
        'Trusted iframe on untrusted top-level page must be denied'
    );

    assert.strictEqual(
        isPermissionTrustedRequest({
            requestingUrl: 'https://bank.com',
            topLevelUrl: 'https://bank.com',
            isMainFrame: false
        }),
        true,
        'Trusted iframe on trusted top-level page must be allowed'
    );

    // Invalid URLs, empty strings, and undefined arguments
    assert.strictEqual(isPermissionTrustedRequest(), false, 'Undefined args must return false');
    assert.strictEqual(isPermissionTrustedRequest(undefined), false, 'Explicit undefined must return false');
    assert.strictEqual(isPermissionTrustedRequest({}), false, 'Empty options must return false');
    assert.strictEqual(
        isPermissionTrustedRequest({ requestingUrl: '', topLevelUrl: '' }),
        false,
        'Empty URLs must return false'
    );
    assert.strictEqual(
        isPermissionTrustedRequest({ requestingUrl: 'invalid-url', topLevelUrl: 'https://bank.com' }),
        false,
        'Invalid requestingUrl must fail closed'
    );
    assert.strictEqual(
        isPermissionTrustedRequest({ requestingUrl: 'https://bank.com', topLevelUrl: 'invalid-url' }),
        false,
        'Invalid topLevelUrl must fail closed'
    );

    console.log('✓ isPermissionTrustedRequest frame hierarchy and fail-closed logic verified');
}

// 3. Verify normalizeTrustedDomains filtering and public suffix rejection
{
    const rawList = [
        'Bank.COM ',
        'bank.com.',
        'com',
        'co.uk',
        'github.io',
        '*.x.com',
        'a b.com',
        'x.com/path',
        '',
        null,
        'example.com$important',
        'xn--80ak6aa92e.com',
        'localhost',
        123
    ];

    const normalised = normalizeTrustedDomains(rawList);
    assert.deepStrictEqual(
        normalised,
        ['bank.com', 'xn--80ak6aa92e.com'],
        'normalised list must contain only valid deduplicated non-public-suffix entries'
    );

    console.log('✓ normalizeTrustedDomains validation, blocklist, and deduplication verified');
}

console.log('All trusted domains regression tests passed successfully!');
