// tests/permissions.test.js
// Automated regression tests for session permission policy and decidePermission

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
const { decidePermission } = security;

console.log('Running Mise session permission regression tests...');

// 1. Verify restricted and unknown permissions default to false
{
    const deniedPermissions = [
        'clipboard-read',
        'media',
        'geolocation',
        'openExternal',
        'display-capture',
        'unknown-future-permission'
    ];

    for (const perm of deniedPermissions) {
        assert.strictEqual(
            decidePermission(perm, { trusted: false, notificationsEnabled: false }),
            false,
            `Permission ${perm} must be denied when untrusted`
        );
        assert.strictEqual(
            decidePermission(perm, { trusted: false, notificationsEnabled: true }),
            false,
            `Permission ${perm} must remain denied when notifications are enabled`
        );
        assert.strictEqual(
            decidePermission(perm, {}),
            false,
            `Permission ${perm} must default to denied with empty options`
        );
    }
    console.log('✓ Untrusted and unknown permissions denied by default');
}

// 2. Verify allowed permissions evaluate to true
{
    const allowedPermissions = [
        'fullscreen',
        'clipboard-sanitized-write',
        'pointerLock'
    ];

    for (const perm of allowedPermissions) {
        assert.strictEqual(
            decidePermission(perm, { trusted: false, notificationsEnabled: false }),
            true,
            `Permission ${perm} must be allowed`
        );
        assert.strictEqual(
            decidePermission(perm, {}),
            true,
            `Permission ${perm} must be allowed with default options`
        );
    }
    console.log('✓ Allowlisted permissions granted for untrusted origins');
}

// 3. Verify notifications permission follows notificationsEnabled state
{
    assert.strictEqual(
        decidePermission('notifications', { trusted: false, notificationsEnabled: true }),
        true,
        'Notifications must be granted when notificationsEnabled is true'
    );
    assert.strictEqual(
        decidePermission('notifications', { trusted: false, notificationsEnabled: false }),
        false,
        'Notifications must be denied when notificationsEnabled is false'
    );
    assert.strictEqual(
        decidePermission('notifications', { notificationsEnabled: true }),
        true,
        'Notifications must be granted when notificationsEnabled is true with omitted trusted option'
    );
    assert.strictEqual(
        decidePermission('notifications', { notificationsEnabled: false }),
        false,
        'Notifications must be denied when notificationsEnabled is false with omitted trusted option'
    );
    console.log('✓ Notifications permission follows notificationsEnabled state');
}

// 4. Verify any permission is granted when trusted is true
{
    const permissionsToTest = [
        'clipboard-read',
        'media',
        'geolocation',
        'openExternal',
        'display-capture',
        'unknown-future-permission',
        'notifications',
        'fullscreen',
        'arbitrary-permission-name'
    ];

    for (const perm of permissionsToTest) {
        assert.strictEqual(
            decidePermission(perm, { trusted: true, notificationsEnabled: false }),
            true,
            `Permission ${perm} must be allowed for trusted origin`
        );
        assert.strictEqual(
            decidePermission(perm, { trusted: true, notificationsEnabled: true }),
            true,
            `Permission ${perm} must be allowed for trusted origin regardless of notifications toggle`
        );
    }
    console.log('✓ Any permission granted when trusted is true');
}

console.log('All session permission regression tests passed successfully!');
