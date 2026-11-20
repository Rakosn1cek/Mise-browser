const path = require('path');
const { session } = require('electron');
const security = require('../security');
const diagnostics = require('../diagnostics');
const { logVisit, updateVisitTitle } = require('./storage');
const keybinds = require('../keybinds');
const { showWebviewContextMenu } = require('./contextMenus');

const appDir = path.resolve(__dirname, '..');
const allowedAssetsDir = path.resolve(appDir, 'assets');

const ephemeralWebContents = new WeakSet();
const sessionPartitionMap = new WeakMap();
const pendingEphemeralEntries = [];
const verifiedEphemeralQueue = [];

function pruneExpiredEphemeralEntries(now = Date.now()) {
    for (let i = pendingEphemeralEntries.length - 1; i >= 0; i--) {
        if (now > pendingEphemeralEntries[i].expiresAt) {
            pendingEphemeralEntries.splice(i, 1);
        }
    }
    for (let i = verifiedEphemeralQueue.length - 1; i >= 0; i--) {
        if (now > verifiedEphemeralQueue[i].expiresAt) {
            verifiedEphemeralQueue.splice(i, 1);
        }
    }
}

function markNextWebviewEphemeral(expectedUrl = null) {
    const now = Date.now();
    pruneExpiredEphemeralEntries(now);
    const cleanUrl = (typeof expectedUrl === 'string' && expectedUrl.trim()) ? expectedUrl.trim() : null;
    pendingEphemeralEntries.push({ expectedUrl: cleanUrl, expiresAt: now + 5000 });
}

function consumeEphemeralOnAttach(srcUrl) {
    pruneExpiredEphemeralEntries();
    if (!srcUrl || typeof srcUrl !== 'string') return;
    const idx = pendingEphemeralEntries.findIndex(e => e.expectedUrl && e.expectedUrl === srcUrl);
    if (idx !== -1) {
        const [entry] = pendingEphemeralEntries.splice(idx, 1);
        verifiedEphemeralQueue.push({ expectedUrl: entry.expectedUrl, expiresAt: Date.now() + 5000 });
    }
}

function consumeEphemeralOnCreated(wcUrl) {
    pruneExpiredEphemeralEntries();
    if (verifiedEphemeralQueue.length > 0) {
        const matchIdx = wcUrl
            ? verifiedEphemeralQueue.findIndex(e => e.expectedUrl === wcUrl)
            : 0;
        if (matchIdx !== -1) {
            verifiedEphemeralQueue.splice(matchIdx, 1);
            return true;
        }
        if (!wcUrl) {
            verifiedEphemeralQueue.shift();
            return true;
        }
    }
    const idx = pendingEphemeralEntries.findIndex(e => {
        if (e.expectedUrl === null) return true;
        return Boolean(wcUrl && e.expectedUrl === wcUrl);
    });
    if (idx !== -1) {
        pendingEphemeralEntries.splice(idx, 1);
        return true;
    }
    return false;
}

function isEphemeralWebContents(wc) {
    return ephemeralWebContents.has(wc);
}

function attachWebviewSecurityGuards(windowWebContents, options = {}) {
    if (!windowWebContents) return;

    windowWebContents.on('will-attach-webview', (event, webPreferences, params) => {
        const attachDecision = security.prepareWebviewAttach(webPreferences, params, {
            preloadPath: path.join(appDir, 'webview-preload.js')
        });
        if (!attachDecision.allowed) {
            event.preventDefault();
            diagnostics.logEvent('warn', 'security', 'Blocked webview attach', { reason: attachDecision.reason });
            return;
        }
        if (params && typeof params.src === 'string') {
            consumeEphemeralOnAttach(params.src);
        }
        const partitionStr = (webPreferences && webPreferences.partition) || (params && params.partition);
        if (partitionStr) {
            const targetSess = session.fromPartition(partitionStr);
            sessionPartitionMap.set(targetSess, partitionStr);
            if (options && typeof options.configureAndHardenSession === 'function') {
                options.configureAndHardenSession(targetSess);
            }
        }
    });
}

