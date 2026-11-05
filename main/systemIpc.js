const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const { app, dialog, clipboard, session, net, webContents } = require('electron');
const security = require('../security');

const appDir = path.resolve(__dirname, '..');

let cachedReaderDistillerCode = null;

function compactMemory() {
    if (typeof global.gc === 'function') {
        try {
            global.gc();
            return true;
        } catch (e) {}
    }
    return false;
}

function initializeMemoryWatcher(options = {}) {
    return setInterval(() => {
        const win = (options && typeof options.getMainWindow === 'function') ? options.getMainWindow() : null;
        if (!win || win.isDestroyed()) return;
        const metrics = app.getAppMetrics();
        let shouldHibernate = false;
        metrics.forEach(metric => {
            // Electron returns residentSet in KiB; 200 * 1024 KiB = 200 MB
            if (metric.type === 'Renderer' && metric.memory.residentSet > 200 * 1024) {
                const wc = webContents.fromId(metric.webContentsId);
                if (wc && !wc.isFocused()) {
                    shouldHibernate = true;
                }
            }
        });
        if (shouldHibernate) {
            win.webContents.send('master-shortcut', 'hibernate-inactive-tabs');
            if (typeof global.gc === 'function') {
                setTimeout(() => { try { global.gc(); } catch (e) {} }, 1000);
            }
        }
    }, 15000);
}

