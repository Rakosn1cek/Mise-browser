// tests/second-instance-urls.test.js
// Verification for second-instance command line URL safety validation

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const security = require('../security.js');

console.log('Running Mise second-instance URL safety regression tests...');

// 1. Verify main.js guards second-instance incoming URLs with isSafeTabUrl
{
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

    const secondInstanceIndex = mainSource.indexOf("app.on('second-instance'");
    assert(secondInstanceIndex !== -1, 'main.js must register second-instance event listener');

    const openUrlIndex = mainSource.indexOf("app.on('open-url'", secondInstanceIndex);
    const secondInstanceSlice = mainSource.slice(secondInstanceIndex, openUrlIndex !== -1 ? openUrlIndex : secondInstanceIndex + 800);

    assert(
        secondInstanceSlice.includes('security.isSafeTabUrl(url)'),
        'second-instance handler must verify incoming URLs with security.isSafeTabUrl'
    );
    assert(
        secondInstanceSlice.includes('dispatchTabUrl(url)'),
        'second-instance handler must dispatch safe URLs'
    );

    console.log('✓ main.js second-instance URL validation listener registration verified');
}

// 2. Functional verification of URL filtering logic in second-instance dispatch
{
    function simulateSecondInstanceDispatch(commandLineArgs) {
        const dispatched = [];

        // Simulate url extraction and filtering logic
        for (const arg of commandLineArgs) {
            if (security.isSafeTabUrl(arg)) {
                dispatched.push(arg);
            }
        }

        return dispatched;
    }

    const testInputs = [
        'https://example.org/docs',
        'http://localhost:3000/dashboard',
        'file:///etc/passwd',
        'file:///home/user/.bashrc',
        'javascript:alert(1)',
        'data:text/html,exploit',
        'chrome://settings',
        '',
        null,
        undefined
    ];

    const results = simulateSecondInstanceDispatch(testInputs);

    // Assert that only safe web URLs are allowed
    assert.deepEqual(
        results,
        ['https://example.org/docs', 'http://localhost:3000/dashboard'],
        'Only valid http and https URLs must be dispatched from second-instance invocations'
    );

    console.log('✓ Second-instance safe web URL filtering logic verified');
    console.log('All second-instance URL safety regression tests passed successfully!');
}
