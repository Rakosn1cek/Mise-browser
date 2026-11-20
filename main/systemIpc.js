const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const { app, dialog, clipboard, session, net, webContents } = require('electron');
const security = require('../security');
const config = require('./config');
const mediaOffload = require('./mediaOffload');
const updater = require('./updater');

const appDir = path.resolve(__dirname, '..');

let cachedReaderDistillerCode = null;
let cachedHinterCode = null;

function compactMemory() {
    if (typeof global.gc === 'function') {
        try {
            global.gc();
            return true;
        } catch (e) {}
    }
    return false;
}

/**
 * Reads Linux procfs smaps_rollup for accurate PSS, RSS, and USS memory figures in KiB.
 */
async function readProcSmapsRollup(pid, fsModule = fs, options = {}) {
    const targetPlatform = options.platform || process.platform;
    if (targetPlatform !== 'linux') return null;

    const numericPid = Number(pid);
    if (!Number.isInteger(numericPid) || numericPid <= 0) return null;

    const procPath = `/proc/${numericPid}/smaps_rollup`;
    let content = '';
    try {
        if (fsModule.promises && typeof fsModule.promises.readFile === 'function') {
            content = await fsModule.promises.readFile(procPath, 'utf8');
        } else if (typeof fsModule.readFileSync === 'function') {
            content = fsModule.readFileSync(procPath, 'utf8');
        } else {
            return null;
        }
    } catch (_) {
        return null;
    }

    if (!content || typeof content !== 'string') return null;

    let rssKB = 0;
    let pssKB = 0;
    let ussKB = 0;
    let sharedKB = 0;

    const lines = content.split('\n');
    for (const line of lines) {
        const match = line.match(/^(Rss|Pss|Private_Clean|Private_Dirty|Shared_Clean|Shared_Dirty):\s+(\d+)/);
        if (!match) continue;
        const key = match[1];
        const val = parseInt(match[2], 10) || 0;
        if (key === 'Rss') {
            rssKB = val;
        } else if (key === 'Pss') {
            pssKB = val;
        } else if (key === 'Private_Clean' || key === 'Private_Dirty') {
            ussKB += val;
        } else if (key === 'Shared_Clean' || key === 'Shared_Dirty') {
            sharedKB += val;
        }
    }

    if (rssKB <= 0 && pssKB <= 0) return null;
    return { rssKB, pssKB, ussKB, sharedKB };
}

/**
 * Collects live process CPU and memory metrics alongside webContents process mappings.
 */
