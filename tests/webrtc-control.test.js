// tests/webrtc-control.test.js
// Regression test suite for WebRTC policy configuration and session hardening

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Running Mise WebRTC control regression tests...');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-webrtc-test-'));
process.env.HOME = tmpHome;

const config = require('../main/config');
const security = require('../security');

(async () => {
    try {
        // 1. Verify default configuration specifies balanced policy
        {
            assert.strictEqual(
                config.DEFAULT_CONFIG.webrtc_policy,
                'default_public_interface_only',
                'Default WebRTC policy should be default_public_interface_only'
            );
            const initialConfig = config.loadBrowserConfig();
            assert.strictEqual(
                initialConfig.webrtc_policy,
                'default_public_interface_only',
                'Loaded initial config should have default_public_interface_only'
            );
            console.log('✓ Default WebRTC policy configuration verified');
        }

        // 2. Verify validateConfigPatch accepts all four permitted policies
        {
            const validPolicies = [
                'default_public_interface_only',
                'disable_non_proxied_udp',
                'disabled',
                'default'
            ];

            for (const policy of validPolicies) {
                const res = config.validateConfigPatch({ webrtc_policy: policy });
                assert.deepStrictEqual(res.rejected, [], `Policy ${policy} should be accepted`);
                assert.strictEqual(res.clean.webrtc_policy, policy);
            }
            console.log('✓ Valid WebRTC policies pass validation');
        }

        // 3. Verify validateConfigPatch rejects invalid values
        {
            const invalidValues = [
                'promiscuous',
                'allow_all',
                123,
                true,
                false,
                null,
                {},
                ['default']
            ];

            for (const invalid of invalidValues) {
                const res = config.validateConfigPatch({ webrtc_policy: invalid });
                assert.strictEqual(res.rejected.includes('webrtc_policy'), true, `Invalid value should be rejected: ${invalid}`);
                assert.strictEqual(res.clean.webrtc_policy, undefined);
            }
            console.log('✓ Invalid WebRTC policies rejected');
        }

        // 4. Verify registerConfigIpc hook dispatching for onWebRTCPolicyChange
        {
            const handlers = {};
            const fakeIpcMain = {
                handle: (channel, fn) => {
                    handlers[channel] = fn;
                }
            };

            const dispatchedPolicies = [];
            const hooks = {
                onWebRTCPolicyChange: (policy) => dispatchedPolicies.push(policy)
            };

            config.registerConfigIpc(fakeIpcMain, hooks);
            const updateHandler = handlers['update-browser-settings'];
            assert.strictEqual(typeof updateHandler, 'function');

            // Dispatch update with new policy
            await updateHandler(null, { webrtc_policy: 'disable_non_proxied_udp' });
            assert.strictEqual(dispatchedPolicies.length, 1);
            assert.strictEqual(dispatchedPolicies[0], 'disable_non_proxied_udp');

            // Dispatch identical update: hook must not be triggered again
            await updateHandler(null, { webrtc_policy: 'disable_non_proxied_udp' });
            assert.strictEqual(dispatchedPolicies.length, 1);

            // Dispatch another valid change
            await updateHandler(null, { webrtc_policy: 'disabled' });
            assert.strictEqual(dispatchedPolicies.length, 2);
            assert.strictEqual(dispatchedPolicies[1], 'disabled');
            console.log('✓ onWebRTCPolicyChange hook dispatch and deduplication verified');
        }

        // 5. Verify security.applyWebRTCPolicy maps policies to Electron session correctly
        {
            const calls = [];
            const fakeSession = {
                setWebRTCIPHandlingPolicy: (policy) => calls.push(policy)
            };

            security.applyWebRTCPolicy(fakeSession, 'default_public_interface_only');
            assert.strictEqual(calls.pop(), 'default_public_interface_only');

            security.applyWebRTCPolicy(fakeSession, 'disable_non_proxied_udp');
            assert.strictEqual(calls.pop(), 'disable_non_proxied_udp');

            // Disabled policy maps to strict UDP blocking at session level
            security.applyWebRTCPolicy(fakeSession, 'disabled');
            assert.strictEqual(calls.pop(), 'disable_non_proxied_udp');

            security.applyWebRTCPolicy(fakeSession, 'default');
            assert.strictEqual(calls.pop(), 'default');

            // Null or missing session safely ignored
            assert.doesNotThrow(() => security.applyWebRTCPolicy(null, 'default'));
            assert.doesNotThrow(() => security.applyWebRTCPolicy({}, 'default'));
            console.log('✓ security.applyWebRTCPolicy session mapping verified');
        }

        // 6. Verify webview preload guest channel registration and disabled-mode stubbing
        {
            const { GUEST_CHANNELS } = require('../main/ipcGuard');
            assert.strictEqual(
                GUEST_CHANNELS.includes('get-webrtc-policy'),
                true,
                'GUEST_CHANNELS must include get-webrtc-policy'
            );

            const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'webview-preload.js'), 'utf8');
            assert.strictEqual(
                preloadSource.includes('get-webrtc-policy'),
                true,
                'webview-preload.js must query get-webrtc-policy'
            );
            assert.strictEqual(
                preloadSource.includes('RTCPeerConnection'),
                true,
                'webview-preload.js must define RTCPeerConnection stub'
            );
            assert.strictEqual(
                preloadSource.includes('RTCSessionDescription'),
                true,
                'webview-preload.js must define RTCSessionDescription stub'
            );
            assert.strictEqual(
                preloadSource.includes('RTCIceCandidate'),
                true,
                'webview-preload.js must define RTCIceCandidate stub'
            );
            console.log('✓ webview preload guest channel and disabled-mode stubs verified');
        }

        // 7. Verify Preferences [F1] UI markup and commandPalette.js synchronisation
        {
            const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
            assert.strictEqual(
                indexHtml.includes('id="setting-webrtc-policy"'),
                true,
                'index.html must include setting-webrtc-policy select'
            );
            assert.strictEqual(
                indexHtml.includes('value="default_public_interface_only"'),
                true,
                'index.html must include default_public_interface_only option'
            );
            assert.strictEqual(
                indexHtml.includes('value="disable_non_proxied_udp"'),
                true,
                'index.html must include disable_non_proxied_udp option'
            );
            assert.strictEqual(
                indexHtml.includes('value="disabled"'),
                true,
                'index.html must include disabled option'
            );
            assert.strictEqual(
                indexHtml.includes('value="default"'),
                true,
                'index.html must include default option'
            );

            const paletteJs = fs.readFileSync(path.join(__dirname, '..', 'modules', 'overlays', 'commandPalette.js'), 'utf8');
            assert.strictEqual(
                paletteJs.includes("document.getElementById('setting-webrtc-policy')"),
                true,
                'commandPalette.js must sync setting-webrtc-policy'
            );
            assert.strictEqual(
                paletteJs.includes('cfg.webrtc_policy = policy'),
                true,
                'commandPalette.js must handle live webrtc_policy change'
            );
            console.log('✓ Preferences [F1] UI markup and commandPalette.js sync verified');
        }

        // 8. Verify Command Palette definitions and action metadata
        {
            const keybinds = require('../keybinds');
            assert.strictEqual(
                Boolean(keybinds.ACTION_METADATA['cycle-webrtc-policy']),
                true,
                'ACTION_METADATA must register cycle-webrtc-policy'
            );
            assert.strictEqual(
                Boolean(keybinds.ACTION_METADATA['toggle-webrtc-protection']),
                true,
                'ACTION_METADATA must register toggle-webrtc-protection'
            );

            const paletteJs = fs.readFileSync(path.join(__dirname, '..', 'modules', 'overlays', 'commandPalette.js'), 'utf8');
            assert.strictEqual(
                paletteJs.includes("id: 'cycle-webrtc-policy'"),
                true,
                'commandPalette.js must define cycle-webrtc-policy command'
            );
            assert.strictEqual(
                paletteJs.includes("id: 'toggle-webrtc-protection'"),
                true,
                'commandPalette.js must define toggle-webrtc-protection command'
            );

            const rendererJs = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
            assert.strictEqual(
                rendererJs.includes("case 'cycle-webrtc-policy':"),
                true,
                'renderer.js master-shortcut must handle cycle-webrtc-policy'
            );
            assert.strictEqual(
                rendererJs.includes("case 'toggle-webrtc-protection':"),
                true,
                'renderer.js master-shortcut must handle toggle-webrtc-protection'
            );
            console.log('✓ Command Palette definitions and action metadata verified');
        }

        // 9. Verify F1 native settings submenu and explicit Command Palette commands
        {
            const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
            assert.strictEqual(
                mainJs.includes("label: 'WebRTC IP Handling & Leak Protection'"),
                true,
                'buildSettingsSubmenu must include WebRTC IP Handling & Leak Protection'
            );
            assert.strictEqual(
                mainJs.includes("policy: 'default_public_interface_only'"),
                true,
                'buildSettingsSubmenu must include default_public_interface_only'
            );
            assert.strictEqual(
                mainJs.includes("policy: 'disable_non_proxied_udp'"),
                true,
                'buildSettingsSubmenu must include disable_non_proxied_udp'
            );
            assert.strictEqual(
                mainJs.includes("policy: 'disabled'"),
                true,
                'buildSettingsSubmenu must include disabled'
            );
            assert.strictEqual(
                mainJs.includes("policy: 'default'"),
                true,
                'buildSettingsSubmenu must include default'
            );

            const paletteJs = fs.readFileSync(path.join(__dirname, '..', 'modules', 'overlays', 'commandPalette.js'), 'utf8');
            assert.strictEqual(
                paletteJs.includes("id: 'webrtc-policy-balanced'"),
                true,
                'commandPalette.js must include direct balanced command'
            );
            assert.strictEqual(
                paletteJs.includes("id: 'webrtc-policy-strict'"),
                true,
                'commandPalette.js must include direct strict command'
            );
            assert.strictEqual(
                paletteJs.includes("id: 'webrtc-policy-disabled'"),
                true,
                'commandPalette.js must include direct disabled command'
            );
            assert.strictEqual(
                paletteJs.includes("id: 'webrtc-policy-permissive'"),
                true,
                'commandPalette.js must include direct permissive command'
            );
            assert.strictEqual(
                paletteJs.includes("id: 'inspect-webrtc-status'"),
                true,
                'commandPalette.js must include inspect-webrtc-status command'
            );

            const utilsJs = fs.readFileSync(path.join(__dirname, '..', 'modules', 'utils.js'), 'utf8');
            assert.strictEqual(
                utilsJs.includes('export function showNotificationToast'),
                true,
                'modules/utils.js must export showNotificationToast'
            );

            const rendererJs = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
            assert.strictEqual(
                rendererJs.includes("case 'webrtc-policy-changed':"),
                true,
                'renderer.js must handle webrtc-policy-changed master-shortcut'
            );
            console.log('✓ F1 native settings submenu and explicit Command Palette commands verified');
        }

        // Clean up temporary directory
        fs.rmSync(tmpHome, { recursive: true, force: true });
        console.log('All WebRTC control regression tests passed successfully!');
    } catch (err) {
        console.error('WebRTC control test failed:', err);
        try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
        process.exit(1);
    }
})();
