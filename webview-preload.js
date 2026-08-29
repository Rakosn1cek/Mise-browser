// webview-preload.js

const { ipcRenderer } = require('electron');

// Ask the main process whether this site is on the user's trusted-domain
// allowlist (banking, shopping, etc.). Trusted sites skip fingerprint
// spoofing so their fraud-detection checks see a consistent, real device
// profile instead of randomized/noised values.
let isTrustedSite = false;
try {
    isTrustedSite = !!ipcRenderer.sendSync('is-trusted-domain', window.location.hostname);
} catch (e) {
    isTrustedSite = false;
}

const injectScript = () => {
    if (isTrustedSite) return; // Skip anti-fingerprinting patches on trusted sites

    const script = document.createElement('script');
    const codeToInject = `(function() {
        // Guard against this script executing more than once against the same
        // window/document (e.g. preload re-injection edge cases). Without this,
        // getContext/getImageData/toDataURL/getChannelData/resolvedOptions all
        // get wrapped repeatedly, compounding into deep or infinitely recursive
        // call chains under heavy canvas usage (seen as
        // "RangeError: Maximum call stack size exceeded" during YouTube's
        // Polymer dom-repeat construction).
        if (window.__miseFingerprintPatchesApplied) return;
        window.__miseFingerprintPatchesApplied = true;

        Object.defineProperty(navigator, 'doNotTrack', { get: () => '1', configurable: true });
        Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true, configurable: true });

        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
        Object.defineProperty(navigator, 'platform', { get: () => 'Linux x86_64', configurable: true });

        try {
            const origResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
            Intl.DateTimeFormat.prototype.resolvedOptions = function() {
                const res = origResolvedOptions.apply(this, arguments);
                res.timeZone = 'Europe/London';
                return res;
            };
        } catch (e) {}

        if (navigator.userAgentData) {
            Object.defineProperty(navigator, 'userAgentData', {
                get: function() {
                    return {
                        brands: [
                            { brand: 'Chromium', version: '150' },
                            { brand: 'Google Chrome', version: '150' },
                            { brand: 'Not-A.Brand', version: '99' }
                        ],
                        mobile: false,
                        platform: 'Linux',
                        getHighEntropyValues: function() {
                            return Promise.resolve({
                                architecture: 'x86',
                                bitness: '64',
                                brands: [
                                    { brand: 'Chromium', version: '150' },
                                    { brand: 'Google Chrome', version: '150' }
                                ],
                                mobile: false,
                                model: '',
                                platform: 'Linux',
                                platformVersion: '',
                                uaFullVersion: '150.0.0.0'
                            });
                        }
                    };
                }
            });
        }

        const spoofContext = function(ctx) {
            if (!ctx) return ctx;
            if (ctx.__miseWebGLSpoofed) return ctx;
            ctx.__miseWebGLSpoofed = true;

            const origGetParam = ctx.getParameter;
            ctx.getParameter = function(param) {
                if (param === 37445 || param === 0x9245) return 'Google Inc. (Intel)';
                if (param === 37446 || param === 0x9246) return 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)';
                return origGetParam.apply(this, arguments);
            };

            const origGetExt = ctx.getExtension;
            ctx.getExtension = function(name) {
                if (name === 'WEBGL_debug_renderer_info') {
                    return {
                        UNMASKED_VENDOR_WEBGL: 37445,
                        UNMASKED_RENDERER_WEBGL: 37446
                    };
                }
                return origGetExt.apply(this, arguments);
            };

            const origGetSupportedExtensions = ctx.getSupportedExtensions;
            ctx.getSupportedExtensions = function() {
                const list = origGetSupportedExtensions.apply(this, arguments);
                if (!list) return list;
                const shuffled = list.slice();
                for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                }
                return shuffled;
            };
            return ctx;
        };

        const origGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, attributes) {
            const ctx = origGetContext.apply(this, arguments);
            if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
                return spoofContext(ctx);
            }
            return ctx;
        };

        if (typeof OffscreenCanvas !== 'undefined') {
            const origOffscreenGetContext = OffscreenCanvas.prototype.getContext;
            OffscreenCanvas.prototype.getContext = function(type, attributes) {
                const ctx = origOffscreenGetContext.apply(this, arguments);
                if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
                    return spoofContext(ctx);
                }
                return ctx;
            };
        }

        const hookWebGLReadPixels = (proto) => {
            if (!proto || !proto.readPixels) return;
            const origReadPixels = proto.readPixels;
            proto.readPixels = function() {
                origReadPixels.apply(this, arguments);
                const pixels = arguments[6];
                if (pixels && pixels.length && pixels.length < 50000) {
                    for (let i = 0; i < pixels.length; i += 16) {
                        const delta = (Math.random() < 0.5 ? -1 : 1);
                        pixels[i] = Math.min(255, Math.max(0, pixels[i] + delta));
                    }
                }
            };
        };
        if (typeof WebGLRenderingContext !== 'undefined') hookWebGLReadPixels(WebGLRenderingContext.prototype);
        if (typeof WebGL2RenderingContext !== 'undefined') hookWebGLReadPixels(WebGL2RenderingContext.prototype);

        const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;

        const addCanvasNoise = (imgData) => {
            const data = imgData.data;
            for (let i = 0; i < data.length; i += 16) {
                const delta = (Math.random() < 0.5 ? -1 : 1);
                data[i] = Math.min(255, Math.max(0, data[i] + delta));
            }
            return imgData;
        };

        const addWebGLCanvasNoise = (gl) => {
            try {
                const prevScissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
                const prevScissorBox = gl.getParameter(gl.SCISSOR_BOX);
                const prevClearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE);

                const step = 1 / 255;
                const jitter = () => (Math.random() < 0.5 ? -step : step);

                gl.enable(gl.SCISSOR_TEST);
                gl.scissor(0, 0, 1, 1);
                gl.clearColor(
                    Math.min(1, Math.max(0, prevClearColor[0] + jitter())),
                    Math.min(1, Math.max(0, prevClearColor[1] + jitter())),
                    Math.min(1, Math.max(0, prevClearColor[2] + jitter())),
                    prevClearColor[3]
                );
                gl.clear(gl.COLOR_BUFFER_BIT);

                gl.clearColor(prevClearColor[0], prevClearColor[1], prevClearColor[2], prevClearColor[3]);
                gl.scissor(prevScissorBox[0], prevScissorBox[1], prevScissorBox[2], prevScissorBox[3]);
                if (!prevScissorEnabled) gl.disable(gl.SCISSOR_TEST);
            } catch (e) {}
        };

        HTMLCanvasElement.prototype.toDataURL = function() {
            const ctx = this.getContext('2d');
            if (ctx) {
                const w = Math.max(1, this.width), h = Math.max(1, this.height);
                const imgData = origGetImageData.call(ctx, 0, 0, w, h);
                ctx.putImageData(addCanvasNoise(imgData), 0, 0);
            } else {
                const glCtx = this.getContext('webgl2') || this.getContext('webgl') || this.getContext('experimental-webgl');
                if (glCtx && this.width < 1000 && this.height < 1000) addWebGLCanvasNoise(glCtx);
            }
            return origToDataURL.apply(this, arguments);
        };

        CanvasRenderingContext2D.prototype.getImageData = function() {
            const imgData = origGetImageData.apply(this, arguments);
            return addCanvasNoise(imgData);
        };

        if (typeof AudioBuffer !== 'undefined') {
            const origGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function() {
                const results = origGetChannelData.apply(this, arguments);
                for (let i = 0; i < results.length; i += 100) {
                    results[i] = results[i] + 0.0000001 * (Math.random() - 0.5);
                }
                return results;
            };
        }
    })();`;

    if (window.trustedTypes && window.trustedTypes.createPolicy) {
        const policy = window.trustedTypes.defaultPolicy || window.trustedTypes.createPolicy('mise-preload', {
            createScript: (s) => s
        });
        script.text = policy.createScript(codeToInject);
    } else {
        script.text = codeToInject;
    }

    (document.head || document.documentElement).appendChild(script);
    script.remove();
};

