// tests/history-url-filter.test.js
// Regression tests for history URL validation and visit logging

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const storage = require('../main/storage');

console.log('Running Mise history URL filtering and logging tests...');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-history-test-'));
const tempHistoryPath = path.join(tmpDir, 'history.json');

try {
    // 1. Verify isRecordableHistoryUrl returns true for valid URLs
    {
        const validUrls = [
            'https://a.com/x',
            'http://a.com'
        ];
        for (const url of validUrls) {
            assert.strictEqual(
                storage.isRecordableHistoryUrl(url),
                true,
                `Expected ${url} to be recordable`
            );
        }
        console.log('✓ Valid http and https URLs pass isRecordableHistoryUrl');
    }

    // 2. Verify isRecordableHistoryUrl returns false for invalid schemes, types, or oversized URLs
    {
        const invalidUrls = [
            'file:///x',
            'about:blank',
            'data:text/html,x',
            'blob:https://a.com/x',
            'javascript:alert(1)',
            '',
            null,
            123,
            'https://a.com/' + 'a'.repeat(5000)
        ];
        for (const url of invalidUrls) {
            assert.strictEqual(
                storage.isRecordableHistoryUrl(url),
                false,
                `Expected ${url} to be rejected by isRecordableHistoryUrl`
            );
        }
        console.log('✓ Restricted protocols, invalid types, and oversized strings rejected');
    }

    // 3. Verify logVisit recording behaviour with temp history path
    {
        storage.setInMemoryHistory([]);

        // logVisit with data: URL, file: URL, and 5000-char URL leaves history unchanged
        storage.logVisit('Data Page', 'data:text/html,x', 500, tempHistoryPath);
        storage.logVisit('Local File', 'file:///x', 500, tempHistoryPath);
        storage.logVisit('Oversized URL', 'https://a.com/' + 'a'.repeat(5000), 500, tempHistoryPath);

        assert.strictEqual(
            storage.getHistoryCache(tempHistoryPath).length,
            0,
            'History should remain empty after attempting to log unrecordable URLs'
        );

        // A normal https URL is recorded
        storage.logVisit('Example Site', 'https://a.com/x', 500, tempHistoryPath);
        assert.strictEqual(
            storage.getHistoryCache(tempHistoryPath).length,
            1,
            'Normal https URL must be recorded in history'
        );
        assert.strictEqual(
            storage.getHistoryCache(tempHistoryPath)[0].url,
            'https://a.com/x',
            'Recorded entry URL must match'
        );

        // The same URL twice in a row is recorded once
        storage.logVisit('Example Site Again', 'https://a.com/x', 500, tempHistoryPath);
        assert.strictEqual(
            storage.getHistoryCache(tempHistoryPath).length,
            1,
            'Duplicate consecutive URL visit must be recorded only once'
        );

        console.log('✓ logVisit URL filtering and consecutive deduplication verified');
    }

    console.log('All history URL filtering and logging tests passed successfully!');
} finally {
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
}
