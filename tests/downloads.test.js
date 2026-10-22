const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
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
assert(typeof downloads.isDangerousExtension === 'function', 'Must export isDangerousExtension');
assert(typeof downloads.getTrackedRealpaths === 'function', 'Must export getTrackedRealpaths');
assert(downloads.trackedRealpaths instanceof Set, 'trackedRealpaths must be a Set instance');
assert(downloads.activeDownloads instanceof Map, 'activeDownloads must be a Map instance');
assert(Array.isArray(downloads.recentDownloads), 'recentDownloads must be an Array instance');
console.log('✓ Module exports and state structures verified');

// Test 5: isDangerousExtension classification and case insensitivity
const dangerousExtensions = [
    '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.ps1', '.vbs',
    '.js', '.jse', '.wsf', '.lnk', '.jar', '.sh', '.run', '.appimage',
    '.desktop', '.command', '.app', '.dmg', '.pkg', '.deb', '.rpm'
];

for (const ext of dangerousExtensions) {
    assert.strictEqual(downloads.isDangerousExtension(`sample${ext}`), true, `Extension ${ext} must be identified as dangerous`);
    assert.strictEqual(downloads.isDangerousExtension(`sample${ext.toUpperCase()}`), true, `Uppercase extension ${ext.toUpperCase()} must be identified as dangerous`);
}

assert.strictEqual(downloads.isDangerousExtension('bundle.AppImage'), true, 'Mixed case .AppImage must be dangerous');
assert.strictEqual(downloads.isDangerousExtension('script.SH'), true, 'Uppercase .SH must be dangerous');
assert.strictEqual(downloads.isDangerousExtension('program.EXE'), true, 'Uppercase .EXE must be dangerous');

assert.strictEqual(downloads.isDangerousExtension('document.pdf'), false, '.pdf must not be dangerous');
assert.strictEqual(downloads.isDangerousExtension('document.PDF'), false, '.PDF must not be dangerous');
assert.strictEqual(downloads.isDangerousExtension('notes.txt'), false, '.txt must not be dangerous');
assert.strictEqual(downloads.isDangerousExtension('image.png'), false, '.png must not be dangerous');
assert.strictEqual(downloads.isDangerousExtension('archive.tar.gz'), false, '.gz must not be dangerous');
assert.strictEqual(downloads.isDangerousExtension(''), false, 'Empty string must not be dangerous');
assert.strictEqual(downloads.isDangerousExtension(null), false, 'Null must not be dangerous');
assert.strictEqual(downloads.isDangerousExtension(undefined), false, 'Undefined must not be dangerous');
console.log('✓ Dangerous extension classification and case insensitivity verified');

