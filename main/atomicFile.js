const fs = require('fs');
const path = require('path');

const backedUpVersions = new Map();

function formatTimestamp(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const min = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function atomicWriteFileSync(targetPath, data, { mode = 0o600 } = {}) {
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    const tmpPath = `${targetPath}.${process.pid}.tmp`;
    let fd;
    try {
        fd = fs.openSync(tmpPath, 'w', mode);
        if (process.platform !== 'win32') {
            fs.fchmodSync(fd, mode);
        }
        if (typeof data === 'string') {
            fs.writeSync(fd, data, undefined, 'utf8');
        } else {
            fs.writeSync(fd, data);
        }
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(tmpPath, targetPath);
    } catch (err) {
        if (fd !== undefined) {
            try {
                fs.closeSync(fd);
            } catch (_) {}
        }
        try {
            if (fs.existsSync(tmpPath)) {
                fs.unlinkSync(tmpPath);
            }
        } catch (_) {}
        throw err;
    }
}

function backupCorruptFile(targetPath, maxKeep = 3) {
    try {
        if (!fs.existsSync(targetPath)) {
            return null;
        }

        const stats = fs.statSync(targetPath);
        const resolvedPath = path.resolve(targetPath);
        const fileSignature = `${stats.size}:${stats.mtimeMs}`;

        if (backedUpVersions.get(resolvedPath) === fileSignature) {
            return null;
        }

        const baseTimestamp = formatTimestamp();
        let backupPath = `${targetPath}.corrupt-${baseTimestamp}`;
        if (fs.existsSync(backupPath)) {
            let collisionIndex = 1;
            while (fs.existsSync(`${backupPath}-${collisionIndex}`)) {
                collisionIndex++;
            }
            backupPath = `${backupPath}-${collisionIndex}`;
        }

        fs.copyFileSync(targetPath, backupPath);
        backedUpVersions.set(resolvedPath, fileSignature);

        const dir = path.dirname(targetPath);
        const baseName = path.basename(targetPath);
        const corruptPrefix = `${baseName}.corrupt-`;

        const existingBackups = fs.readdirSync(dir)
            .filter((name) => name.startsWith(corruptPrefix))
            .map((name) => {
                const fullPath = path.join(dir, name);
                let mtimeMs = 0;
                try {
                    mtimeMs = fs.statSync(fullPath).mtimeMs;
                } catch (_) {}
                return { name, fullPath, mtimeMs };
            });

        existingBackups.sort((a, b) => {
            if (a.mtimeMs !== b.mtimeMs) {
                return a.mtimeMs - b.mtimeMs;
            }
            return a.name.localeCompare(b.name, undefined, { numeric: true });
        });

        if (existingBackups.length > maxKeep) {
            const filesToDelete = existingBackups.slice(0, existingBackups.length - maxKeep);
            for (const item of filesToDelete) {
                try {
                    fs.unlinkSync(item.fullPath);
                } catch (_) {}
            }
        }

        return backupPath;
    } catch (_) {
        return null;
    }
}

function readJsonFileOrBackup(targetPath, isValid, fallbackFactory) {
    if (!fs.existsSync(targetPath)) {
        return fallbackFactory();
    }
    try {
        const raw = fs.readFileSync(targetPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof isValid === 'function' && !isValid(parsed)) {
            backupCorruptFile(targetPath);
            return fallbackFactory();
        }
        return parsed;
    } catch (_) {
        backupCorruptFile(targetPath);
        return fallbackFactory();
    }
}

module.exports = {
    atomicWriteFileSync,
    backupCorruptFile,
    readJsonFileOrBackup
};
