// webview-preload.js

const injectScript = () => {
    const script = document.createElement('script');
    script.textContent = `(function() {
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

            // The "Hash of WebGL fingerprint" field never moved under any
            // amount of pixel-level noise (readPixels, toDataURL), which
            // means it's very likely not pixel-based at all — the older
            // fingerprintjs2-style WebGL test instead just concatenates a
            // long list of getParameter() capability values plus this
            // extensions list and hashes that string. Shuffling the order
            // here (not the contents — nothing is added or removed) changes
            // that joined string on every call without changing what
            // features are actually reported as available, so real
            // extension checks like .includes(name) are unaffected.
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

        // --- TARGETED FIX FOR HASH OF WEBGL FINGERPRINT ONLY ---
        const hookWebGLReadPixels = (proto) => {
            if (!proto || !proto.readPixels) return;
            const origReadPixels = proto.readPixels;
            proto.readPixels = function() {
                origReadPixels.apply(this, arguments);
                const pixels = arguments[6];
                if (pixels && pixels.length) {
                    // A fixed pixels[0] ^= 1 produces the exact same output
                    // on every call, which is why this was still coming
                    // back as a static hash rather than "randomized" (the
                    // way the AudioContext noise below does, since that one
                    // uses Math.random() per call). Use per-call random
                    // noise across the buffer instead, so two calls in the
                    // same page load actually differ.
                    for (let i = 0; i < pixels.length; i += 4) {
                        const delta = (Math.random() < 0.5 ? -1 : 1);
                        pixels[i] = Math.min(255, Math.max(0, pixels[i] + delta));
                    }
                }
            };
        };
        if (typeof WebGLRenderingContext !== 'undefined') hookWebGLReadPixels(WebGLRenderingContext.prototype);
        if (typeof WebGL2RenderingContext !== 'undefined') hookWebGLReadPixels(WebGL2RenderingContext.prototype);
        // -----------------------------------------------------

        // Canvas noise — per-call random (not a fixed ^= 1), so repeated
        // calls in the same page load produce different output. A static
        // toggle just swaps one unique fingerprint for another; it doesn't
        // reduce uniqueness the way genuine per-call randomness does.
        const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;

        const addCanvasNoise = (imgData) => {
            const data = imgData.data;
            for (let i = 0; i < data.length; i += 4) {
                const delta = (Math.random() < 0.5 ? -1 : 1);
                data[i]     = Math.min(255, Math.max(0, data[i]     + delta));
                data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + delta));
                data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + delta));
            }
            return imgData;
        };

        const addWebGLCanvasNoise = (gl) => {
            // toDataURL() on a WebGL canvas serializes whatever is
            // currently in the drawing buffer — there's no putImageData
            // equivalent for WebGL, so nudge one pixel via the scissor
            // test right before serialization, then put GL state back
            // exactly as it was so nothing else on the page notices.
            try {
                const prevScissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
                const prevScissorBox = gl.getParameter(gl.SCISSOR_BOX);
                const prevClearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE);

                const step = 1 / 255; // smallest possible 8-bit channel change
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
                // A canvas can only ever have one context type — once it's
                // WebGL, getContext('2d') above returns null and this branch
                // was silently doing nothing, which is why the WebGL hash
                // never changed even after the canvas one started working.
                const glCtx = this.getContext('webgl2') || this.getContext('webgl') || this.getContext('experimental-webgl');
                if (glCtx) addWebGLCanvasNoise(glCtx);
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

    (document.head || document.documentElement).appendChild(script);
    script.remove();
};

if (document.documentElement) {
    injectScript();
} else {
    document.addEventListener('DOMContentLoaded', injectScript, { once: true });
}

const { ipcRenderer } = require('electron');

// ==========================================
// PRE-EXISTING WEBVIEW KEYBOARD BUBBLING
// ==========================================
window.addEventListener('keydown', (e) => {
    if (e.ctrlKey) {
        const key = e.key.toLowerCase();
        
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
});
