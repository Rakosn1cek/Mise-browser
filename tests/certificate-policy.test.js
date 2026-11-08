// tests/certificate-policy.test.js
// Automated regression tests for TLS certificate policy, local network trust, and error handling

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
const {
    isLocalOrPrivateHost,
    setAllowLocalCertificates,
    getAllowLocalCertificates,
    setTrustedCertificates,
    getTrustedCertificates,
    addTrustedCertificate,
    removeTrustedCertificate,
    isCertificateAllowed
} = security;

console.log('Running Mise TLS certificate policy and local network trust regression tests...');

// 1. Verify detection of local, loopback, and RFC 1918 private addresses
{
    const privateHosts = [
        '192.168.1.61',
        '192.168.0.1',
        '10.0.0.1',
        '10.254.254.254',
        '172.16.0.1',
        '172.24.0.10',
        '172.31.255.254',
        '127.0.0.1',
        '127.10.20.30',
        'localhost',
        '::1',
        '169.254.1.1',
        'router.lan',
        'my-nas.local',
        'homelab.home.arpa',
        'internal-host.internal',
        'cluster.localhost'
    ];

    for (const host of privateHosts) {
        assert.strictEqual(
            isLocalOrPrivateHost(host),
            true,
            `Host "${host}" must be identified as a local or private network address`
        );
    }

    const publicHosts = [
        'google.com',
        'github.com',
        'badssl.com',
        '8.8.8.8',
        '1.1.1.1',
        '172.32.0.1',
        '172.15.255.255',
        '9.255.255.255',
        '11.0.0.1',
        '192.169.1.1'
    ];

    for (const host of publicHosts) {
        assert.strictEqual(
            isLocalOrPrivateHost(host),
            false,
            `Host "${host}" must not be identified as a private network address`
        );
    }

    console.log('✓ Private RFC 1918, loopback, and local domain suffixes verified');
}

// 2. Verify certificate allowance for local servers
{
    setAllowLocalCertificates(true);
    setTrustedCertificates([]);

    assert.strictEqual(isCertificateAllowed('https://192.168.1.61:9090'), true);
    assert.strictEqual(isCertificateAllowed('https://192.168.1.61:9090/cockpit'), true);
    assert.strictEqual(isCertificateAllowed('wss://192.168.1.61:9090/cockpit/socket'), true);
    assert.strictEqual(isCertificateAllowed('https://localhost:8443'), true);
    assert.strictEqual(isCertificateAllowed('https://my-nas.local:5001'), true);

    // Public sites should remain rejected when not explicitly trusted
    assert.strictEqual(isCertificateAllowed('https://self-signed.badssl.com'), false);
    assert.strictEqual(isCertificateAllowed('https://google.com'), false);

    // Cross-origin request from public website to local server must be rejected
    assert.strictEqual(
        isCertificateAllowed('https://192.168.1.61:9090', { isMainFrame: false, topLevelUrl: 'https://evil.com/app' }),
        false,
        'Public web page attempting cross-origin subrequest to local server must be rejected'
    );

    // Subresource from local origin must be permitted
    assert.strictEqual(
        isCertificateAllowed('https://192.168.1.61:9090/cockpit/static/branding.css', { isMainFrame: false, topLevelUrl: 'https://192.168.1.61:9090/' }),
        true,
        'Subresources within local server origin must be permitted'
    );

    // Disabling local certificate trust rejects private IPs unless explicitly trusted
    setAllowLocalCertificates(false);
    assert.strictEqual(isCertificateAllowed('https://192.168.1.61:9090'), false);

    // Explicitly trusting the host allows it even when local auto-trust is off
    addTrustedCertificate('192.168.1.61:9090');
    assert.strictEqual(isCertificateAllowed('https://192.168.1.61:9090'), true);

    // Cleanup
    removeTrustedCertificate('192.168.1.61:9090');
    setAllowLocalCertificates(true);

    console.log('✓ Local network certificate allowance and toggles verified');
}

// 3. Verify trusted certificate exception management
{
    setTrustedCertificates(['custom-server.internal:4433', 'remote-device.com:8443']);
    const current = getTrustedCertificates();
    assert.deepStrictEqual(current, ['custom-server.internal:4433', 'remote-device.com:8443']);

    assert.strictEqual(isCertificateAllowed('https://remote-device.com:8443/app'), true);
    assert.strictEqual(isCertificateAllowed('https://remote-device.com/other'), false);

    removeTrustedCertificate('remote-device.com:8443');
    assert.strictEqual(isCertificateAllowed('https://remote-device.com:8443/app'), false);

    console.log('✓ Certificate exception addition, removal, and host matching verified');
}

// 4. Verify config.js default values and sanitisation
{
    const configModule = require('../main/config.js');
    const { DEFAULT_CONFIG, validateConfigPatch } = configModule;

    assert.strictEqual(DEFAULT_CONFIG.allow_local_certificates, true);
    assert.deepStrictEqual(DEFAULT_CONFIG.trusted_certificates, []);

    const sanitizedValid = validateConfigPatch({
        allow_local_certificates: false,
        trusted_certificates: ['server.org:8443']
    });
    assert.strictEqual(sanitizedValid.clean.allow_local_certificates, false);
    assert.deepStrictEqual(sanitizedValid.clean.trusted_certificates, ['server.org:8443']);

    const sanitizedInvalid = validateConfigPatch({
        allow_local_certificates: 'not-a-boolean',
        trusted_certificates: 'not-an-array'
    });
    assert.strictEqual(sanitizedInvalid.rejected.includes('allow_local_certificates'), true);
    assert.strictEqual(sanitizedInvalid.rejected.includes('trusted_certificates'), true);

    console.log('✓ Configuration schema and update sanitisation verified');
}

console.log('All TLS certificate policy tests passed successfully!');
