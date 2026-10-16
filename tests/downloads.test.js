const assert = require('assert');
const path = require('path');
const downloads = require('../main/downloads');

console.log('Running Mise downloads & file manager integration tests...');

// Test 1: Desktop search directories format
const dirs = downloads.getDesktopSearchDirectories();
assert(Array.isArray(dirs), 'Desktop search directories must return an array');
assert(dirs.length > 0, 'Must have at least one desktop search directory');
assert(dirs.some(d => d.includes('applications')), 'Search paths must contain applications directories');
console.log('✓ Desktop search directories format verified');

// Test 2: parseDesktopExec with various field codes
const targetFile = '/home/user/Downloads/test-document.pdf';

// With %f
const execWithSmallF = downloads.parseDesktopExec('evince %f', targetFile);
assert.deepStrictEqual(execWithSmallF, ['evince', targetFile], 'Must substitute %f with file path');

// With %U
const execWithBigU = downloads.parseDesktopExec('xdg-open %U', targetFile);
assert.deepStrictEqual(execWithBigU, ['xdg-open', targetFile], 'Must substitute %U with file path');

// With quoted arguments and field codes
const execWithQuotes = downloads.parseDesktopExec('"flatpak" run org.gnome.Evince %F', targetFile);
assert.deepStrictEqual(execWithQuotes, ['flatpak', 'run', 'org.gnome.Evince', targetFile], 'Must preserve tokens and substitute %F');

// Without field codes (regular application)
const execNoCodes = downloads.parseDesktopExec('code', targetFile);
assert.deepStrictEqual(execNoCodes, ['code', targetFile], 'Must append target path if no field code present');

// Nautilus / Dolphin special file selection argument
const execNautilus = downloads.parseDesktopExec('nautilus', targetFile);
assert.strictEqual(execNautilus[0], 'nautilus');
assert(execNautilus.includes(targetFile), 'Nautilus execution must include target path');
assert(execNautilus.some(arg => arg.includes('select')), 'Nautilus execution must pass select argument');
console.log('✓ Desktop execution line parsing and field code substitution verified');

// Test 3: getDisplayName resolution
assert.strictEqual(downloads.getDisplayName('/tmp/downloads/sample.zip', 'fallback.zip'), 'sample.zip', 'Must extract basename when savePath exists');
assert.strictEqual(downloads.getDisplayName('', 'fallback.zip'), 'fallback.zip', 'Must use fallback when savePath is empty');
assert.strictEqual(downloads.getDisplayName(null, 'fallback.zip'), 'fallback.zip', 'Must use fallback when savePath is null');
assert.strictEqual(downloads.getDisplayName(null, null), 'download', 'Must use default when both are missing');
console.log('✓ Download display name resolution verified');

// Test 4: Module export contract
assert(typeof downloads.configureDownloads === 'function', 'Must export configureDownloads');
assert(typeof downloads.registerDownloadIpc === 'function', 'Must export registerDownloadIpc');
assert(typeof downloads.revealInFileManager === 'function', 'Must export revealInFileManager');
assert(downloads.activeDownloads instanceof Map, 'activeDownloads must be a Map instance');
assert(Array.isArray(downloads.recentDownloads), 'recentDownloads must be an Array instance');
console.log('✓ Module exports and state structures verified');

console.log('All downloads & file manager integration tests passed successfully!\n');
