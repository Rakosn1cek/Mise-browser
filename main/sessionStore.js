const path = require('path');
const fs = require('fs');
const config = require('./config');
const diagnostics = require('../diagnostics');

const CONFIG_DIR = config.CONFIG_DIR;
const sessionPath = path.join(CONFIG_DIR, 'session.json');
const sessionBackupPath = path.join(CONFIG_DIR, 'session.json.bak');
const sessionSuspectPath = path.join(CONFIG_DIR, 'session.suspect.json');
const sentinelPath = path.join(CONFIG_DIR, 'session_sentinel.json');

let isCrashRecovery = false;
let pendingSessionData = null;
let sessionFlushTimer = null;

function checkAndInitializeSentinel(targetDir = CONFIG_DIR, targetSentinel = sentinelPath) {
    try {
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        if (fs.existsSync(targetSentinel)) {
            const raw = fs.readFileSync(targetSentinel, 'utf8');
            const data = JSON.parse(raw);
            if (data && data.clean_exit === false) {
                isCrashRecovery = true;
            }
        }
    } catch (err) {}
    markSentinelState(false, targetDir, targetSentinel);
    return isCrashRecovery;
}

function markSentinelState(cleanExit, targetDir = CONFIG_DIR, targetSentinel = sentinelPath) {
    try {
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        const data = {
            clean_exit: !!cleanExit,
            timestamp: Date.now(),
            pid: process.pid
        };
        const tmpPath = targetSentinel + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmpPath, targetSentinel);
    } catch (err) {}
}

function isCrashRecoveryState() {
    return isCrashRecovery;
}

function setCrashRecoveryState(val) {
    isCrashRecovery = !!val;
}

function getPendingSessionData() {
    return pendingSessionData;
}

function sanitizeSessionForDisk(sessionData) {
    if (!sessionData || typeof sessionData !== 'object') return sessionData;
    const clone = JSON.parse(JSON.stringify(sessionData));
    const isPrivateWS = (k) => String(k).trim().toLowerCase() === 'private';

    for (const key of ['workspaces', 'tab_titles', 'tab_favicons', 'tab_sleep_states', 'tab_dark_reader', 'tab_pinned']) {
        if (clone[key] && typeof clone[key] === 'object') {
            for (const ws of Object.keys(clone[key])) {
                if (isPrivateWS(ws)) {
                    delete clone[key][ws];
                }
            }
        }
    }

    if (isPrivateWS(clone.current_workspace)) {
        const remaining = Object.keys(clone.workspaces || {});
        clone.current_workspace = remaining.length > 0 ? remaining[0] : 'Workspace 1';
        if (!clone.workspaces || remaining.length === 0) {
            clone.workspaces = { 'Workspace 1': ['https://duckduckgo.com'] };
        }
    }
    return clone;
}

function countSessionTabs(sessionData) {
    let total = 0;
    let blank = 0;
    if (sessionData && typeof sessionData === 'object' && sessionData.workspaces && typeof sessionData.workspaces === 'object') {
        for (const ws of Object.keys(sessionData.workspaces)) {
            const tabs = sessionData.workspaces[ws];
            if (Array.isArray(tabs)) {
                for (const url of tabs) {
                    total++;
                    if (!url || typeof url !== 'string' || !url.trim() || url.trim() === 'about:blank') {
                        blank++;
                    }
                }
            }
        }
    }
    return { total, blank };
}

function formatSnapshotTimestamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function parseSnapshotTimestamp(filename) {
    const match = filename.match(/^session\.snap-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/);
    if (!match) return null;
    const [, yyyy, mm, dd, hh, min, ss] = match;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss)).getTime();
}

function maybeCreateSnapshot(targetDir, sourceFilePath, sessionObj) {
    if (!fs.existsSync(sourceFilePath)) return;
    const counts = countSessionTabs(sessionObj);
    if (counts.total === 0 || (counts.blank / counts.total) >= 0.5) return;
    if (typeof fs.readdirSync !== 'function') return;

    try {
        const existingSnapshots = fs.readdirSync(targetDir)
            .filter(f => /^session\.snap-\d{8}-\d{6}\.json$/.test(f))
            .sort();

        const now = Date.now();
        if (existingSnapshots.length > 0) {
            const newest = existingSnapshots[existingSnapshots.length - 1];
            const newestTime = parseSnapshotTimestamp(newest);
            if (newestTime !== null && (now - newestTime) < 10 * 60 * 1000) {
                return;
            }
        }

        const snapName = `session.snap-${formatSnapshotTimestamp(new Date(now))}.json`;
        const snapPath = path.join(targetDir, snapName);
        fs.copyFileSync(sourceFilePath, snapPath);

        existingSnapshots.push(snapName);
        existingSnapshots.sort();
        if (existingSnapshots.length > 10) {
            const toDelete = existingSnapshots.slice(0, existingSnapshots.length - 10);
            for (const file of toDelete) {
                if (typeof fs.unlinkSync === 'function') {
                    try { fs.unlinkSync(path.join(targetDir, file)); } catch (e) {}
                }
            }
        }
    } catch (e) {}
}

