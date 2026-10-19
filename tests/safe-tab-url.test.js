// tests/safe-tab-url.test.js
// Automated regression tests for tab URL safety and scheme validation

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
const { isSafeTabUrl } = security;

console.log('Running Mise safe tab URL regression tests...');

// 1. Verify valid http and https URLs pass validation
{
    const validUrls = [
        'https://example.com',
        'http://example.com/a?b=c#d',
        'HTTPS://EXAMPLE.COM',
        ' https://example.com',
        'http://localhost:3000/'
    ];

    validUrls.forEach(url => {
        assert.strictEqual(isSafeTabUrl(url), true, `URL should be considered safe: ${url}`);
    });
    console.log('✓ Valid http and https URLs verified');
}

// 2. Verify invalid schemes, malformed targets, and edge cases are rejected
{
    const longHttpsUrl = 'https://a.com/' + 'a'.repeat(20000);
    const invalidUrls = [
        'file:///etc/passwd',
        'javascript:alert(1)',
        'java\nscript:alert(1)',
        'java\tscript:alert(1)',
        'data:text/html,<b>x</b>',
        'blob:https://a.com/x',
        'about:blank',
        'chrome://gpu',
        'mailto:a@b.c',
        'ftp://example.com',
        '',
        null,
        undefined,
        123,
        longHttpsUrl
    ];

    invalidUrls.forEach(url => {
        assert.strictEqual(isSafeTabUrl(url), false, `URL or input should be rejected: ${url}`);
    });
    console.log('✓ Restricted schemes, invalid types, and length bounds verified');
}

console.log('All safe tab URL tests passed successfully!');
