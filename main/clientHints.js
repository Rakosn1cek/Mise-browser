// main/clientHints.js
// User-Agent Client Hints for Mise.
//
// Electron does not emit any `sec-ch-ua*` request headers (verified by capturing
// what onBeforeSendHeaders receives: no hint headers at all), so Mise supplies
// them. It used to supply exactly two - `sec-ch-ua` and
// `sec-ch-ua-full-version-list` - which is a shape no browser sends: Chrome always
// sends the low-entropy trio together, and it sends the high-entropy full version
// list only to origins that asked for it with `Accept-CH`/`Critical-CH`.
//
// This module is the single source of those values so the request shape is one
// checkable thing. It is deliberately electron-free: main/security.js wires it to
// the session, and tests/client-hints.test.js exercises it directly.
//
// Known ceiling, recorded so nobody re-litigates it: this Chromium's own
// `navigator.userAgentData.getHighEntropyValues().uaFullVersion` is
// `<major>.0.0.0`, not a real build version, so the list we send on request
// mirrors that. Making the JS surface claim a real Chrome build is a preload
// concern, not a header concern.

// Chromium 156's GREASE brand. It cycles between major versions (`Not A(Brand`,
// `Not.A/Brand`, `Not-A.Brand`), so re-check this against
// `navigator.userAgentData.brands` when Electron's Chromium major moves.
const GREASE_BRAND = '"Not-A.Brand";v="99"';

const PLATFORM_NAMES = { linux: 'Linux', win32: 'Windows', darwin: 'macOS' };

function chromeMajor(userAgent) {
    const match = String(userAgent || '').match(/Chrome\/(\d+)/i);
    if (match) return match[1];
    const runtime = (process.versions && process.versions.chrome) || '';
    return runtime.split('.')[0] || '0';
}

function platformName(platform = process.platform) {
    return PLATFORM_NAMES[platform] || 'Linux';
}

/**
 * The three low-entropy hints every Chromium browser sends on every request.
 */
function buildLowEntropyHints(userAgent, platform = process.platform) {
    const major = chromeMajor(userAgent);
    return {
        'sec-ch-ua': `"Chromium";v="${major}", "Google Chrome";v="${major}", ${GREASE_BRAND}`,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': `"${platformName(platform)}"`
    };
}

/**
 * The high-entropy hint, sent only to an origin that opted in via Accept-CH.
 */
function buildFullVersionList(userAgent) {
    const major = chromeMajor(userAgent);
    return `"Chromium";v="${major}.0.0.0", "Google Chrome";v="${major}.0.0.0", "Not-A.Brand";v="99.0.0.0"`;
}

function headerValues(responseHeaders, name) {
    if (!responseHeaders || typeof responseHeaders !== 'object') return [];
    const wanted = String(name).toLowerCase();
    const values = [];
    for (const [key, value] of Object.entries(responseHeaders)) {
        if (String(key).toLowerCase() !== wanted) continue;
        if (Array.isArray(value)) values.push(...value.map(String));
        else if (value != null) values.push(String(value));
    }
    return values;
}

/**
 * Names from `Accept-CH` and `Critical-CH` response headers, lower-cased.
 */
function parseAcceptCh(responseHeaders) {
    const raw = [...headerValues(responseHeaders, 'accept-ch'), ...headerValues(responseHeaders, 'critical-ch')];
    const names = new Set();
    for (const value of raw) {
        for (const token of value.split(',')) {
            const name = token.trim().toLowerCase();
            if (/^[a-z0-9-]+$/.test(name)) names.add(name);
        }
    }
    return [...names];
}

/**
 * Per-origin Accept-CH memory. A site only wants the high-entropy hints after it
 * asked for them, and Chrome remembers that for the life of the profile; keyed by
 * origin, bounded, and recency-refreshed so a busy origin cannot evict itself.
 */
function createAcceptChStore(options = {}) {
    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 200;
    const byOrigin = new Map();

    return {
        record(origin, responseHeaders) {
            if (!origin) return;
            const names = parseAcceptCh(responseHeaders);
            if (!names.length) return;
            const set = byOrigin.get(origin) || new Set();
            for (const name of names) set.add(name);
            byOrigin.delete(origin);
            if (byOrigin.size >= limit) {
                const oldest = byOrigin.keys().next();
                if (!oldest.done) byOrigin.delete(oldest.value);
            }
            byOrigin.set(origin, set);
        },
        wants(origin, name) {
            const set = byOrigin.get(origin);
            return !!set && set.has(String(name).toLowerCase());
        },
        size() {
            return byOrigin.size;
        }
    };
}

function isConnectionHeader(name, headers) {
    if (name === 'connection') return true;
    if (name !== 'host') return false;
    return !Object.keys(headers).some(key => key.toLowerCase() === 'connection');
}

/**
 * Merge hints into a request header object without reshuffling it.
 *
 * Chrome's document request order is Host, Connection, sec-ch-ua,
 * sec-ch-ua-mobile, sec-ch-ua-platform, ...; the old code appended its hints at the
 * end, which is a shape no browser produces. Existing hint headers are updated in
 * place (case-insensitively); missing ones are inserted after Connection.
 */
function applyClientHints(headers, hints) {
    if (!headers || typeof headers !== 'object' || !hints || typeof hints !== 'object') return headers;

    const wanted = Object.keys(hints).map(name => name.toLowerCase());
    const present = new Set(Object.keys(headers).map(name => name.toLowerCase()));
    const out = {};
    let inserted = false;

    for (const [name, value] of Object.entries(headers)) {
        const lower = name.toLowerCase();
        if (wanted.includes(lower)) out[name] = hints[lower];
        else out[name] = value;
        if (!inserted && isConnectionHeader(lower, headers)) {
            for (const hintName of wanted) {
                if (present.has(hintName)) continue;
                out[hintName] = hints[hintName];
            }
            inserted = true;
        }
    }

    if (!inserted) {
        for (const hintName of wanted) {
            if (present.has(hintName)) continue;
            out[hintName] = hints[hintName];
        }
    }

    return out;
}

module.exports = {
    GREASE_BRAND,
    buildLowEntropyHints,
    buildFullVersionList,
    parseAcceptCh,
    createAcceptChStore,
    applyClientHints
};