function setupWebContentsPolicy(app, options = {}) {
    const resolveMainWindow = () => {
        if (options && typeof options.getMainWindow === 'function') {
            return options.getMainWindow();
        }
        return null;
    };

    app.on('web-contents-created', (event, webContents) => {
        if (webContents.session && options && typeof options.configureAndHardenSession === 'function') {
            options.configureAndHardenSession(webContents.session);
        }

        if (webContents.getType() === 'webview') {
            webContents.setMaxListeners(30);

            const wcUrl = typeof webContents.getURL === 'function' ? webContents.getURL() : '';
            if (consumeEphemeralOnCreated(wcUrl)) {
                ephemeralWebContents.add(webContents);
            }
            const isPrivate = webContents.session === session.fromPartition('MisePrivateProfile');
            const isEphemeral = ephemeralWebContents.has(webContents);

            webContents.on('will-navigate', (navEvent, navigationUrl) => {
                if (!navigationUrl || typeof navigationUrl !== 'string') {
                    navEvent.preventDefault();
                    return;
                }

                if (navigationUrl === 'about:blank') return;

                if (security.isSafeTabUrl(navigationUrl)) return;

                // Block remote origins from pivoting to local file schemes
                const currentUrl = webContents.getURL();
                if (currentUrl && (currentUrl.startsWith('http://') || currentUrl.startsWith('https://'))) {
                    if (navigationUrl.startsWith('file:') || navigationUrl.startsWith('/')) {
                        navEvent.preventDefault();
                        diagnostics.logEvent('warn', 'navigation', 'Blocked cross-scheme navigation from remote origin to local file', { from: currentUrl, to: navigationUrl });
                        return;
                    }
                }

                // Allow local application asset pages such as vendored PDF viewer and welcome documentation
                try {
                    const parsed = new URL(navigationUrl);
                    if (parsed.protocol === 'file:') {
                        const targetFilePath = path.resolve(decodeURIComponent(parsed.pathname));
                        if (targetFilePath.startsWith(allowedAssetsDir + path.sep)) {
                            return;
                        }
                        if (security.isAllowedLocalDocumentUrl(navigationUrl)) {
                            return;
                        }
                    }
                } catch (e) {}

                navEvent.preventDefault();
                diagnostics.logEvent('warn', 'navigation', 'Blocked unsafe webview navigation', { url: navigationUrl });
            });

            webContents.on('will-frame-navigate', (event) => {
                const targetUrl = event.url;
                if (!targetUrl || typeof targetUrl !== 'string') {
                    event.preventDefault();
                    return;
                }
                if (targetUrl === 'about:blank') return;
                if (security.isSafeTabUrl(targetUrl)) return;
                try {
                    const parsed = new URL(targetUrl);
                    if (parsed.protocol === 'file:') {
                        const targetFilePath = path.resolve(decodeURIComponent(parsed.pathname));
                        if (targetFilePath.startsWith(allowedAssetsDir + path.sep)) {
                            return;
                        }
                        if (security.isAllowedLocalDocumentUrl(targetUrl)) {
                            return;
                        }
                    }
                } catch (_) {}
                event.preventDefault();
                diagnostics.logEvent('warn', 'navigation', 'Blocked unsafe subframe navigation', { url: targetUrl });
            });

            let lastCommittedUrl = '';
            let lastCommittedTitle = '';

            webContents.on('did-navigate', (navEvent, url) => {
                if (!isPrivate && !isEphemeral) {
                    const rawTitle = typeof webContents.getTitle === 'function' ? webContents.getTitle() : '';
                    // Avoid inheriting the outgoing page title before the new document parses its <title>
                    const effectiveTitle = (lastCommittedUrl && url !== lastCommittedUrl && rawTitle === lastCommittedTitle) ? '' : rawTitle;
                    logVisit(effectiveTitle, url);
                }
                lastCommittedUrl = url || '';
                if (url) {
                    try {
                        const parsedUrl = new URL(url);
                        if ((parsedUrl.hostname === 'accounts.google.com' || parsedUrl.hostname.endsWith('.accounts.google.com')) &&
                            parsedUrl.pathname.includes('signin/rejected')) {
                            security.clearGoogleAuthCookies(webContents.session);
                        }
                    } catch (e) {
                        // Ignore URL parsing errors
                    }
                }
            });

            webContents.on('did-navigate-in-page', (navEvent, url, isMainFrame) => {
                if (isMainFrame === false) return;
                if (!isPrivate && !isEphemeral) {
                    logVisit(typeof webContents.getTitle === 'function' ? webContents.getTitle() : '', url);
                }
                lastCommittedUrl = url || '';
            });

            webContents.on('page-title-updated', (titleEvent, title) => {
                lastCommittedTitle = title || '';
                if (!isPrivate && !isEphemeral) {
                    const currentUrl = (typeof webContents.getURL === 'function' && webContents.getURL()) || lastCommittedUrl;
                    updateVisitTitle(title, currentUrl);
                }
            });

            webContents.on('context-menu', (contextEvent, params) => {
                showWebviewContextMenu(contextEvent, params, webContents, {
                    getMainWindow: resolveMainWindow
                });
            });

            webContents.setWindowOpenHandler((details) => {
                if (details.url && details.url !== 'about:blank') {
                    if (security.isSafeTabUrl(details.url)) {
                        const currentUrl = typeof webContents.getURL === 'function' ? webContents.getURL() : '';
                        if (currentUrl && details.url) {
                            try {
                                const cur = new URL(currentUrl);
                                const tgt = new URL(details.url);
                                if (cur.origin === tgt.origin && cur.pathname === tgt.pathname && cur.search === tgt.search) {
                                    return { action: 'deny' };
                                }
                            } catch (_) {}
                        }
                        const win = resolveMainWindow();
                        if (win && win.webContents) {
                            const openerPartition = webContents.session === session.fromPartition('MisePrivateProfile')
                                ? 'MisePrivateProfile'
                                : (sessionPartitionMap.get(webContents.session) || null);
                            if (openerPartition) {
                                win.webContents.send('master-shortcut', 'spawn-tab-with-url', details.url, openerPartition);
                            } else {
                                win.webContents.send('master-shortcut', 'spawn-tab-with-url', details.url);
                            }
                        }
                    } else {
                        let scheme = 'unknown';
                        try {
                            scheme = new URL(details.url).protocol;
                        } catch (e) {
                            if (typeof details.url === 'string') {
                                scheme = details.url.split(':')[0] || 'unknown';
                            }
                        }
                        diagnostics.logEvent('warn', 'navigation', 'Blocked popup URL', { scheme });
                    }
                }
                return { action: 'deny' };
            });

            webContents.on('before-input-event', (inputEvent, input) => {
                if (input.type !== 'keyDown') return;
                const win = resolveMainWindow();
                if (!win || !win.webContents) return;

                const action = keybinds.getActionForInput(input);
                if (action && options && typeof options.handleAppAction === 'function') {
                    inputEvent.preventDefault();
                    options.handleAppAction(action, webContents);
                }
            });

            webContents.on('render-process-gone', (event, details) => {
                diagnostics.logEvent('error', 'webview', `Webview render process terminated: reason=${details.reason} exitCode=${details.exitCode}`);
            });

            webContents.on('unresponsive', () => {
                diagnostics.logEvent('warn', 'performance', 'Webview became unresponsive');
            });

            webContents.on('responsive', () => {
                diagnostics.logEvent('info', 'performance', 'Webview regained responsiveness');
            });

            webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
                if (errorCode === -3) return;
                diagnostics.logEvent('warn', 'network', `Navigation failed: code=${errorCode} description=${errorDescription}`, { url: validatedURL });
            });
        }
    });

    app.on('render-process-gone', (event, wc, details) => {
        diagnostics.logEvent('error', 'process', `Render process gone: reason=${details.reason} exitCode=${details.exitCode}`);
    });

    app.on('child-process-gone', (event, details) => {
        diagnostics.logEvent('warn', 'process', `Child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
    });

    app.on('certificate-error', (event, webContents, url, error, certificate, callback, isMainFrame) => {
        let topLevelUrl = '';
        try {
            if (webContents && typeof webContents.getURL === 'function') {
                topLevelUrl = webContents.getURL();
            }
        } catch (_) {}

        if (security.isCertificateAllowed(url, { isMainFrame, topLevelUrl })) {
            event.preventDefault();
            try {
                const parsed = new URL(url);
                diagnostics.logEvent('info', 'security', `Permitted certificate exception for ${parsed.hostname}`, { error });
            } catch (_) {}
            callback(true);
            return;
        }

        diagnostics.logEvent('warn', 'security', `Rejected untrusted certificate for ${url}`, { error });
        callback(false);
    });
}

module.exports = {
    setupWebContentsPolicy,
    attachWebviewSecurityGuards,
    markNextWebviewEphemeral,
    isEphemeralWebContents
};
