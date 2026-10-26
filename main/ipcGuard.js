// main/ipcGuard.js
// Sender verification guard for Electron ipcMain handlers

const GUEST_CHANNELS = Object.freeze([
    'gm-xmlhttprequest',
    'gm-storage-set',
    'gm-storage-delete',
    'gm-storage-get',
    'get-pdf-viewer-path',
    'read-pdf-data',
    'save-pdf-file',
    'is-trusted-domain',
    'get-webrtc-policy',
    'get-google-signin-user-agent',
    '@ghostery/adblocker/inject-cosmetic-filters',
    '@ghostery/adblocker/is-mutation-observer-enabled',
    '@ghostery/adblocker/cosmetic-filters'
]);

const IS_GUARDED = Symbol('miseIpcGuarded');

function isFromHost(event, getMainWindow) {
    if (!event || !event.sender || typeof getMainWindow !== 'function') {
        return false;
    }

    let win = null;
    try {
        win = getMainWindow();
    } catch (_) {
        return false;
    }

    if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) {
        return false;
    }

    if (!win.webContents || event.sender !== win.webContents) {
        return false;
    }

    if (event.senderFrame === null) {
        return false;
    }

    if (event.senderFrame !== undefined && event.senderFrame !== event.sender.mainFrame) {
        return false;
    }

    return true;
}

function installIpcGuard(ipcMain, options = {}) {
    if (!ipcMain || ipcMain[IS_GUARDED]) {
        return;
    }
    ipcMain[IS_GUARDED] = true;

    const { getMainWindow, guestChannels = GUEST_CHANNELS, mode } = options;
    const allowedGuestSet = new Set(guestChannels);

    const getActiveMode = () => {
        if (mode !== undefined) {
            return mode;
        }
        return process.env.MISE_IPC_GUARD === 'warn' ? 'warn' : 'enforce';
    };

    const isAllowed = (channel, event) => {
        if (allowedGuestSet.has(channel)) {
            return true;
        }
        return isFromHost(event, getMainWindow);
    };

    const origHandle = ipcMain.handle.bind(ipcMain);
    const origHandleOnce = ipcMain.handleOnce.bind(ipcMain);
    const origOn = ipcMain.on.bind(ipcMain);
    const origOnce = ipcMain.once.bind(ipcMain);

    function wrapHandler(channel, listener) {
        if (typeof listener !== 'function') {
            return listener;
        }
        return function guardedHandler(event, ...args) {
            if (!isAllowed(channel, event)) {
                if (getActiveMode() === 'warn') {
                    console.warn('[ipc-guard] would deny', channel);
                } else {
                    throw new Error('Forbidden');
                }
            }
            return listener.call(this, event, ...args);
        };
    }

    function wrapEvent(channel, listener) {
        if (typeof listener !== 'function') {
            return listener;
        }
        return function guardedListener(event, ...args) {
            if (!isAllowed(channel, event)) {
                if (getActiveMode() === 'warn') {
                    console.warn('[ipc-guard] would deny', channel);
                } else {
                    if (event && typeof event === 'object') {
                        try {
                            event.returnValue = null;
                        } catch (_) {}
                    }
                    return;
                }
            }
            return listener.call(this, event, ...args);
        };
    }

    ipcMain.handle = function(channel, listener) {
        return origHandle(channel, wrapHandler(channel, listener));
    };

    ipcMain.handleOnce = function(channel, listener) {
        return origHandleOnce(channel, wrapHandler(channel, listener));
    };

    ipcMain.on = function(channel, listener) {
        return origOn(channel, wrapEvent(channel, listener));
    };

    ipcMain.once = function(channel, listener) {
        return origOnce(channel, wrapEvent(channel, listener));
    };
}

module.exports = {
    installIpcGuard,
    GUEST_CHANNELS,
    isFromHost
};
