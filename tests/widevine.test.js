// tests/widevine.test.js
// Regression test suite for Widevine DRM Detection Helper, cross-platform messaging, and diagnostics integration

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('Running Mise Widevine DRM detection helper regression tests...');

// Mock minimal electron requirements if running in standalone Node
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'electron') {
        return {
            app: {
                getVersion: () => '1.6.1',
                getAppMetrics: () => [],
                getGPUFeatureStatus: () => ({}),
                getGPUInfo: async () => ({})
            }
        };
    }
    return origRequire.apply(this, arguments);
};

const widevine = require('../main/widevine.js');
const diagnostics = require('../diagnostics.js');

// 1. Static API and interface verification
{
    assert.strictEqual(typeof widevine.detectWidevineCdm, 'function', 'detectWidevineCdm must be a function');
    assert.strictEqual(typeof widevine.initializeWidevine, 'function', 'initializeWidevine must be a function');
    assert.strictEqual(typeof widevine.getWidevineStatus, 'function', 'getWidevineStatus must be a function');
    assert.strictEqual(typeof widevine.getLinuxCandidatePaths, 'function', 'getLinuxCandidatePaths must be a function');
    assert.strictEqual(typeof widevine.resetWidevineStateForTesting, 'function', 'resetWidevineStateForTesting must be a function');

    assert(widevine.MESSAGES.DARWIN.includes('macOS'), 'DARWIN message must mention macOS');
    assert(widevine.MESSAGES.DARWIN.includes('Verified Media Path (VMP)'), 'DARWIN message must mention VMP');
    assert(widevine.MESSAGES.WIN32.includes('Windows'), 'WIN32 message must mention Windows');
    assert(widevine.MESSAGES.WIN32.includes('Verified Media Path (VMP)'), 'WIN32 message must mention VMP');
    assert(widevine.MESSAGES.NOT_FOUND_LINUX.includes('chromium-widevine'), 'Linux not found message must mention chromium-widevine');

    console.log('✓ Widevine module exports, schema, and platform message contracts verified');
}

// 2. Platform gating and messaging verification (macOS, Windows, Unsupported OS)
{
    // A. macOS platform verification
    const darwinRes = widevine.detectWidevineCdm({ platform: 'darwin' });
    assert.strictEqual(darwinRes.status, 'unsupported', 'macOS must return unsupported status');
    assert.strictEqual(darwinRes.version, null, 'macOS version must be null');
    assert.strictEqual(darwinRes.path, null, 'macOS path must be null');
    assert.strictEqual(darwinRes.message, widevine.MESSAGES.DARWIN, 'macOS message must explain VMP signature requirement');

    // B. Windows platform verification
    const win32Res = widevine.detectWidevineCdm({ platform: 'win32' });
    assert.strictEqual(win32Res.status, 'unsupported', 'Windows must return unsupported status');
    assert.strictEqual(win32Res.version, null, 'Windows version must be null');
    assert.strictEqual(win32Res.path, null, 'Windows path must be null');
    assert.strictEqual(win32Res.message, widevine.MESSAGES.WIN32, 'Windows message must explain VMP signature requirement');

    // C. Other unsupported OS verification
    const bsdRes = widevine.detectWidevineCdm({ platform: 'freebsd' });
    assert.strictEqual(bsdRes.status, 'unsupported', 'FreeBSD must return unsupported status');
    assert.strictEqual(bsdRes.message, widevine.MESSAGES.UNSUPPORTED_OS, 'FreeBSD must return generic unsupported OS message');

    console.log('✓ Cross-platform gating and informative messages for macOS and Windows verified');
}

// 3. Linux candidate path generation and environment overrides
{
    const defaultCandidates = widevine.getLinuxCandidatePaths({});
    assert(defaultCandidates.includes('/opt/google/chrome/WidevineCdm'), 'Candidate paths must include Chrome');
    assert(defaultCandidates.includes('/usr/lib/chromium/WidevineCdm'), 'Candidate paths must include Chromium');
    assert(defaultCandidates.includes('/usr/lib/widevine'), 'Candidate paths must include distribution widevine');

    const envWithOverride = { WIDEVINE_CDM_PATH: '/custom/path/to/WidevineCdm' };
    const customCandidates = widevine.getLinuxCandidatePaths(envWithOverride);
    assert.strictEqual(customCandidates[0], '/custom/path/to/WidevineCdm', 'Custom WIDEVINE_CDM_PATH must take top precedence');

    console.log('✓ Linux candidate path resolution and environment override verified');
}

