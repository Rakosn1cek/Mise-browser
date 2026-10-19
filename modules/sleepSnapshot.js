// modules/sleepSnapshot.js
// Origin validation, sanitisation, and non-enumerable attachment for tab session snapshots

export function originOf(url) {
    if (typeof url !== 'string' || !url) {
        return null;
    }
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.origin;
        }
        return null;
    } catch {
        return null;
    }
}

export function sanitizeSnapshot(raw, maxChars = 262144) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > maxChars) {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.prototype.toString.call(parsed) !== '[object Object]') {
        return null;
    }
    const keys = Object.keys(parsed);
    if (keys.length > 500) {
        return null;
    }
    for (let i = 0; i < keys.length; i++) {
        if (typeof parsed[keys[i]] !== 'string') {
            return null;
        }
    }
    return JSON.stringify(parsed);
}

export function attachSnapshot(record, origin, data) {
    if (record && typeof record === 'object' && typeof origin === 'string' && origin.length > 0 && typeof data === 'string' && data.length > 0) {
        Object.defineProperty(record, 'sessionSnapshot', {
            value: { origin, data },
            enumerable: false,
            writable: true,
            configurable: true
        });
    }
    return record;
}

export function snapshotForRestore(record, currentUrl) {
    if (!record || !record.sessionSnapshot) {
        return null;
    }
    const origin = originOf(currentUrl);
    if (!origin) {
        return null;
    }
    if (origin === record.sessionSnapshot.origin && typeof record.sessionSnapshot.data === 'string') {
        return record.sessionSnapshot.data;
    }
    return null;
}