async function gatherTaskManagerMetrics(options = {}) {
    const targetApp = options.app || app;
    const targetWebContents = options.webContents || webContents;
    const targetFs = options.fs || fs;
    const targetPlatform = options.platform || process.platform;

    let appMetrics = [];
    try {
        if (targetApp && typeof targetApp.getAppMetrics === 'function') {
            appMetrics = targetApp.getAppMetrics() || [];
        }
    } catch (_) {
        appMetrics = [];
    }

    const processesByPid = new Map();
    for (const metric of appMetrics) {
        if (!metric || !metric.pid) continue;
        const pid = metric.pid;
        if (processesByPid.has(pid)) continue;

        const type = metric.type || 'Unknown';
        const rawCpu = (metric.cpu && typeof metric.cpu.percentCPUUsage === 'number')
            ? metric.cpu.percentCPUUsage
            : 0;
        const cpuPercent = Math.max(0, Math.round(rawCpu * 10) / 10);

        const fallbackRssKB = (metric.memory && typeof metric.memory.residentSet === 'number')
            ? metric.memory.residentSet
            : ((metric.memory && typeof metric.memory.workingSetSize === 'number') ? metric.memory.workingSetSize : 0);
        const fallbackPrivateKB = (metric.memory && typeof metric.memory.privateBytes === 'number' && metric.memory.privateBytes > 0)
            ? metric.memory.privateBytes
            : fallbackRssKB;

        processesByPid.set(pid, {
            pid,
            type,
            cpuPercent,
            fallbackRssKB,
            fallbackPrivateKB
        });
    }

    const procEntries = Array.from(processesByPid.values());
    const smapsResults = await Promise.all(
        procEntries.map((entry) => readProcSmapsRollup(entry.pid, targetFs, { platform: targetPlatform }))
    );

    let totalPssKB = 0;
    let totalRssKB = 0;
    let totalUssKB = 0;
    let sumCpuPercent = 0;

    procEntries.forEach((entry, idx) => {
        const smaps = smapsResults[idx];
        const pssKB = smaps ? smaps.pssKB : entry.fallbackPrivateKB;
        const rssKB = smaps ? smaps.rssKB : entry.fallbackRssKB;
        const ussKB = smaps ? smaps.ussKB : entry.fallbackPrivateKB;

        totalPssKB += pssKB;
        totalRssKB += rssKB;
        totalUssKB += ussKB;
        sumCpuPercent += entry.cpuPercent;

        processesByPid.set(entry.pid, {
            pid: entry.pid,
            type: entry.type,
            cpuPercent: entry.cpuPercent,
            pssKB,
            rssKB,
            ussKB,
            pssMB: Math.round((pssKB / 1024) * 10) / 10,
            rssMB: Math.round((rssKB / 1024) * 10) / 10,
            ussMB: Math.round((ussKB / 1024) * 10) / 10
        });
    });

    const webContentsMap = {};
    try {
        if (targetWebContents && typeof targetWebContents.getAllWebContents === 'function') {
            const allWc = targetWebContents.getAllWebContents() || [];
            for (const wc of allWc) {
                if (!wc) continue;
                try {
                    if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) continue;
                    const id = wc.id;
                    if (id === undefined || id === null) continue;

                    let osPid = null;
                    try {
                        if (typeof wc.getOSProcessId === 'function') {
                            osPid = wc.getOSProcessId();
                        }
                    } catch (_) {
                        osPid = null;
                    }

                    let wcType = '';
                    try {
                        if (typeof wc.getType === 'function') {
                            wcType = wc.getType() || '';
                        }
                    } catch (_) {}

                    let wcUrl = '';
                    try {
                        if (typeof wc.getURL === 'function') {
                            wcUrl = wc.getURL() || '';
                        }
                    } catch (_) {}

                    let wcTitle = '';
                    try {
                        if (typeof wc.getTitle === 'function') {
                            wcTitle = wc.getTitle() || '';
                        }
                    } catch (_) {}

                    const procInfo = osPid ? processesByPid.get(osPid) : null;
                    webContentsMap[id] = {
                        webContentsId: id,
                        pid: osPid || (procInfo ? procInfo.pid : null),
                        type: wcType || (procInfo ? procInfo.type : ''),
                        url: wcUrl,
                        title: wcTitle,
                        cpuPercent: procInfo ? procInfo.cpuPercent : 0,
                        pssMB: procInfo ? procInfo.pssMB : 0,
                        rssMB: procInfo ? procInfo.rssMB : 0,
                        ussMB: procInfo ? procInfo.ussMB : 0
                    };
                } catch (_) {}
            }
        }
    } catch (_) {}

    return {
        timestamp: Date.now(),
        totals: {
            pssMB: Math.round((totalPssKB / 1024) * 10) / 10,
            rssMB: Math.round((totalRssKB / 1024) * 10) / 10,
            ussMB: Math.round((totalUssKB / 1024) * 10) / 10,
            cpuPercent: Math.round(sumCpuPercent * 10) / 10,
            processCount: processesByPid.size
        },
        processes: Array.from(processesByPid.values()),
        webContentsMap
    };
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

    updater.setMainWindowGetter(resolveWindow);

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
        if (cachedHinterCode) return cachedHinterCode;
        try {
            const hinterPath = path.join(appDir, 'hinter.js');
            if (fs.existsSync(hinterPath)) {
                cachedHinterCode = fs.readFileSync(hinterPath, 'utf8');
                return cachedHinterCode;
            }
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
        let hostOnly = cleanHost;
        try {
            hostOnly = new URL('https://' + cleanHost).hostname.toLowerCase();
        } catch (_) {}
        if (security.isLocalOrPrivateHost(hostOnly)) {
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
        }
        return true;
    });

    ipcMain.on('is-certificate-trusted-host', (event, host) => {
        if (!host || typeof host !== 'string') {
            event.returnValue = false;
            return;
        }
        const cleanHost = host.trim().toLowerCase();
        let hostOnly = cleanHost;
        try {
            hostOnly = new URL('https://' + cleanHost).hostname.toLowerCase();
        } catch (_) {}
        const trusted = security.getTrustedCertificates();
        event.returnValue = trusted.includes(cleanHost) || trusted.includes(hostOnly);
    });

    ipcMain.on('is-local-or-private-host', (event, host) => {
        event.returnValue = security.isLocalOrPrivateHost(host);
    });

    ipcMain.on('validate-local-document-path', (event, inputPath) => {
        event.returnValue = security.validateLocalDocumentPath(inputPath);
    });

    ipcMain.on('is-allowed-local-document-url', (event, url) => {
        event.returnValue = security.isAllowedLocalDocumentUrl(url);
    });

    ipcMain.handle('get-media-offload-status', () => {
        return mediaOffload.detectMediaBinaries();
    });

    ipcMain.on('is-candidate-media-url', (event, url) => {
        event.returnValue = mediaOffload.isCandidateMediaUrl(url);
    });

    ipcMain.handle('launch-media-offload', async (event, targetUrl) => {
        const cfg = config.loadBrowserConfig();
        if (cfg.media_offload_enabled === false) {
            return { success: false, error: 'Media offload is disabled in browser preferences.' };
        }

        const result = mediaOffload.spawnMpvProcess(targetUrl, {
            quality: cfg.media_offload_quality || '1080p'
        });

        if (result.success) {
            const win = resolveWindow();
            if (win && !win.isDestroyed()) {
                if (cfg.media_offload_pause_tab) {
                    win.webContents.send('master-shortcut', 'pause-media-offload-tab', result.url);
                }
            }
            if (areNotificationsEnabled()) {
                sendNotification('mpv Media Offload', 'Playing media stream in mpv');
            }
        }

        return result;
    });

    ipcMain.handle('get-task-manager-metrics', async () => {
        return gatherTaskManagerMetrics();
    });
}

module.exports = {
    registerSystemIpc,
    initializeMemoryWatcher,
    compactMemory,
    readProcSmapsRollup,
    gatherTaskManagerMetrics
};