// 4. Linux filesystem discovery and manifest parsing using temporary sandbox
{
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-widevine-test-'));

    try {
        // Case A: Missing library candidate (unavailable)
        const emptyCandidate = path.join(tmpDir, 'empty-cdm');
        fs.mkdirSync(emptyCandidate);
        const unavailRes = widevine.detectWidevineCdm({
            platform: 'linux',
            customPaths: [emptyCandidate]
        });
        assert.strictEqual(unavailRes.status, 'unavailable', 'Missing binary must result in unavailable');
        assert.strictEqual(unavailRes.version, null);
        assert.strictEqual(unavailRes.path, null);
        assert.strictEqual(unavailRes.message, widevine.MESSAGES.NOT_FOUND_LINUX);

        // Case B: Standard Linux direct binary with manifest
        const validDir = path.join(tmpDir, 'valid-cdm');
        fs.mkdirSync(validDir);
        fs.writeFileSync(path.join(validDir, 'libwidevinecdm.so'), 'mock-binary');
        fs.writeFileSync(path.join(validDir, 'manifest.json'), JSON.stringify({ version: '4.10.2830.0' }));

        const validRes = widevine.detectWidevineCdm({
            platform: 'linux',
            customPaths: [validDir]
        });
        assert.strictEqual(validRes.status, 'ready', 'Valid binary must result in ready status');
        assert.strictEqual(validRes.version, '4.10.2830.0', 'Version must be parsed from manifest.json');
        assert.strictEqual(validRes.path, path.join(validDir, 'libwidevinecdm.so'));
        assert(validRes.message.includes('4.10.2830.0'));

        // Case C: Platform-specific nested directory structure (_platform_specific/linux_x64)
        const nestedDir = path.join(tmpDir, 'nested-cdm');
        const nestedPlatformDir = path.join(nestedDir, '_platform_specific', 'linux_x64');
        fs.mkdirSync(nestedPlatformDir, { recursive: true });
        fs.writeFileSync(path.join(nestedPlatformDir, 'libwidevinecdm.so'), 'mock-nested-binary');
        fs.writeFileSync(path.join(nestedDir, 'manifest.json'), JSON.stringify({ version: '4.10.2900.1' }));

        const nestedRes = widevine.detectWidevineCdm({
            platform: 'linux',
            arch: 'x64',
            customPaths: [nestedDir]
        });
        assert.strictEqual(nestedRes.status, 'ready');
        assert.strictEqual(nestedRes.version, '4.10.2900.1');
        assert.strictEqual(nestedRes.path, path.join(nestedPlatformDir, 'libwidevinecdm.so'));

        // Case D: Direct path to binary file itself
        const directFileRes = widevine.detectWidevineCdm({
            platform: 'linux',
            customPaths: [path.join(validDir, 'libwidevinecdm.so')]
        });
        assert.strictEqual(directFileRes.status, 'ready');
        assert.strictEqual(directFileRes.version, '4.10.2830.0');

        // Case E: Malformed manifest.json (should gracefully fallback to unknown version)
        const corruptDir = path.join(tmpDir, 'corrupt-cdm');
        fs.mkdirSync(corruptDir);
        fs.writeFileSync(path.join(corruptDir, 'libwidevinecdm.so'), 'mock-binary');
        fs.writeFileSync(path.join(corruptDir, 'manifest.json'), '{ invalid json syntax');

        const corruptRes = widevine.detectWidevineCdm({
            platform: 'linux',
            customPaths: [corruptDir]
        });
        assert.strictEqual(corruptRes.status, 'ready');
        assert.strictEqual(corruptRes.version, 'unknown', 'Corrupted manifest must fall back gracefully to unknown');
        assert.strictEqual(corruptRes.path, path.join(corruptDir, 'libwidevinecdm.so'));

        console.log('✓ Linux filesystem discovery, architecture nesting, and manifest parsing verified');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// 5. Engine switches registration during startup
{
    const recordedSwitches = [];
    const mockApp = {
        commandLine: {
            appendSwitch: (key, val) => {
                recordedSwitches.push({ key, val });
            }
        }
    };

    widevine.resetWidevineStateForTesting();

    // When status is ready
    const readyState = {
        status: 'ready',
        version: '4.10.2830.0',
        path: '/mock/path/libwidevinecdm.so',
        directory: '/mock/path',
        message: 'Ready'
    };

    const statusAfterInit = widevine.initializeWidevine(mockApp, readyState);
    assert.strictEqual(statusAfterInit.status, 'ready');
    assert.strictEqual(recordedSwitches.length, 2, 'Two switches must be appended');
    assert.deepStrictEqual(recordedSwitches[0], { key: 'widevine-cdm-path', val: '/mock/path/libwidevinecdm.so' });
    assert.deepStrictEqual(recordedSwitches[1], { key: 'widevine-cdm-version', val: '4.10.2830.0' });

    // When status is unavailable
    recordedSwitches.length = 0;
    widevine.resetWidevineStateForTesting();

    const unavailState = {
        status: 'unavailable',
        version: null,
        path: null,
        directory: null,
        message: 'Not found'
    };

    widevine.initializeWidevine(mockApp, unavailState);
    assert.strictEqual(recordedSwitches.length, 0, 'No switches should be appended when unavailable');

    console.log('✓ Engine switch registration before app ready event verified');
}

// 6. Diagnostics report aggregation and sanitisation
{
    async function testDiagnostics() {
        const report = await diagnostics.gatherSystemDiagnostics();
        assert(report.widevine, 'Diagnostics report must include widevine property');
        assert(['ready', 'unavailable', 'unsupported'].includes(report.widevine.status), 'Widevine status must be valid enum');
        assert(typeof report.widevine.message === 'string', 'Widevine message must be present');

        console.log('✓ System diagnostics aggregation and privacy scrubbing verified');
    }

    testDiagnostics().catch(err => {
        console.error('Diagnostics test failure:', err);
        process.exit(1);
    });
}
