// tests/doh-resolver.test.js
// Regression test suite for DNS-over-HTTPS (DoH) configuration, validation, and host resolver integration

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Running Mise DNS-over-HTTPS (DoH) resolver regression tests...');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-doh-test-'));
process.env.HOME = tmpHome;

const config = require('../main/config');
const dohResolver = require('../main/dohResolver');

(async () => {
    try {
        // 1. Verify default configuration specifies disabled posture
        {
            assert.strictEqual(
                config.DEFAULT_CONFIG.doh_provider,
                'off',
                'Default DoH provider must be "off"'
            );
            assert.strictEqual(
                config.DEFAULT_CONFIG.doh_custom_url,
                '',
                'Default DoH custom URL must be an empty string'
            );

            const initialConfig = config.loadBrowserConfig();
            assert.strictEqual(
                initialConfig.doh_provider,
                'off',
                'Loaded initial config must have doh_provider set to "off"'
            );
            assert.strictEqual(
                initialConfig.doh_custom_url,
                '',
                'Loaded initial config must have doh_custom_url set to empty string'
            );
            console.log('✓ Default configuration values verified');
        }

        // 2. Verify validation of supported providers
        {
            const validProviders = ['off', 'quad9', 'mullvad', 'cloudflare', 'custom'];
            for (const provider of validProviders) {
                const res = config.validateConfigPatch({ doh_provider: provider });
                assert.deepStrictEqual(res.rejected, [], `Provider "${provider}" should be accepted`);
                assert.strictEqual(res.clean.doh_provider, provider);
            }

            const validCustomUrls = [
                '',
                'https://dns.quad9.net/dns-query',
                'https://custom-resolver.example.org/dns-query',
                'https://' + 'a'.repeat(400)
            ];
            for (const customUrl of validCustomUrls) {
                const res = config.validateConfigPatch({ doh_custom_url: customUrl });
                assert.deepStrictEqual(res.rejected, [], `Custom URL should be accepted: ${customUrl.slice(0, 30)}`);
                assert.strictEqual(res.clean.doh_custom_url, customUrl);
            }
            console.log('✓ Supported providers and custom URL schema validation verified');
        }

        // 3. Verify rejection of invalid providers and custom URL bounds
        {
            const invalidProviders = [
                'google',
                'opendns',
                123,
                true,
                false,
                null,
                {},
                ['quad9']
            ];
            for (const invalid of invalidProviders) {
                const res = config.validateConfigPatch({ doh_provider: invalid });
                assert.strictEqual(res.rejected.includes('doh_provider'), true, `Invalid provider should be rejected: ${invalid}`);
                assert.strictEqual(res.clean.doh_provider, undefined);
            }

            const invalidCustomUrls = [
                123,
                true,
                null,
                {},
                ['https://example.com/dns-query'],
                'https://' + 'a'.repeat(510)
            ];
            for (const invalid of invalidCustomUrls) {
                const res = config.validateConfigPatch({ doh_custom_url: invalid });
                assert.strictEqual(res.rejected.includes('doh_custom_url'), true, `Invalid custom URL should be rejected`);
                assert.strictEqual(res.clean.doh_custom_url, undefined);
            }
            console.log('✓ Invalid providers and oversized custom URLs rejected');
        }

        // 4. Verify isValidDoHUrl helper validation
        {
            assert.strictEqual(dohResolver.isValidDoHUrl('https://dns.quad9.net/dns-query'), true);
            assert.strictEqual(dohResolver.isValidDoHUrl('https://cloudflare-dns.com/dns-query'), true);
            assert.strictEqual(dohResolver.isValidDoHUrl('https://1.1.1.1/dns-query'), true);

            // Insecure schemes and invalid inputs must be rejected
            assert.strictEqual(dohResolver.isValidDoHUrl('http://dns.quad9.net/dns-query'), false);
            assert.strictEqual(dohResolver.isValidDoHUrl('ftp://dns.quad9.net/dns-query'), false);
            assert.strictEqual(dohResolver.isValidDoHUrl('javascript:alert(1)'), false);
            assert.strictEqual(dohResolver.isValidDoHUrl('not-a-valid-url'), false);
            assert.strictEqual(dohResolver.isValidDoHUrl(''), false);
            assert.strictEqual(dohResolver.isValidDoHUrl(null), false);
            assert.strictEqual(dohResolver.isValidDoHUrl(undefined), false);
            assert.strictEqual(dohResolver.isValidDoHUrl(12345), false);
            assert.strictEqual(dohResolver.isValidDoHUrl('https://' + 'a'.repeat(510)), false);
            console.log('✓ HTTPS URL syntax and length validation verified');
        }

        // 5. Verify host resolver parameter construction across all providers
        {
            const calls = [];
            const mockApp = {
                configureHostResolver: (opts) => calls.push(opts)
            };

            // Test curated providers
            dohResolver.applyDoHConfiguration(mockApp, 'quad9', '');
            assert.strictEqual(calls.length, 1);
            assert.deepStrictEqual(calls[0], {
                enableBuiltInResolver: true,
                secureDnsMode: 'secure',
                secureDnsServers: ['https://dns.quad9.net/dns-query'],
                secureDnsServerTemplates: ['https://dns.quad9.net/dns-query']
            });

            dohResolver.applyDoHConfiguration(mockApp, 'mullvad', '');
            assert.strictEqual(calls.length, 2);
            assert.deepStrictEqual(calls[1], {
                enableBuiltInResolver: true,
                secureDnsMode: 'secure',
                secureDnsServers: ['https://dns.mullvad.net/dns-query'],
                secureDnsServerTemplates: ['https://dns.mullvad.net/dns-query']
            });

            dohResolver.applyDoHConfiguration(mockApp, 'cloudflare', '');
            assert.strictEqual(calls.length, 3);
            assert.deepStrictEqual(calls[2], {
                enableBuiltInResolver: true,
                secureDnsMode: 'secure',
                secureDnsServers: ['https://cloudflare-dns.com/dns-query'],
                secureDnsServerTemplates: ['https://cloudflare-dns.com/dns-query']
            });

            // Test custom provider with valid HTTPS URL
            dohResolver.applyDoHConfiguration(mockApp, 'custom', 'https://custom.dns/dns-query');
            assert.strictEqual(calls.length, 4);
            assert.deepStrictEqual(calls[3], {
                enableBuiltInResolver: true,
                secureDnsMode: 'secure',
                secureDnsServers: ['https://custom.dns/dns-query'],
                secureDnsServerTemplates: ['https://custom.dns/dns-query']
            });

            // Test provider "off"
            dohResolver.applyDoHConfiguration(mockApp, 'off', '');
            assert.strictEqual(calls.length, 5);
            assert.deepStrictEqual(calls[4], {
                enableBuiltInResolver: true,
                secureDnsMode: 'off'
            });
            console.log('✓ Host resolver configuration construction verified across all providers');
        }

        // 6. Verify fallback safety when custom URL is invalid or provider unrecognised
        {
            const calls = [];
            const mockApp = {
                configureHostResolver: (opts) => calls.push(opts)
            };

            // Insecure HTTP custom URL fallback
            dohResolver.applyDoHConfiguration(mockApp, 'custom', 'http://insecure-dns.com/dns-query');
            assert.strictEqual(calls.length, 1);
            assert.deepStrictEqual(calls[0], {
                enableBuiltInResolver: true,
                secureDnsMode: 'off'
            });

            // Malformed custom URL fallback
            dohResolver.applyDoHConfiguration(mockApp, 'custom', 'invalid-uri');
            assert.strictEqual(calls.length, 2);
            assert.deepStrictEqual(calls[1], {
                enableBuiltInResolver: true,
                secureDnsMode: 'off'
            });

            // Empty custom URL fallback
            dohResolver.applyDoHConfiguration(mockApp, 'custom', '');
            assert.strictEqual(calls.length, 3);
            assert.deepStrictEqual(calls[2], {
                enableBuiltInResolver: true,
                secureDnsMode: 'off'
            });

            // Unrecognised provider fallback
            dohResolver.applyDoHConfiguration(mockApp, 'unknown-provider', '');
            assert.strictEqual(calls.length, 4);
            assert.deepStrictEqual(calls[3], {
                enableBuiltInResolver: true,
                secureDnsMode: 'off'
            });

            // Graceful handling of null/missing app
            assert.doesNotThrow(() => dohResolver.applyDoHConfiguration(null, 'quad9', ''));
            assert.doesNotThrow(() => dohResolver.applyDoHConfiguration({}, 'quad9', ''));
            console.log('✓ Fallback safety and invalid URL handling verified');
        }

        // 7. Verify registerConfigIpc hook dispatching for onDoHChange
        {
            const handlers = {};
            const fakeIpcMain = {
                handle: (channel, fn) => {
                    handlers[channel] = fn;
                }
            };

            const dispatched = [];
            const hooks = {
                onDoHChange: (provider, customUrl) => dispatched.push({ provider, customUrl })
            };

            config.registerConfigIpc(fakeIpcMain, hooks);
            const updateHandler = handlers['update-browser-settings'];
            assert.strictEqual(typeof updateHandler, 'function');

            // Dispatch update with new DoH provider
            await updateHandler(null, { doh_provider: 'quad9' });
            assert.strictEqual(dispatched.length, 1);
            assert.deepStrictEqual(dispatched[0], { provider: 'quad9', customUrl: '' });

            // Dispatch identical update: hook must not trigger again
            await updateHandler(null, { doh_provider: 'quad9' });
            assert.strictEqual(dispatched.length, 1);

            // Dispatch custom URL change
            await updateHandler(null, { doh_custom_url: 'https://my.dns/query' });
            assert.strictEqual(dispatched.length, 2);
            assert.deepStrictEqual(dispatched[1], { provider: 'quad9', customUrl: 'https://my.dns/query' });

            // Unrelated setting change: hook must not trigger
            await updateHandler(null, { theme: 'light' });
            assert.strictEqual(dispatched.length, 2);
            console.log('✓ onDoHChange hook dispatching and deduplication verified');
        }

        // 8. Verify index.html UI markup constraints
        {
            const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

            // Selector must exist with all 5 options
            assert.match(html, /id="setting-doh-provider"/, 'Selector #setting-doh-provider must exist in index.html');
            assert.match(html, /<option value="off">/, 'Option off must exist');
            assert.match(html, /<option value="quad9">/, 'Option quad9 must exist');
            assert.match(html, /<option value="mullvad">/, 'Option mullvad must exist');
            assert.match(html, /<option value="cloudflare">/, 'Option cloudflare must exist');
            assert.match(html, /<option value="custom">/, 'Option custom must exist');

            // Custom URL input and container
            assert.match(html, /id="setting-doh-custom-container"/, 'Custom URL container must exist');
            assert.match(html, /id="setting-doh-custom-url"/, 'Custom URL input #setting-doh-custom-url must exist');

            // Operational security callout
            assert.match(html, /Operational Security Advisory/, 'Security advisory callout must exist');

            // Verify controls reside exclusively in #tab-privacy
            const privacySectionMatch = html.match(/<section[^>]*id="tab-privacy"[^>]*>([\s\S]*?)<\/section>/);
            assert(privacySectionMatch, '#tab-privacy section must exist');
            const privacySectionContent = privacySectionMatch[1];
            assert(privacySectionContent.includes('id="setting-doh-provider"'), 'DoH selector must be inside #tab-privacy');
            assert(privacySectionContent.includes('id="setting-doh-custom-url"'), 'DoH custom input must be inside #tab-privacy');

            // Ensure no DoH controls leaked into other sections
            const htmlWithoutPrivacy = html.replace(privacySectionMatch[0], '');
            assert.strictEqual(htmlWithoutPrivacy.includes('setting-doh-provider'), false, 'DoH selector must not exist outside #tab-privacy');
            assert.strictEqual(htmlWithoutPrivacy.includes('setting-doh-custom-url'), false, 'DoH custom URL input must not exist outside #tab-privacy');
            console.log('✓ UI markup and exclusive section placement verified');
        }

        console.log('All DNS-over-HTTPS (DoH) resolver tests passed successfully!');
    } catch (err) {
        console.error('DNS-over-HTTPS test failure:', err);
        process.exit(1);
    } finally {
        try {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        } catch (_) {}
    }
})();
