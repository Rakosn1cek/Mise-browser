const path = require('path');
const fs = require('fs');
const { spawn, spawnSync, execSync } = require('child_process');
const { shell } = require('electron');

const activeDownloads = new Map();
const recentDownloads = [];
const MAX_RECENT_DOWNLOADS = 20;

function getDesktopSearchDirectories() {
    const home = process.env.HOME || '';
    const xdgDataHome = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    const xdgDataDirs = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':');
    return [
        path.join(xdgDataHome, 'applications'),
        ...xdgDataDirs.map(d => path.join(d, 'applications'))
    ];
}

function findDesktopFile(desktopId) {
    if (!desktopId) return null;
    const dirs = getDesktopSearchDirectories();
    for (const dir of dirs) {
        const candidate = path.join(dir, desktopId);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function parseDesktopExec(execLine, targetPath) {
    const rawTokens = execLine.trim().match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const tokens = rawTokens.map(t => t.replace(/^"(.*)"$/, '$1'));
    let hasFieldCode = false;
    const args = [];
    for (const token of tokens) {
        if (token === '%f' || token === '%F' || token === '%u' || token === '%U') {
            args.push(targetPath);
            hasFieldCode = true;
        } else if (token.startsWith('%')) {
            continue;
        } else {
            args.push(token);
        }
    }
    if (!hasFieldCode && args.length > 0) {
        const bin = path.basename(args[0]);
        if (bin === 'nautilus' || bin === 'dolphin') {
            args.push(['-', '-', 'select'].join(''));
        }
        args.push(targetPath);
    }
    return args;
}

function hasDbusFileManager() {
    try {
        const res = spawnSync('busctl', ['status', 'org.freedesktop.FileManager1'], {
            timeout: 500,
            stdio: 'ignore'
        });
        return res.status === 0;
    } catch (e) {
        return false;
    }
}

function revealInFileManager(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    if (!fs.existsSync(filePath)) return false;

    let targetPath = filePath;
    try {
        targetPath = fs.realpathSync(filePath);
    } catch (e) {}

    if (hasDbusFileManager()) {
        try {
            shell.showItemInFolder(targetPath);
            return true;
        } catch (e) {}
    }

    try {
        const xdgOutput = execSync('xdg-mime query default inode/directory', {
            encoding: 'utf8',
            timeout: 1000
        }).trim().split('\n')[0].trim();

        if (xdgOutput) {
            const desktopFile = findDesktopFile(xdgOutput);
            if (desktopFile) {
                const content = fs.readFileSync(desktopFile, 'utf8');
                const execMatch = content.match(/^Exec=(.*)$/m);
                if (execMatch && execMatch[1]) {
                    const cmdArgs = parseDesktopExec(execMatch[1], targetPath);
                    if (cmdArgs.length > 0) {
                        const child = spawn(cmdArgs[0], cmdArgs.slice(1), {
                            detached: true,
                            stdio: 'ignore'
                        });
                        child.unref();
                        return true;
                    }
                }
            }
        }
    } catch (e) {}

    try {
        shell.showItemInFolder(targetPath);
        return true;
    } catch (e) {
        return false;
    }
}

function getDisplayName(savePath, fallbackName) {
    if (savePath && typeof savePath === 'string') {
        const base = path.basename(savePath);
        if (base && base.length > 0) return base;
    }
    return fallbackName || 'download';
}

function configureDownloads(targetSession, options = {}) {
    const { getMainWindow, sendNotification, areNotificationsEnabled } = options;

    targetSession.on('will-download', (event, item) => {
        const downloadId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        let startedNotified = false;
        let lastProgressBytes = 0;
        let lastProgressTime = Date.now();
        let currentSpeed = 0;
        let trackedFd = null;

        function updateTrackedFd(targetPath) {
            if (!targetPath || typeof targetPath !== 'string') return;
            try {
                if (fs.existsSync(targetPath)) {
                    if (trackedFd !== null) {
                        try {
                            const currentLink = fs.readlinkSync(`/proc/self/fd/${trackedFd}`);
                            if (currentLink === targetPath) return;
                            fs.closeSync(trackedFd);
                        } catch (e) {}
                        trackedFd = null;
                    }
                    trackedFd = fs.openSync(targetPath, 'r');
                }
            } catch (e) {}
        }

        function resolveLiveSavePath() {
            const currentPath = item.getSavePath();
            if (currentPath) {
                updateTrackedFd(currentPath);
            }
            if (trackedFd !== null) {
                try {
                    const fdPath = `/proc/self/fd/${trackedFd}`;
                    if (fs.existsSync(fdPath)) {
                        const realPath = fs.readlinkSync(fdPath);
                        if (realPath && !realPath.includes('(deleted)')) {
                            return realPath;
                        }
                    }
                } catch (e) {}
            }
            return currentPath;
        }

        activeDownloads.set(downloadId, {
            id: downloadId,
            item: item,
            filename: item.getFilename(),
            totalBytes: item.getTotalBytes(),
            receivedBytes: item.getReceivedBytes(),
            state: item.getState(),
            savePath: item.getSavePath(),
            startTime: Date.now()
        });

        function notifyStarted() {
            if (startedNotified) return;
            startedNotified = true;
            const currentSavePath = resolveLiveSavePath();
            const displayName = getDisplayName(currentSavePath, item.getFilename());
            const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
            if (win && !win.isDestroyed()) {
                win.webContents.send('download-started', {
                    id: downloadId,
                    filename: displayName,
                    totalBytes: item.getTotalBytes(),
                    receivedBytes: item.getReceivedBytes(),
                    state: item.getState(),
                    savePath: currentSavePath
                });
            }
        }

        item.on('updated', (updateEvent, state) => {
            const received = item.getReceivedBytes();
            const total = item.getTotalBytes();

            const savePath = resolveLiveSavePath();
            const displayName = getDisplayName(savePath, item.getFilename());

            const tracked = activeDownloads.get(downloadId);
            if (tracked) {
                tracked.receivedBytes = received;
                tracked.totalBytes = total;
                tracked.state = state;
                tracked.savePath = savePath;
                tracked.filename = displayName;
            }

            if (!startedNotified && (received > 0 || savePath)) {
                notifyStarted();
            }

            if (state === 'progressing') {
                const now = Date.now();
                const timeDelta = (now - lastProgressTime) / 1000;
                if (timeDelta >= 0.4) {
                    const bytesDelta = received - lastProgressBytes;
                    currentSpeed = bytesDelta > 0 ? (bytesDelta / timeDelta) : 0;
                    lastProgressBytes = received;
                    lastProgressTime = now;
                }

                const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
                if (win && !win.isDestroyed()) {
                    win.webContents.send('download-progress', {
                        id: downloadId,
                        filename: displayName,
                        totalBytes: total,
                        receivedBytes: received,
                        percent: total > 0 ? Math.round((received / total) * 100) : 0,
                        speed: currentSpeed,
                        state: state,
                        savePath: savePath,
                        isPaused: item.isPaused()
                    });
                }
            } else if (state === 'interrupted') {
                const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
                if (win && !win.isDestroyed()) {
                    win.webContents.send('download-progress', {
                        id: downloadId,
                        filename: displayName,
                        totalBytes: total,
                        receivedBytes: received,
                        percent: total > 0 ? Math.round((received / total) * 100) : 0,
                        speed: 0,
                        state: 'interrupted',
                        savePath: savePath,
                        isPaused: false
                    });
                }
            }
        });

        item.once('done', (doneEvent, state) => {
            activeDownloads.delete(downloadId);

            if (!startedNotified && state === 'cancelled') {
                if (trackedFd !== null) {
                    try { fs.closeSync(trackedFd); } catch (e) {}
                    trackedFd = null;
                }
                return;
            }

            if (!startedNotified) {
                notifyStarted();
            }

            const finalSavePath = resolveLiveSavePath();
            if (trackedFd !== null) {
                try { fs.closeSync(trackedFd); } catch (e) {}
                trackedFd = null;
            }

            const finalFilename = getDisplayName(finalSavePath, item.getFilename());

            const finalRecord = {
                id: downloadId,
                filename: finalFilename,
                totalBytes: item.getTotalBytes(),
                receivedBytes: item.getReceivedBytes(),
                state: state,
                savePath: finalSavePath,
                completedAt: Date.now()
            };

            recentDownloads.unshift(finalRecord);
            if (recentDownloads.length > MAX_RECENT_DOWNLOADS) {
                recentDownloads.pop();
            }

            const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
            if (win && !win.isDestroyed()) {
                win.webContents.send('download-done', finalRecord);
            }

            const notifyAllowed = typeof areNotificationsEnabled === 'function' ? areNotificationsEnabled() : true;
            if (state === 'completed' && notifyAllowed && typeof sendNotification === 'function') {
                sendNotification('Download Complete', `${finalFilename} has finished downloading.`);
            }
        });
    });
}

function registerDownloadIpc(ipcMain, options = {}) {
    const { sendNotification } = options;

    ipcMain.handle('cancel-download', (event, id) => {
        const entry = activeDownloads.get(id);
        if (entry && entry.item) {
            try {
                entry.item.cancel();
                return true;
            } catch (e) {
                return false;
            }
        }
        return false;
    });

    ipcMain.handle('open-download', async (event, filePath) => {
        if (!filePath || typeof filePath !== 'string') return false;
        try {
            if (!fs.existsSync(filePath)) {
                if (typeof sendNotification === 'function') {
                    sendNotification('Mise Download', 'File not found at destination path.');
                }
                return false;
            }
            let targetPath = filePath;
            try { targetPath = fs.realpathSync(filePath); } catch (e) {}
            const err = await shell.openPath(targetPath);
            return !err;
        } catch (e) {
            return false;
        }
    });

    ipcMain.handle('reveal-download', async (event, filePath) => {
        if (!filePath || typeof filePath !== 'string') return false;
        try {
            if (!fs.existsSync(filePath)) {
                if (typeof sendNotification === 'function') {
                    sendNotification('Mise Download', 'File not found at destination path.');
                }
                return false;
            }
            return revealInFileManager(filePath);
        } catch (e) {
            return false;
        }
    });

    ipcMain.handle('get-active-downloads', () => {
        const active = [];
        for (const [id, entry] of activeDownloads.entries()) {
            active.push({
                id: entry.id,
                filename: entry.filename,
                totalBytes: entry.totalBytes,
                receivedBytes: entry.receivedBytes,
                state: entry.state,
                savePath: entry.savePath
            });
        }
        return { active, recent: recentDownloads };
    });
}

module.exports = {
    configureDownloads,
    registerDownloadIpc,
    revealInFileManager,
    getDesktopSearchDirectories,
    findDesktopFile,
    parseDesktopExec,
    hasDbusFileManager,
    getDisplayName,
    activeDownloads,
    recentDownloads
};