if (document.documentElement) {
    injectScript();
} else {
    document.addEventListener('DOMContentLoaded', injectScript, { once: true });
}

// ==========================================
// PRE-EXISTING WEBVIEW KEYBOARD BUBBLING
// ==========================================
window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    const isCtrl = e.ctrlKey || e.metaKey;

    if (isCtrl && e.shiftKey) {
        if (key === 'w') {
            e.preventDefault();
            ipcRenderer.send('bubble-webview-key', 'toggle-dashboard');
            return;
        } else if (key === 'i') {
            e.preventDefault();
            ipcRenderer.send('bubble-webview-key', 'toggle-devtools');
            return;
        } else if (key === '0') {
            e.preventDefault();
            ipcRenderer.send('bubble-webview-key', 'toggle-global-media');
            return;
        }
    }

    if (isCtrl && !e.shiftKey) {
        if (key === 'm') {
            ipcRenderer.send('bubble-webview-key', 'focus-sidebar');
        } else if (key === 'b') {
            ipcRenderer.send('bubble-webview-key', 'focus-webview');
        } else if (key === 'f') {
            ipcRenderer.send('bubble-webview-key', 'trigger-hints');
        } else if (key === 't') {
            ipcRenderer.send('bubble-webview-key', 'spawn-tab');
        } else if (key === 'l') {
            ipcRenderer.send('bubble-webview-key', 'toggle-address');
        } else if (key === 'd') {
            ipcRenderer.send('bubble-webview-key', 'remove-tab');
        } else if (key === 'p') {
            ipcRenderer.send('bubble-webview-key', 'toggle-palette');
        } else if (key === 'h') {
            ipcRenderer.send('bubble-webview-key', 'toggle-help');
        } 
    }

    if (e.key === 'F12') {
        e.preventDefault();
        ipcRenderer.send('bubble-webview-key', 'toggle-devtools');
    }

    if (e.key === 'F10') {
        e.preventDefault();
        ipcRenderer.send('bubble-webview-key', 'toggle-global-media');
        return;
    }
});
