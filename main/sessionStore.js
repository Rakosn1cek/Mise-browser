const path = require('path');
const fs = require('fs');
const config = require('./config');
const diagnostics = require('../diagnostics');

const CONFIG_DIR = config.CONFIG_DIR;
const sessionPath = path.join(CONFIG_DIR, 'session.json');
const sessionBackupPath = path.join(CONFIG_DIR, 'session.json.bak');
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

function flushSessionToDisk(customPaths = {}) {
    const targetSessionPath = customPaths.sessionPath || sessionPath;
    const targetBackupPath = customPaths.sessionBackupPath || sessionBackupPath;

    if (sessionFlushTimer) {
        clearTimeout(sessionFlushTimer);
        sessionFlushTimer = null;
    }
    if (!pendingSessionData || typeof pendingSessionData !== 'object') return true;
    try {
        const dir = path.dirname(targetSessionPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const serialized = JSON.stringify(pendingSessionData, null, 4);
        const tempPath = targetSessionPath + '.tmp';

        // Write to temporary file first
        fs.writeFileSync(tempPath, serialized, 'utf8');

        // Rotate existing valid session to backup before overwriting
        if (fs.existsSync(targetSessionPath)) {
            try {
                fs.copyFileSync(targetSessionPath, targetBackupPath);
            } catch (copyErr) {}
        }

        // Atomically rename temporary file to destination
        fs.renameSync(tempPath, targetSessionPath);
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
        return pendingSessionData;
    }
    const targetSessionPath = customPaths.sessionPath || sessionPath;
    const targetBackupPath = customPaths.sessionBackupPath || sessionBackupPath;

    try {
        if (fs.existsSync(targetSessionPath)) {
            const raw = fs.readFileSync(targetSessionPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                return parsed;
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
                return parsedBackup;
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
    sentinelPath,
    checkAndInitializeSentinel,
    markSentinelState,
    isCrashRecoveryState,
    setCrashRecoveryState,
    getPendingSessionData,
    flushSessionToDisk,
    scheduleSessionSave,
    readCurrentSession,
    registerSessionIpc
};
