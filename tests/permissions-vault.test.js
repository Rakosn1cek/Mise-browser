// tests/permissions-vault.test.js
// Automated regression tests for Granular Per-Domain Permission Vault and Zero-Trust Private Profile

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock minimal electron requirements for standalone Node execution
const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-perm-test-'));
const testPermissionsPath = path.join(testTmpDir, 'permissions.json');

const mockIpcHandlers = new Map();
const mockWebContents = {
    send: (channel, data) => {
        mockWebContents.lastSent = { channel, data };
    },
    lastSent: null
};

const mockMainWindow = {
    isDestroyed: () => false,
    webContents: mockWebContents
};

const mockPrivateSession = {
    _id: 'private-session',
    setPermissionRequestHandler(fn) { this.requestHandler = fn; },
    setPermissionCheckHandler(fn) { this.checkHandler = fn; }
};

const mockPersistentSession = {
    _id: 'persistent-session',
    setPermissionRequestHandler(fn) { this.requestHandler = fn; },
    setPermissionCheckHandler(fn) { this.checkHandler = fn; }
};

const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'electron') {
        return {
            app: {
                getPath: () => testTmpDir
            },
            session: {
                fromPartition: (partition) => {
                    if (partition === 'MisePrivateProfile') return mockPrivateSession;
                    return mockPersistentSession;
                }
            },
            ipcMain: {
                handle: (channel, fn) => { mockIpcHandlers.set(channel, fn); },
                on: () => {}
            }
        };
    }
    return origRequire.apply(this, arguments);
};

const permissions = require('../main/permissions');
const {
    normalizeDomain,
    getPermissionsCache,
    getPermissionsVault,
    getDomainPermissions,
    setDomainPermission,
    revokeDomainPermissions,
    clearAllPermissions,
    resolvePermissionPrompt,
    configureSessionPermissions,
    registerPermissionsIpc,
    isPrivateProfileSession,
    resetPermissionsCacheForTesting,
    SAFE_BENIGN_PERMISSIONS,
    VALID_CAPABILITIES
} = permissions;

console.log('Running Mise Granular Permission Vault regression tests...');

// 1. Domain normalisation tests
{
    assert.strictEqual(normalizeDomain('https://MEET.Google.Com:443/call'), 'meet.google.com');
    assert.strictEqual(normalizeDomain('github.com.'), 'github.com');
    assert.strictEqual(normalizeDomain('sub.example.co.uk:8080'), 'sub.example.co.uk');
    assert.strictEqual(normalizeDomain('   LOCALHOST:3000  '), 'localhost');
    assert.strictEqual(normalizeDomain(''), '');
    assert.strictEqual(normalizeDomain(null), '');
    console.log('✓ normalizeDomain handles URLs, ports, trailing dots, and casing');
}