function registerSystemIpc(ipcMain, options = {}) {
    const resolveWindow = () => {
        if (options && typeof options.getMainWindow === 'function') {
            return options.getMainWindow();
        }
        return null;
    };

    const sendNotification = (title, body) => {
        if (options && typeof options.sendNotification === 'function') {
            options.sendNotification(title, body);
        }
    };

    const areNotificationsEnabled = () => {
        if (options && typeof options.areNotificationsEnabled === 'function') {
            return options.areNotificationsEnabled();
        }
        return true;
    };

    ipcMain.on('get-webview-preload-path', (event) => {
        event.returnValue = path.join(appDir, 'webview-preload.js');
    });

    ipcMain.on('get-pdf-viewer-path', (event) => {
        event.returnValue = 'file://' + path.join(appDir, 'assets', 'pdfjs', 'viewer.html');
    });

    ipcMain.on('get-pdf-viewer-url', (event, targetUrl) => {
        event.returnValue = security.mintPdfViewerUrl(targetUrl);
    });

    ipcMain.on('get-whats-new-path', (event) => {
        event.returnValue = 'file://' + path.join(appDir, 'assets', 'whats-new.html');
    });

    ipcMain.on('get-welcome-path', (event) => {
        event.returnValue = 'file://' + path.join(appDir, 'assets', 'welcome.html');
    });

    ipcMain.handle('read-pdf-data', async (event, payload) => {
        const { token, url: sourceUrl } = payload || {};
        if (!sourceUrl || typeof sourceUrl !== 'string') {
            throw new Error('Invalid PDF URL specified.');
        }

        security.validatePdfAccess(token, sourceUrl, event.sender ? event.sender.getURL() : '');

        if (sourceUrl.startsWith('file://') || sourceUrl.startsWith('/')) {
            let filePath = sourceUrl;
            if (sourceUrl.startsWith('file://')) {
                try {
                    filePath = new URL(sourceUrl).pathname;
                } catch (e) {
                    filePath = sourceUrl.replace(/^file:\/\//, '');
                }
            }
            filePath = decodeURIComponent(filePath);
            if (!fs.existsSync(filePath)) {
                throw new Error(`Local file not found: ${filePath}`);
            }
            const data = await fs.promises.readFile(filePath);
            return data;
        }

        if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
            const callerSession = event.sender ? event.sender.session : session.defaultSession;
            const netFetch = (callerSession && callerSession.net && typeof callerSession.net.fetch === 'function')
                ? callerSession.net.fetch.bind(callerSession.net)
                : net.fetch;

            const response = await netFetch(sourceUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch PDF: HTTP ${response.status} ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        }

        if (sourceUrl.startsWith('data:application/pdf;base64,')) {
            const base64Data = sourceUrl.split(',')[1];
            return Buffer.from(base64Data, 'base64');
        }

        throw new Error(`Unsupported protocol for PDF loading: ${sourceUrl}`);
    });

    ipcMain.handle('save-pdf-file', async (event, payload) => {
        try {
            const { token, options: saveOptions } = payload || {};
            const { url, suggestedName, data } = saveOptions || {};

            security.validatePdfAccess(token, url, event.sender ? event.sender.getURL() : '');

            let cleanName = suggestedName || 'document.pdf';
            if (!cleanName.toLowerCase().endsWith('.pdf')) cleanName += '.pdf';

            const defaultSavePath = path.join(app.getPath('downloads'), cleanName);
            const win = resolveWindow();

            const { canceled, filePath } = await dialog.showSaveDialog(win, {
                title: 'Save PDF Document',
                defaultPath: defaultSavePath,
                filters: [
                    { name: 'PDF Documents', extensions: ['pdf'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (canceled || !filePath) {
                return { success: false, canceled: true };
            }

            if (data && (Buffer.isBuffer(data) || data instanceof Uint8Array || ArrayBuffer.isView(data))) {
                await fs.promises.writeFile(filePath, Buffer.from(data));
            } else if (url && (url.startsWith('file://') || url.startsWith('/'))) {
                let srcPath = url.startsWith('file://') ? new URL(url).pathname : url;
                srcPath = decodeURIComponent(srcPath);
                await fs.promises.copyFile(srcPath, filePath);
            } else if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                const callerSession = event.sender ? event.sender.session : session.defaultSession;
                const netFetch = (callerSession && callerSession.net && typeof callerSession.net.fetch === 'function')
                    ? callerSession.net.fetch.bind(callerSession.net)
                    : net.fetch;
                const resp = await netFetch(url);
                const arrayBuf = await resp.arrayBuffer();
                await fs.promises.writeFile(filePath, Buffer.from(arrayBuf));
            } else {
                throw new Error('No PDF payload or valid source URL provided.');
            }

            const stats = await fs.promises.stat(filePath);
            const record = {
                id: `dl_pdf_${Date.now()}`,
                filename: path.basename(filePath),
                totalBytes: stats.size,
                receivedBytes: stats.size,
                state: 'completed',
                savePath: filePath,
                url: url || ''
            };

            if (win && !win.isDestroyed()) {
                win.webContents.send('download-done', record);
            }

            if (areNotificationsEnabled()) {
                sendNotification('PDF Saved', `${path.basename(filePath)} saved successfully.`);
            }

            return { success: true, filePath };
        } catch (err) {
            console.error('Failed to save PDF document:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('read-hinter-code', async () => {
        try {
            const hinterPath = path.join(appDir, 'hinter.js');
            if (fs.existsSync(hinterPath)) return fs.readFileSync(hinterPath, 'utf8');
        } catch (err) {}
        return '';
    });

    ipcMain.handle('read-reader-code', async () => {
        if (cachedReaderDistillerCode) return cachedReaderDistillerCode;
        try {
            const distillerPath = path.join(appDir, 'modules', 'readerDistiller.js');
            if (fs.existsSync(distillerPath)) {
                cachedReaderDistillerCode = fs.readFileSync(distillerPath, 'utf8');
                return cachedReaderDistillerCode;
            }
        } catch (err) {}
        return '';
    });

    ipcMain.on('execute-terminal-command', (event, commandStr) => {
        const sanitised = security.sanitiseTerminalCommand(commandStr);
        if (!sanitised) return;

        clipboard.writeText(sanitised);

        const platform = process.platform;
        if (platform === 'linux') {
            const emulators = ['kitty', 'alacritty', 'foot', 'ghostty', 'wezterm', 'konsole', 'gnome-terminal', 'terminator', 'xfce4-terminal', 'st', 'xterm'];
            exec('which ' + emulators.join(' '), (err, stdout) => {
                let chosenTerm = '';
                if (process.env.TERMINAL) {
                    chosenTerm = process.env.TERMINAL;
                }
                if (!chosenTerm && stdout) {
                    const validPaths = stdout
                        .trim()
                        .split('\n')
                        .map(p => p.trim())
                        .filter(p => p.startsWith('/') && fs.existsSync(p));
                    if (validPaths.length > 0) {
                        chosenTerm = validPaths[0];
                    }
                }
                if (!chosenTerm) {
                    chosenTerm = 'xdg-terminal-exec';
                }
                try {
                    const child = spawn(chosenTerm, [], { detached: true, stdio: 'ignore' });
                    child.on('error', () => {
                        if (chosenTerm !== 'xdg-terminal-exec') {
                            try {
                                const fb = spawn('xdg-terminal-exec', [], { detached: true, stdio: 'ignore' });
                                fb.on('error', () => {});
                                fb.unref();
                            } catch (_) {}
                        }
                    });
                    child.unref();
                } catch (_) {}
            });
        } else if (platform === 'darwin') {
            spawn('open', ['-a', 'Terminal'], { detached: true, stdio: 'ignore' }).unref();
        } else if (platform === 'win32') {
            exec('where wt', (err) => {
                if (!err) {
                    spawn('wt', [], { detached: true, stdio: 'ignore' }).unref();
                } else {
                    spawn('cmd.exe', [], {
                        detached: true,
                        stdio: 'ignore',
                        windowsHide: false
                    }).unref();
                }
            });
        }
    });

    ipcMain.handle('compact-memory', () => {
        return compactMemory();
    });

    ipcMain.on('get-error-page-url', (event, targetUrl, errorCode, errorDesc) => {
        const errorPath = path.join(appDir, 'assets', 'error.html');
        const query = new URLSearchParams({
            url: String(targetUrl || ''),
            code: String(errorCode || ''),
            desc: String(errorDesc || '')
        });
        event.returnValue = `file://${errorPath}?${query.toString()}`;
    });

    ipcMain.handle('trust-certificate-host', async (event, host) => {
        if (!host || typeof host !== 'string' || host.length > 255) return false;
        const cleanHost = host.trim().toLowerCase();
        security.addTrustedCertificate(cleanHost);
        try {
            const { loadBrowserConfig, writeConfigFile } = require('./config');
            const cfg = loadBrowserConfig();
            const existing = Array.isArray(cfg.trusted_certificates) ? cfg.trusted_certificates : [];
            if (!existing.includes(cleanHost)) {
                existing.push(cleanHost);
                cfg.trusted_certificates = existing;
                writeConfigFile(cfg);
            }
        } catch (_) {}
        return true;
    });

    ipcMain.on('is-local-or-private-host', (event, host) => {
        event.returnValue = security.isLocalOrPrivateHost(host);
    });
}

module.exports = {
    registerSystemIpc,
    initializeMemoryWatcher,
    compactMemory
};