// Test 6: Asynchronous IPC handlers, path tracking, and file manager delegation
(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-downloads-test-'));
    try {
        const openedPaths = [];
        const revealedPaths = [];

        const mockShell = {
            openPath: async (p) => {
                openedPaths.push(p);
                return '';
            },
            showItemInFolder: (p) => {
                revealedPaths.push(p);
            }
        };

        const ipcHandlers = {};
        const mockIpcMain = {
            handle: (channel, handler) => {
                ipcHandlers[channel] = handler;
            }
        };

        downloads.registerDownloadIpc(mockIpcMain, {
            shell: mockShell,
            onReveal: (p) => {
                revealedPaths.push(p);
            }
        });

        const openHandler = ipcHandlers['open-download'];
        const revealHandler = ipcHandlers['reveal-download'];
        assert(typeof openHandler === 'function', 'open-download handler must be registered');
        assert(typeof revealHandler === 'function', 'reveal-download handler must be registered');

        // Subtest A: Untracked path rejected
        const untrackedFile = path.join(tmpDir, 'untracked.pdf');
        fs.writeFileSync(untrackedFile, 'untracked content', 'utf8');

        const untrackedOpenResult = await openHandler(null, untrackedFile);
        assert.strictEqual(untrackedOpenResult, false, 'Untracked path must be rejected by open-download');
        assert.strictEqual(openedPaths.length, 0, 'No shell openPath calls permitted for untracked paths');

        const untrackedRevealResult = await revealHandler(null, untrackedFile);
        assert.strictEqual(untrackedRevealResult, false, 'Untracked path must be rejected by reveal-download');
        assert.strictEqual(revealedPaths.length, 0, 'No reveal calls permitted for untracked paths');
        console.log('✓ Untracked path rejection verified');

        // Subtest B: Tracked safe path accepted
        const trackedSafeFile = path.join(tmpDir, 'tracked-document.pdf');
        fs.writeFileSync(trackedSafeFile, 'safe pdf content', 'utf8');
        const trackedSafeRealpath = fs.realpathSync(trackedSafeFile);

        downloads.recentDownloads.push({
            id: 'dl-test-safe',
            filename: 'tracked-document.pdf',
            savePath: trackedSafeFile
        });

        const safeOpenResult = await openHandler(null, trackedSafeFile);
        assert.strictEqual(safeOpenResult, true, 'Tracked safe path must be opened successfully');
        assert(openedPaths.includes(trackedSafeRealpath), 'shell.openPath must be called with tracked path');

        const safeRevealResult = await revealHandler(null, trackedSafeFile);
        assert.strictEqual(safeRevealResult, true, 'Tracked safe path must be revealed successfully');
        assert(revealedPaths.includes(trackedSafeRealpath), 'reveal must be called with tracked path');
        console.log('✓ Tracked path acceptance verified');

        // Subtest C: Dangerous files (.exe, .sh, .AppImage) divert open-download to file manager reveal
        const exeFile = path.join(tmpDir, 'installer.exe');
        fs.writeFileSync(exeFile, 'binary exe data', 'utf8');
        const exeRealpath = fs.realpathSync(exeFile);
        downloads.recentDownloads.push({
            id: 'dl-test-exe',
            filename: 'installer.exe',
            savePath: exeFile
        });

        const shFile = path.join(tmpDir, 'script.sh');
        fs.writeFileSync(shFile, '#!/bin/sh\necho hi', 'utf8');
        const shRealpath = fs.realpathSync(shFile);
        downloads.activeDownloads.set('dl-test-sh', {
            id: 'dl-test-sh',
            filename: 'script.sh',
            savePath: shFile
        });

        const appImageFile = path.join(tmpDir, 'application.AppImage');
        fs.writeFileSync(appImageFile, 'ELF binary appimage', 'utf8');
        const appImageRealpath = fs.realpathSync(appImageFile);
        downloads.recentDownloads.push({
            id: 'dl-test-appimage',
            filename: 'application.AppImage',
            savePath: appImageFile
        });

        // Test .exe diversion
        const openedCountBefore = openedPaths.length;
        const exeOpenResult = await openHandler(null, exeFile);
        assert.strictEqual(exeOpenResult, true, 'open-download on .exe must return true via reveal');
        assert.strictEqual(openedPaths.length, openedCountBefore, 'openPath must NOT be called for .exe files');
        assert(revealedPaths.includes(exeRealpath), 'revealInFileManager must be called for .exe files');

        // Test .sh diversion
        const shOpenResult = await openHandler(null, shFile);
        assert.strictEqual(shOpenResult, true, 'open-download on .sh must return true via reveal');
        assert.strictEqual(openedPaths.length, openedCountBefore, 'openPath must NOT be called for .sh files');
        assert(revealedPaths.includes(shRealpath), 'revealInFileManager must be called for .sh files');

        // Test .AppImage diversion
        const appImageOpenResult = await openHandler(null, appImageFile);
        assert.strictEqual(appImageOpenResult, true, 'open-download on .AppImage must return true via reveal');
        assert.strictEqual(openedPaths.length, openedCountBefore, 'openPath must NOT be called for .AppImage files');
        assert(revealedPaths.includes(appImageRealpath), 'revealInFileManager must be called for .AppImage files');
        console.log('✓ Dangerous extensions (.exe, .sh, .AppImage) reveal diversion verified');

        // Subtest D: Case-insensitive dangerous extension diversion in open-download
        const upperExeFile = path.join(tmpDir, 'SETUP.EXE');
        fs.writeFileSync(upperExeFile, 'binary data', 'utf8');
        const upperExeRealpath = fs.realpathSync(upperExeFile);
        downloads.recentDownloads.push({
            id: 'dl-test-upper-exe',
            filename: 'SETUP.EXE',
            savePath: upperExeFile
        });

        const upperOpenResult = await openHandler(null, upperExeFile);
        assert.strictEqual(upperOpenResult, true, 'open-download on SETUP.EXE must return true via reveal');
        assert.strictEqual(openedPaths.length, openedCountBefore, 'openPath must NOT be called for uppercase SETUP.EXE');
        assert(revealedPaths.includes(upperExeRealpath), 'revealInFileManager must be called for uppercase SETUP.EXE');
        console.log('✓ Case-insensitive dangerous extension handling verified in IPC handlers');

    } finally {
        downloads.activeDownloads.clear();
        downloads.recentDownloads.length = 0;
        downloads.getTrackedRealpaths();
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (e) {}
    }

    console.log('All downloads & file manager integration tests passed successfully!\n');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