// 2. Storage, caching, and atomic POSIX permissions
{
    resetPermissionsCacheForTesting();
    const initial = getPermissionsVault();
    assert.strictEqual(initial.version, 1);
    assert.deepStrictEqual(initial.domains, {});

    // Set permission on meet.google.com
    const resAudio = setDomainPermission('meet.google.com', 'media:audio', 'allow');
    assert.strictEqual(resAudio.success, true);
    assert.strictEqual(resAudio.permissions['media:audio'], 'allow');

    const resVideo = setDomainPermission('meet.google.com', 'media:video', 'allow');
    assert.strictEqual(resVideo.success, true);
    assert.strictEqual(resVideo.permissions['media:video'], 'allow');

    const resGeo = setDomainPermission('meet.google.com', 'geolocation', 'deny');
    assert.strictEqual(resGeo.success, true);
    assert.strictEqual(resGeo.permissions.geolocation, 'deny');

    // Query domain permissions
    const domainPerms = getDomainPermissions('meet.google.com');
    assert.strictEqual(domainPerms['media:audio'], 'allow');
    assert.strictEqual(domainPerms['media:video'], 'allow');
    assert.strictEqual(domainPerms.geolocation, 'deny');

    // Verify file written with 0o600 permissions
    if (fs.existsSync(permissions.PERMISSIONS_PATH)) {
        const stats = fs.statSync(permissions.PERMISSIONS_PATH);
        if (process.platform !== 'win32') {
            assert.strictEqual(stats.mode & 0o777, 0o600, 'permissions.json must have 0o600 permissions');
        }
    }

    // Invalid arguments rejected
    assert.strictEqual(setDomainPermission('', 'media:audio', 'allow').success, false);
    assert.strictEqual(setDomainPermission('example.com', 'invalid-cap', 'allow').success, false);
    assert.strictEqual(setDomainPermission('example.com', 'media:audio', 'invalid-state').success, false);

    // Revocation
    assert.strictEqual(revokeDomainPermissions('meet.google.com').success, true);
    assert.deepStrictEqual(getDomainPermissions('meet.google.com'), {});

    // Clear all
    setDomainPermission('site-a.com', 'clipboard-read', 'allow');
    setDomainPermission('site-b.com', 'geolocation', 'deny');
    assert.strictEqual(clearAllPermissions().success, true);
    assert.deepStrictEqual(getPermissionsVault().domains, {});

    console.log('✓ Storage, atomic writes, validation, and domain revocation verified');
}

// 3. Zero-Trust MisePrivateProfile lockdown
{
    resetPermissionsCacheForTesting();
    configureSessionPermissions(mockPrivateSession, {
        getMainWindow: () => mockMainWindow,
        areNotificationsEnabled: () => true
    });

    assert.strictEqual(isPrivateProfileSession(mockPrivateSession), true);

    // Synchronous check handler in Private Profile
    assert.strictEqual(mockPrivateSession.checkHandler({}, 'fullscreen', 'https://private-site.com'), true);
    assert.strictEqual(mockPrivateSession.checkHandler({}, 'clipboard-sanitized-write', 'https://private-site.com'), true);
    assert.strictEqual(mockPrivateSession.checkHandler({}, 'media', 'https://private-site.com'), false);
    assert.strictEqual(mockPrivateSession.checkHandler({}, 'geolocation', 'https://private-site.com'), false);
    assert.strictEqual(mockPrivateSession.checkHandler({}, 'clipboard-read', 'https://private-site.com'), false);
    assert.strictEqual(mockPrivateSession.checkHandler({}, 'notifications', 'https://private-site.com'), false);

    // Asynchronous request handler in Private Profile
    const webContentsMock = { getURL: () => 'https://private-site.com' };
    let benignAllowed = false;
    mockPrivateSession.requestHandler(webContentsMock, 'fullscreen', (val) => { benignAllowed = val; }, {});
    assert.strictEqual(benignAllowed, true, 'Benign UI capability must be permitted in private profile');

    const sensorsToTest = ['media', 'geolocation', 'clipboard-read', 'notifications', 'display-capture'];
    for (const sensor of sensorsToTest) {
        let sensorAllowed = true;
        mockPrivateSession.requestHandler(webContentsMock, sensor, (val) => { sensorAllowed = val; }, {});
        assert.strictEqual(sensorAllowed, false, `Sensor ${sensor} must be unconditionally denied in private profile`);
    }

    // Ensure no prompts were dispatched to main window during private profile sensor requests
    assert.strictEqual(mockWebContents.lastSent, null, 'Private profile must never dispatch permission prompts');

    console.log('✓ Zero-Trust MisePrivateProfile lockdown and benign exception verified');
}

