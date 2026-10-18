// tests/ip-blocklist.test.js
// Automated regression tests for SSRF IP filtering and BlockList validation

const assert = require('assert');
const { isPrivateOrBlockedIP, validateRequestDestination, createPinnedDispatcher } = require('../userContent.js');

console.log('Running Mise userscript IP filtering and SSRF regression tests...');

// 1. Verify blocked private, mapped, and loopback IP addresses
{
    const blockedAddresses = [
        '::ffff:7f00:1',
        '::ffff:a9fe:a9fe',
        '64:ff9b::7f00:1',
        '::7f00:1',
        '127.0.0.1',
        '10.1.2.3',
        '192.168.1.1',
        '[::1]',
        'http://2130706433/'
    ];

    for (const addr of blockedAddresses) {
        assert.strictEqual(
            isPrivateOrBlockedIP(addr),
            true,
            `Address ${addr} must be classified as blocked or restricted`
        );
    }

    console.log('✓ Blocked IP ranges, IPv4-mapped, NAT64, and decimal formats verified');
}

// 2. Verify permitted public IP addresses
{
    const allowedAddresses = [
        '8.8.8.8',
        '2606:4700:4700::1111'
    ];

    for (const addr of allowedAddresses) {
        assert.strictEqual(
            isPrivateOrBlockedIP(addr),
            false,
            `Public address ${addr} must not be blocked`
        );
    }

    console.log('✓ Public addresses verified as unblocked');
}

// 3. Verify destination URL validation rejects restricted addresses
(async () => {
    const dummyToken = {
        pageHostname: 'example.com',
        connects: ['*'],
        grants: ['GM_xmlhttpRequest']
    };

    const restrictedUrls = [
        'http://127.0.0.1/',
        'http://2130706433/',
        'http://[::ffff:7f00:1]/',
        'http://[::ffff:a9fe:a9fe]/',
        'http://[64:ff9b::7f00:1]/',
        'http://[::7f00:1]/'
    ];

    for (const url of restrictedUrls) {
        await assert.rejects(
            async () => {
                await validateRequestDestination(url, dummyToken);
            },
            /SSRF protection/,
            `Destination ${url} must be rejected by SSRF protection`
        );
    }

    console.log('✓ SSRF destination validation rejects all restricted URL targets');

    // 4. Verify createPinnedDispatcher behaviour
    {
        // Direct IP target does not require DNS pinning dispatcher
        const directIpValidation = {
            hostname: '8.8.8.8',
            pinnedIp: '8.8.8.8',
            pinnedFamily: 4
        };
        assert.strictEqual(
            createPinnedDispatcher(directIpValidation),
            null,
            'Direct IP requests must return null dispatcher'
        );

        // Resolved domain name requires pinned dispatcher
        const resolvedValidation = {
            hostname: 'example.com',
            pinnedIp: '93.184.216.34',
            pinnedFamily: 4
        };
        const dispatcher = createPinnedDispatcher(resolvedValidation);
        assert.ok(dispatcher, 'Resolved domain name must construct pinned dispatcher');
        if (typeof dispatcher.destroy === 'function') {
            dispatcher.destroy();
        }

        console.log('✓ createPinnedDispatcher behaviour verified');
    }

    console.log('\nAll userscript IP filtering tests passed successfully!');
})();