function flushSessionToDisk(customPaths = {}) {
    const targetSessionPath = customPaths.sessionPath || sessionPath;
    const targetBackupPath = customPaths.sessionBackupPath || sessionBackupPath;
    const targetSuspectPath = customPaths.sessionSuspectPath || path.join(path.dirname(targetSessionPath), 'session.suspect.json');

    if (sessionFlushTimer) {
        clearTimeout(sessionFlushTimer);
        sessionFlushTimer = null;
    }
    if (!pendingSessionData || typeof pendingSessionData !== 'object') return true;
    try {
        const dir = path.dirname(targetSessionPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // Read existing session file before writing
        let existingSession = null;
        if (fs.existsSync(targetSessionPath) && typeof fs.readFileSync === 'function') {
            try {
                const raw = fs.readFileSync(targetSessionPath, 'utf8');
                existingSession = JSON.parse(raw);
            } catch (e) {
                existingSession = null;
            }
        }

        const sanitizedNew = sanitizeSessionForDisk(pendingSessionData);
        const newCounts = countSessionTabs(sanitizedNew);
        const existingCounts = countSessionTabs(existingSession);

        const isNewSuspect = newCounts.blank >= 3 && newCounts.total > 0 && (newCounts.blank / newCounts.total) >= 0.5;
        const isExistingHealthy = existingSession !== null && existingCounts.total > 0 && (existingCounts.blank / existingCounts.total) <= 0.2;

        if (isNewSuspect && isExistingHealthy) {
            fs.writeFileSync(targetSuspectPath, JSON.stringify(sanitizedNew, null, 4), 'utf8');
            diagnostics.logEvent('warn', 'session', 'Suspect session write intercepted with excessive blank tabs', {
                newTotalTabs: newCounts.total,
                newBlankTabs: newCounts.blank,
                existingTotalTabs: existingCounts.total,
                existingBlankTabs: existingCounts.blank
            });
            pendingSessionData = null;
            return true;
        }

        const serialized = JSON.stringify(sanitizedNew, null, 4);
        const tempPath = targetSessionPath + '.tmp';

        // Write to temporary file first
        fs.writeFileSync(tempPath, serialized, 'utf8');

        // Rotate existing valid session to backup only if it parses and is not mostly blank
        const isExistingParsableAndNotMostlyBlank = existingSession !== null && existingCounts.total > 0 && (existingCounts.blank / existingCounts.total) < 0.5;
        if (fs.existsSync(targetSessionPath) && isExistingParsableAndNotMostlyBlank) {
            try {
                fs.copyFileSync(targetSessionPath, targetBackupPath);
            } catch (copyErr) {}
            maybeCreateSnapshot(dir, targetSessionPath, existingSession);
        }

        // Atomically rename temporary file to destination
        fs.renameSync(tempPath, targetSessionPath);

        // Keep initial snapshot if no snapshots exist yet
        maybeCreateSnapshot(dir, targetSessionPath, sanitizedNew);

        pendingSessionData = null;
        return true;
    } catch (err) {
        diagnostics.logEvent('error', 'session', 'Failed to save session atomically', { error: err.message });
        return false;
    }
}

function scheduleSessionSave(sessionData, delayMs = 300, customPaths = {}) {
    if (!sessionData || typeof sessionData !== 'object') return false;
    pendingSessionData = sessionData;
    if (sessionFlushTimer) return true;
    sessionFlushTimer = setTimeout(() => {
        sessionFlushTimer = null;
        flushSessionToDisk(customPaths);
    }, delayMs);
    return true;
}

function readCurrentSession(customPaths = {}) {
    if (pendingSessionData && typeof pendingSessionData === 'object') {
        return sanitizeSessionForDisk(pendingSessionData);
    }
    const targetSessionPath = customPaths.sessionPath || sessionPath;
    const targetBackupPath = customPaths.sessionBackupPath || sessionBackupPath;

    try {
        if (fs.existsSync(targetSessionPath)) {
            const raw = fs.readFileSync(targetSessionPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                return sanitizeSessionForDisk(parsed);
            }
        }
    } catch (err) {
        diagnostics.logEvent('warn', 'session', 'Failed to read primary session, checking backup', { error: err.message });
    }

    try {
        if (fs.existsSync(targetBackupPath)) {
            const rawBackup = fs.readFileSync(targetBackupPath, 'utf8');
            const parsedBackup = JSON.parse(rawBackup);
            if (parsedBackup && typeof parsedBackup === 'object') {
                diagnostics.logEvent('info', 'session', 'Successfully recovered session from backup copy');
                return sanitizeSessionForDisk(parsedBackup);
            }
        }
    } catch (backupErr) {
        diagnostics.logEvent('error', 'session', 'Failed to read session backup', { error: backupErr.message });
    }

    return { current_workspace: "Workspace 1", workspaces: { "Workspace 1": ["https://duckduckgo.com"] } };
}

function registerSessionIpc(ipcMain) {
    ipcMain.handle('get-session-recovery-status', async () => {
        return { wasCrash: isCrashRecovery };
    });

    ipcMain.handle('get-session', async () => {
        return readCurrentSession();
    });

    ipcMain.handle('save-session', async (event, sessionData) => {
        return scheduleSessionSave(sessionData);
    });
}

module.exports = {
    sessionPath,
    sessionBackupPath,
    sessionSuspectPath,
    sentinelPath,
    checkAndInitializeSentinel,
    markSentinelState,
    isCrashRecoveryState,
    setCrashRecoveryState,
    getPendingSessionData,
    sanitizeSessionForDisk,
    flushSessionToDisk,
    scheduleSessionSave,
    readCurrentSession,
    registerSessionIpc
};
