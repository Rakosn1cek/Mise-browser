const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const storage = require('../main/storage');

console.log('Running Mise storage & local data regression tests...');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-storage-test-'));

try {
    // 1. Verify Bookmarks read and write
    {
        const testBookmarksPath = path.join(tmpDir, 'bookmarks.json');
        
        // Initial read on non-existent file should return empty array
        const initial = storage.readBookmarks(testBookmarksPath);
        assert(Array.isArray(initial), 'Initial bookmarks must be an array');
        assert.strictEqual(initial.length, 0, 'Initial bookmarks must be empty');
        assert(fs.existsSync(testBookmarksPath), 'File should be created on initial read');

        // Save bookmarks
        const sampleBookmarks = [
            { id: '1', title: 'GitHub', url: 'https://github.com' },
            { id: '2', title: 'DuckDuckGo', url: 'https://duckduckgo.com' }
        ];
        const saved = storage.saveBookmarks(sampleBookmarks, testBookmarksPath);
        assert.strictEqual(saved, true, 'saveBookmarks must return true on success');

        // Read saved bookmarks
        const reloaded = storage.readBookmarks(testBookmarksPath);
        assert.strictEqual(reloaded.length, 2, 'Must reload 2 bookmarks');
        assert.strictEqual(reloaded[0].title, 'GitHub', 'Bookmark title must match');
        console.log('✓ Bookmarks file I/O and schema initialisation verified');
    }

    // 2. Verify Quickmarks read and write
    {
        const testQuickmarksPath = path.join(tmpDir, 'quickmarks.json');

        // Initial read on non-existent file should return empty object
        const initial = storage.readQuickmarks(testQuickmarksPath);
        assert(typeof initial === 'object' && !Array.isArray(initial), 'Initial quickmarks must be an object');
        assert.strictEqual(Object.keys(initial).length, 0, 'Initial quickmarks must be empty');

        // Save quickmarks
        const sampleQuickmarks = {
            'g': 'https://github.com',
            'm': 'https://misebrowser.com'
        };
        const saved = storage.saveQuickmarks(sampleQuickmarks, testQuickmarksPath);
        assert.strictEqual(saved, true, 'saveQuickmarks must return true on success');

        // Read saved quickmarks
        const reloaded = storage.readQuickmarks(testQuickmarksPath);
        assert.strictEqual(reloaded['g'], 'https://github.com/'.replace(/\/$/, ''), 'Quickmark g must match');
        console.log('✓ Quickmarks file I/O and dictionary mapping verified');
    }

    // 3. Verify Notes read and write
    {
        const testNotesPath = path.join(tmpDir, 'notes.md');

        // Initial read on non-existent file should return empty string
        const initial = storage.readNotes(testNotesPath);
        assert.strictEqual(initial, '', 'Initial notes must be empty string');

        // Save notes content
        const markdownContent = '# Research Notes\n\n- Task 1: Complete testing\n- Task 2: Verify persistence';
        const saved = storage.saveNotes(markdownContent, testNotesPath);
        assert.strictEqual(saved, true, 'saveNotes must return true on success');

        // Read saved notes
        const reloaded = storage.readNotes(testNotesPath);
        assert.strictEqual(reloaded, markdownContent, 'Notes content must match verbatim');
        console.log('✓ Notes markdown storage and retrieval verified');
    }

    // 4. Verify History logging, URL filtering, and deduplication
    {
        const testHistoryPath = path.join(tmpDir, 'history.json');
        storage.setInMemoryHistory([]);

        // Internal URLs should be ignored
        storage.logVisit('Blank', 'about:blank', 500, testHistoryPath);
        storage.logVisit('Local File', 'file:///etc/hosts', 500, testHistoryPath);
        storage.logVisit('', '', 500, testHistoryPath);
        assert.strictEqual(storage.getHistoryCache(testHistoryPath).length, 0, 'Internal and blank URLs must not be logged');

        // Valid visits
        storage.logVisit('DuckDuckGo', 'https://duckduckgo.com', 500, testHistoryPath);
        assert.strictEqual(storage.getHistoryCache(testHistoryPath).length, 1, 'Valid visit must be logged');

        // Consecutive duplicate visit must be deduplicated
        storage.logVisit('DuckDuckGo Refresh', 'https://duckduckgo.com', 500, testHistoryPath);
        assert.strictEqual(storage.getHistoryCache(testHistoryPath).length, 1, 'Consecutive identical URL must be deduplicated');

        // Different visit
        storage.logVisit('GitHub', 'https://github.com', 500, testHistoryPath);
        const cache = storage.getHistoryCache(testHistoryPath);
        assert.strictEqual(cache.length, 2, 'New distinct URL must be logged');
        assert.strictEqual(cache[0].url, 'https://github.com', 'Most recent visit must be unshifted to index 0');

        // Maximum items boundary cap
        for (let i = 0; i < 15; i++) {
            storage.logVisit(`Page ${i}`, `https://example.com/page-${i}`, 10, testHistoryPath);
        }
        assert.strictEqual(storage.getHistoryCache(testHistoryPath).length, 10, 'History must respect maximum items boundary');
        console.log('✓ History visit logging, deduplication, and bounds capping verified');
    }

    // 5. Verify History search and queries
    {
        const testHistoryPath = path.join(tmpDir, 'history.json');
        
        // Empty query returns all items
        const allItems = storage.searchHistory('', testHistoryPath);
        assert.strictEqual(allItems.length, 10, 'Empty query must return all history items');

        // Substring matching by title
        const titleMatch = storage.searchHistory('page 7', testHistoryPath);
        assert.strictEqual(titleMatch.length, 1, 'Must find matching title');
        assert.strictEqual(titleMatch[0].title, 'Page 7', 'Found entry title must match');

        // Substring matching by url (case-insensitive)
        const urlMatch = storage.searchHistory('EXAMPLE.COM/PAGE-7', testHistoryPath);
        assert.strictEqual(urlMatch.length, 1, 'Must find matching URL regardless of case');
        console.log('✓ Case-insensitive history search filtering verified');
    }

    // 6. Verify History disk flushing and purge
    {
        const testHistoryPath = path.join(tmpDir, 'history.json');
        
        // Flush to disk
        storage.flushHistoryToDisk(testHistoryPath);
        assert(fs.existsSync(testHistoryPath), 'history.json must exist after flush');
        const onDisk = JSON.parse(fs.readFileSync(testHistoryPath, 'utf8'));
        assert.strictEqual(onDisk.length, 10, 'On-disk history count must match flushed cache');

        // Purge history
        const purged = storage.purgeHistory(testHistoryPath);
        assert.strictEqual(purged, true, 'purgeHistory must return true');
        assert.strictEqual(storage.getHistoryCache(testHistoryPath).length, 0, 'In-memory cache must be empty after purge');
        const onDiskAfterPurge = JSON.parse(fs.readFileSync(testHistoryPath, 'utf8'));
        assert.strictEqual(onDiskAfterPurge.length, 0, 'On-disk file must be empty array after purge');
        console.log('✓ History atomic disk flush and purge verified');
    }

    console.log('All storage & local data regression tests passed successfully!');
} finally {
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
}
