const assert = require('assert');
const updater = require('../main/updater');

console.log('Running Mise updater and semantic versioning regression tests...');

// 1. Semantic version comparison tests
{
    // Newer patch
    assert.strictEqual(updater.isNewerVersion('1.0.1', '1.0.0'), true, 'Patch bump must be newer');
    // Newer minor
    assert.strictEqual(updater.isNewerVersion('1.1.0', '1.0.9'), true, 'Minor bump must be newer');
    // Newer major
    assert.strictEqual(updater.isNewerVersion('2.0.0', '1.99.99'), true, 'Major bump must be newer');
    // Same version
    assert.strictEqual(updater.isNewerVersion('1.0.0', '1.0.0'), false, 'Identical versions must return false');
    // Older version
    assert.strictEqual(updater.isNewerVersion('0.9.9', '1.0.0'), false, 'Older version must return false');
    // Leading "v" stripping
    assert.strictEqual(updater.isNewerVersion('v1.0.1', '1.0.0'), true, 'Leading v in latest must be stripped');
    assert.strictEqual(updater.isNewerVersion('1.0.1', 'v1.0.0'), true, 'Leading v in current must be stripped');
    assert.strictEqual(updater.isNewerVersion('v1.0.0', 'v1.0.0'), false, 'Identical versions with v must return false');
    // Uneven version lengths
    assert.strictEqual(updater.isNewerVersion('1.0.0.1', '1.0.0'), true, 'Subpatch must be recognized as newer');
    assert.strictEqual(updater.isNewerVersion('1.0', '1.0.0'), false, 'Shorter equivalent version must not be newer');
    // Fallback on missing or invalid input
    assert.strictEqual(updater.isNewerVersion('', '1.0.0'), false, 'Empty string must return false');
    assert.strictEqual(updater.isNewerVersion(null, '1.0.0'), false, 'Null latest must return false');

    console.log('✓ Semantic version parsing and boundary comparisons verified');
}

// 2. getAppVersion payload structure
{
    const mockApp = { getVersion: () => '2.1.0' };
    const versionPayload = updater.getAppVersion(mockApp);

    assert.strictEqual(versionPayload.version, '2.1.0', 'Must return mock app version');
    assert('electron' in versionPayload, 'Must include electron runtime version key');
    assert('chrome' in versionPayload, 'Must include chrome engine version key');
    assert('node' in versionPayload, 'Must include node environment version key');

    console.log('✓ Runtime version payload schema verified');
}

// 3. checkAppUpdates with simulated GitHub release responses
(async () => {
    const mockApp = { getVersion: () => '1.0.0' };

    // Case A: Update is available
    const mockFetchNewer = async () => ({
        tag_name: 'v1.1.0',
        name: 'Mise Browser v1.1.0',
        html_url: 'https://github.com/Rakosn1cek/Mise-browser/releases/tag/v1.1.0',
        published_at: '2026-10-17T09:00:00Z',
        body: 'Release notes for 1.1.0'
    });

    const resultNewer = await updater.checkAppUpdates(true, {
        app: mockApp,
        fetchLatestRelease: mockFetchNewer
    });
    assert.strictEqual(resultNewer.updateAvailable, true, 'Must detect available update');
    assert.strictEqual(resultNewer.latestVersion, 'v1.1.0', 'Latest version tag must match');
    assert.strictEqual(resultNewer.currentVersion, '1.0.0', 'Current version must match mock');
    assert.strictEqual(resultNewer.manual, true, 'Manual flag must be preserved');

    // Case B: Already on latest version
    const mockFetchSame = async () => ({
        tag_name: 'v1.0.0',
        name: 'Mise Browser v1.0.0',
        html_url: 'https://github.com/Rakosn1cek/Mise-browser/releases/tag/v1.0.0'
    });

    const resultSame = await updater.checkAppUpdates(false, {
        app: mockApp,
        fetchLatestRelease: mockFetchSame
    });
    assert.strictEqual(resultSame.updateAvailable, false, 'Must report no update when already on latest');
    assert.strictEqual(resultSame.manual, false, 'Manual flag must reflect automated check');

    // Case C: Upstream error / network timeout
    const mockFetchError = async () => {
        throw new Error('Connection refused');
    };

    const resultError = await updater.checkAppUpdates(true, {
        app: mockApp,
        fetchLatestRelease: mockFetchError
    });
    assert.strictEqual(resultError.updateAvailable, false, 'Must report false on network error');
    assert.strictEqual(resultError.error, 'Connection refused', 'Must expose error message');

    console.log('✓ Update checks for newer release, identical release, and network error verified');
    console.log('All updater regression tests passed successfully!');
})();