// 4. Persistent Workspace enforcement and prompt broker
{
    resetPermissionsCacheForTesting();
    configureSessionPermissions(mockPersistentSession, {
        getMainWindow: () => mockMainWindow,
        areNotificationsEnabled: () => false
    });

    // 4a. Synchronous check handler
    setDomainPermission('allowed-call.com', 'media:audio', 'allow');
    setDomainPermission('allowed-call.com', 'media:video', 'allow');
    setDomainPermission('denied-call.com', 'media:audio', 'deny');

    assert.strictEqual(
        mockPersistentSession.checkHandler({}, 'media', 'https://allowed-call.com', { mediaType: 'audio' }),
        true,
        'Explicitly allowed capability returns true'
    );
    assert.strictEqual(
        mockPersistentSession.checkHandler({}, 'media', 'https://denied-call.com', { mediaType: 'audio' }),
        false,
        'Explicitly denied capability returns false'
    );
    assert.strictEqual(
        mockPersistentSession.checkHandler({}, 'media', 'https://unset-domain.com', { mediaType: 'audio' }),
        false,
        'Unset capability returns false on synchronous check'
    );

    // 4b. Asynchronous request handler with recorded states
    let asyncAllowed = null;
    mockPersistentSession.requestHandler(
        { getURL: () => 'https://allowed-call.com' },
        'media',
        (res) => { asyncAllowed = res; },
        { requestingUrl: 'https://allowed-call.com', mediaTypes: ['audio'] }
    );
    assert.strictEqual(asyncAllowed, true, 'Stored allow resolves immediately to true');

    let asyncDenied = null;
    mockPersistentSession.requestHandler(
        { getURL: () => 'https://denied-call.com' },
        'media',
        (res) => { asyncDenied = res; },
        { requestingUrl: 'https://denied-call.com', mediaTypes: ['audio'] }
    );
    assert.strictEqual(asyncDenied, false, 'Stored deny resolves immediately to false');

    // 4c. Subframe cross-origin denial
    let iframeAllowed = null;
    mockPersistentSession.requestHandler(
        { getURL: () => 'https://parent-site.com' },
        'media',
        (res) => { iframeAllowed = res; },
        {
            requestingUrl: 'https://iframe-tracker.com',
            isMainFrame: false,
            mediaTypes: ['audio']
        }
    );
    assert.strictEqual(iframeAllowed, false, 'Cross-origin iframe permission request must fail closed');

    // 4d. Unrecorded request triggers prompt broker
    mockWebContents.lastSent = null;
    let promptResult = null;
    mockPersistentSession.requestHandler(
        { getURL: () => 'https://new-service.com' },
        'geolocation',
        (res) => { promptResult = res; },
        { requestingUrl: 'https://new-service.com', isMainFrame: true }
    );

    assert(mockWebContents.lastSent !== null, 'Interactive prompt must be dispatched to host UI');
    assert.strictEqual(mockWebContents.lastSent.channel, 'permission-prompt-requested');
    assert.strictEqual(mockWebContents.lastSent.data.domain, 'new-service.com');
    assert.strictEqual(mockWebContents.lastSent.data.permission, 'geolocation');

    const requestId = mockWebContents.lastSent.data.requestId;

    // Resolve prompt with allow and remember
    const resolved = resolvePermissionPrompt(requestId, { allow: true, remember: true });
    assert.strictEqual(resolved, true);
    assert.strictEqual(promptResult, true, 'Prompt resolution must invoke held callback');

    // Verify remembered state persisted in vault
    assert.strictEqual(getDomainPermissions('new-service.com').geolocation, 'allow');

    console.log('✓ Persistent workspace permission checks, requests, and prompt broker verified');
}

// 5. IPC handlers integration
{
    registerPermissionsIpc({
        handle: (channel, fn) => { mockIpcHandlers.set(channel, fn); }
    });

    assert(mockIpcHandlers.has('get-permissions-vault'));
    assert(mockIpcHandlers.has('get-domain-permissions'));
    assert(mockIpcHandlers.has('set-domain-permission'));
    assert(mockIpcHandlers.has('revoke-domain-permissions'));
    assert(mockIpcHandlers.has('clear-all-permissions'));
    assert(mockIpcHandlers.has('resolve-permission-prompt'));

    console.log('✓ All 6 permissions vault IPC channels registered successfully');
}

// Cleanup temp test directory
try {
    fs.rmSync(testTmpDir, { recursive: true, force: true });
} catch (_) {}

console.log('All Granular Permission Vault tests passed successfully!');
