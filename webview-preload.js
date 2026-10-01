// webview-preload.js

const { ipcRenderer, webFrame } = require('electron');

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

if (!isTrustedSite) {
    const codeToInject = `(function() {
        if (window.__miseFingerprintPatchesApplied) return;
        window.__miseFingerprintPatchesApplied = true;

        // Privacy signals
        Object.defineProperty(navigator, 'doNotTrack', { get: () => '1', configurable: true });
        Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true, configurable: true });

        // Domain-bound hardware specification standardisation
        const hostStr = String(window.location.hostname || '');
        let hostHash = 0;
        for (let i = 0; i < hostStr.length; i++) {
            hostHash = (Math.imul(31, hostHash) + hostStr.charCodeAt(i)) | 0;
        }
        hostHash = Math.abs(hostHash);

        const domainConcurrency = (hostHash % 2 === 0) ? 8 : 12;
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => domainConcurrency, configurable: true });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
        Object.defineProperty(navigator, 'platform', { get: () => 'Linux x86_64', configurable: true });
        Object.defineProperty(navigator, 'language', { get: () => 'en-GB', configurable: true });
        Object.defineProperty(navigator, 'languages', { get: () => Object.freeze(['en-GB', 'en-US', 'en']), configurable: true });

        // Domain-bound plugin farbling for cross-domain randomization detection
        try {
            if (navigator.plugins && navigator.plugins.length) {
                const isEvenDomain = (hostHash % 2 === 0);
                const origPlugin0 = navigator.plugins[0];
                if (origPlugin0) {
                    const descSuffix = isEvenDomain ? ' ' : '';
                    const proxiedPlugin0 = new Proxy(origPlugin0, {
                        get(target, prop) {
                            if (prop === 'description') {
                                return target.description + descSuffix;
                            }
                            return target[prop];
                        }
                    });
                    const proxiedPlugins = new Proxy(navigator.plugins, {
                        get(target, prop) {
                            if (prop === '0' || prop === 0) return proxiedPlugin0;
                            return target[prop];
                        }
                    });
                    Object.defineProperty(navigator, 'plugins', { get: () => proxiedPlugins, configurable: true });
                }
            }
        } catch (e) {}

        // User Agent standardisation matching stable Chrome releases
        const cleanUserAgent = (navigator.userAgent || '')
            .replace(/mise-browser\\/[0-9.]+\\s*/gi, '')
            .replace(/Electron\\/[0-9.]+\\s*/gi, '')
            .replace(/Chrome\\/[0-9.]+/i, 'Chrome/153.0.0.0')
            .trim();
        Object.defineProperty(navigator, 'userAgent', { get: () => cleanUserAgent, configurable: true });
        Object.defineProperty(navigator, 'appVersion', { get: () => cleanUserAgent.replace(/^Mozilla\\//, ''), configurable: true });

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
                            { brand: 'Chromium', version: '153' },
                            { brand: 'Google Chrome', version: '153' },
                            { brand: 'Not_A Brand', version: '24' }
                        ],
                        mobile: false,
                        platform: 'Linux',
                        getHighEntropyValues: function(hints) {
                            return Promise.resolve({
                                architecture: 'x86',
                                bitness: '64',
                                brands: [
                                    { brand: 'Chromium', version: '153' },
                                    { brand: 'Google Chrome', version: '153' }
                                ],
                                mobile: false,
                                model: '',
                                platform: 'Linux',
                                platformVersion: '',
                                uaFullVersion: '153.0.0.0'
                            });
                        },
                        toJSON: function() {
                            return {
                                brands: [
                                    { brand: 'Chromium', version: '153' },
                                    { brand: 'Google Chrome', version: '153' }
                                ],
                                mobile: false,
                                platform: 'Linux'
                            };
                        }
                    };
                }
            });
        }

        // WebGL Spoofing and Extension Shuffle on prototypes (matching Brave's Brave~Brave baseline)
        const spoofWebGlPrototype = (proto) => {
            if (!proto || !proto.getParameter) return;
            const origGetParam = proto.getParameter;
            proto.getParameter = function(param) {
                if (param === 37445 || param === 0x9245) return 'Brave';
                if (param === 37446 || param === 0x9246) return 'Brave';
                if (param === 7936 || param === 0x1F00) return 'WebKit';
                if (param === 7937 || param === 0x1F01) return 'WebKit WebGL';
                return origGetParam.apply(this, arguments);
            };

            const origGetExt = proto.getExtension;
            proto.getExtension = function(name) {
                if (name === 'WEBGL_debug_renderer_info') {
                    return {
                        UNMASKED_VENDOR_WEBGL: 37445,
                        UNMASKED_RENDERER_WEBGL: 37446
                    };
                }
                return origGetExt.apply(this, arguments);
            };

            const origGetSupportedExtensions = proto.getSupportedExtensions;
            proto.getSupportedExtensions = function() {
                const list = origGetSupportedExtensions.apply(this, arguments);
                if (!list) return list;
                const shuffled = list.slice();
                let seed = hostHash;
                for (let i = shuffled.length - 1; i > 0; i--) {
                    seed = (Math.imul(seed, 9301) + 49297) % 233280;
                    const j = Math.floor((seed / 233280) * (i + 1));
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                }
                return shuffled;
            };

            if (proto.readPixels) {
                const origReadPixels = proto.readPixels;
                proto.readPixels = function() {
                    origReadPixels.apply(this, arguments);
                    const pixels = arguments[6];
                    if (pixels && pixels.length) {
                        const delta = (hostHash % 2 === 0 ? 1 : -1);
                        for (let i = 0; i < pixels.length; i += 32) {
                            pixels[i] = Math.min(255, Math.max(0, pixels[i] + delta));
                        }
                    }
                };
            }
        };

        if (typeof WebGLRenderingContext !== 'undefined') spoofWebGlPrototype(WebGLRenderingContext.prototype);
        if (typeof WebGL2RenderingContext !== 'undefined') spoofWebGlPrototype(WebGL2RenderingContext.prototype);

        // Canvas Farbling (Domain-bound noise)
        const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        const origToBlob = HTMLCanvasElement.prototype.toBlob;

        const applyCanvasNoise = (canvas) => {
            try {
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                const w = Math.min(canvas.width, 256);
                const h = Math.min(canvas.height, 64);
                if (w <= 0 || h <= 0) return;

                const imgData = origGetImageData.call(ctx, 0, 0, w, h);
                const d = imgData.data;
                let touched = 0;
                const step = 4 * (1 + (hostHash % 3));
                const start = 4 * (hostHash % 4);
                const delta = (hostHash % 2 === 0 ? 1 : -1);

                for (let i = start; i < d.length; i += step) {
                    if (d[i + 3] > 0) {
                        d[i] = Math.min(255, Math.max(0, d[i] + delta));
                        touched++;
                        if (touched >= 30) break;
                    }
                }
                if (touched === 0 && d.length >= 4) {
                    d[0] = (hostHash % 250) + 1;
                    d[3] = 1;
                }
                ctx.putImageData(imgData, 0, 0);
            } catch (e) {}
        };

        HTMLCanvasElement.prototype.toDataURL = function() {
            try {
                const ctx2d = this.getContext('2d');
                if (ctx2d) {
                    applyCanvasNoise(this);
                } else {
                    const gl = this.getContext('webgl2') || this.getContext('webgl') || this.getContext('experimental-webgl');
                    if (gl && typeof gl.clear === 'function') {
                        const prevScissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
                        const prevScissorBox = gl.getParameter(gl.SCISSOR_BOX);
                        gl.enable(gl.SCISSOR_TEST);
                        gl.scissor(0, 0, 1, 1);
                        const jitterColor = ((hostHash % 17) + 1) * 0.002;
                        gl.clearColor(jitterColor, jitterColor, jitterColor, 0.02);
                        gl.clear(gl.COLOR_BUFFER_BIT);
                        gl.scissor(prevScissorBox[0], prevScissorBox[1], prevScissorBox[2], prevScissorBox[3]);
                        if (!prevScissorEnabled) gl.disable(gl.SCISSOR_TEST);
                    }
                }
            } catch (e) {}
            return origToDataURL.apply(this, arguments);
        };

        HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
            try {
                const ctx2d = this.getContext('2d');
                if (ctx2d) {
                    applyCanvasNoise(this);
                }
            } catch (e) {}
            return origToBlob.apply(this, arguments);
        };

        CanvasRenderingContext2D.prototype.getImageData = function() {
            const imgData = origGetImageData.apply(this, arguments);
            if (imgData && imgData.data) {
                const d = imgData.data;
                const step = 4 * (1 + (hostHash % 3));
                const start = 4 * (hostHash % 4);
                const delta = (hostHash % 2 === 0 ? 1 : -1);
                for (let i = start; i < d.length; i += step) {
                    if (d[i + 3] > 0) {
                        d[i] = Math.min(255, Math.max(0, d[i] + delta));
                    }
                }
            }
            return imgData;
        };

        // Audio Farbling
        if (typeof AudioBuffer !== 'undefined') {
            const origGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function(channel) {
                const results = origGetChannelData.apply(this, arguments);
                if (results && results.length >= 100) {
                    const start = Math.min(results.length - 1, 4500);
                    const end = Math.min(results.length, 5000);
                    const jitter = ((hostHash % 29) + 1) * 0.000002;
                    for (let i = start; i < end; i += 5) {
                        results[i] = results[i] + jitter;
                    }
                }
                return results;
            };
        }
    })();`;

    try {
        webFrame.executeJavaScript(codeToInject);
    } catch (e) {
        console.error('Failed to inject privacy spoofing script:', e);
    }
}

// Guest input focus tracking for Insert mode indicator
document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        try { ipcRenderer.sendToHost('guest-input-focus', true); } catch (err) {}
    }
}, true);

document.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        try { ipcRenderer.sendToHost('guest-input-focus', false); } catch (err) {}
    }
}, true);

// Guest hints tracking for Hints mode indicator
try {
    const notifyHintsState = () => {
        const active = !!document.getElementById('mise-hint-layer');
        try { ipcRenderer.sendToHost('guest-hints-state', active); } catch (err) {}
    };

    const attachHintObserver = () => {
        if (!document.body) return;
        const observer = new MutationObserver(notifyHintsState);
        observer.observe(document.body, { childList: true });
    };

    if (document.body) {
        attachHintObserver();
    } else {
        document.addEventListener('DOMContentLoaded', attachHintObserver);
    }
} catch (err) {}
