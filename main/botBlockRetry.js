// main/botBlockRetry.js
// Recovery for bot-manager "first click fails, second click works" pages.
//
// A site sitting behind Akamai Bot Manager (eBay is the case this was measured
// on) answers a document request whose bot cookie has gone stale with a 403
// error page, and that 403 page itself carries the sensor script which mints
// the replacement cookies. So the request that follows the error page succeeds:
// users see "click the link, get an error page, go back, click again, it
// works". The browser can do the retry the user does by hand - once, and only
// after the error page has finished loading so the sensor cookies are set.
//
// This module owns the decision and the rate limit; main.js owns the
// webContents plumbing (did-frame-navigate + did-stop-loading).

// Cookie names Akamai Bot Manager's deny response is known to set. `bm_s` and
// `bm_so` are what ebay.com sends today; the rest are the same family on other
// Akamai-fronted properties. Matching on the response's own Set-Cookie keeps
// this from retrying ordinary 403s (paywalls, permission denials).
const BOT_MANAGER_COOKIE = /(?:^|[;,\s])(?:bm_sz|bm_sv|bm_so|bm_s|ak_bmsc|_abck)=/i;

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

function hasBotManagerCookie(responseHeaders) {
    return headerValues(responseHeaders, 'set-cookie').some(value => BOT_MANAGER_COOKIE.test(value));
}

/**
 * True when a document response is a bot-manager denial worth retrying: a 403
 * that hands back its own bot cookies. An executed side effect has not
 * happened (the request was refused before the site served anything), which is
 * what makes replaying it safe.
 */
function isBotBlockResponse(statusCode, responseHeaders) {
    return Number(statusCode) === 403 && hasBotManagerCookie(responseHeaders);
}

/**
 * Tracks which navigations may be retried. `note` records that webContents N
 * received a bot-block 403 for a URL; `claim` consumes that record exactly once
 * and refuses a second automatic retry of the same URL inside `cooldownMs`, so a
 * site that denies every attempt cannot turn into a reload loop.
 */
function createBotBlockRetryTracker(options = {}) {
    const cooldownMs = Number.isFinite(options.cooldownMs) ? options.cooldownMs : 5 * 60 * 1000;
    const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0 ? options.maxEntries : 64;
    const pending = new Map();
    const retried = new Map();

    const prune = (now) => {
        if (retried.size <= maxEntries) return;
        for (const [key, at] of retried) {
            if (now - at >= cooldownMs) retried.delete(key);
        }
        // Still oversized: drop the oldest insertions. Map preserves insertion order.
        while (retried.size > maxEntries) {
            const oldest = retried.keys().next();
            if (oldest.done) break;
            retried.delete(oldest.value);
        }
    };

    return {
        note(webContentsId, url) {
            if (webContentsId == null || !url) return;
            if (pending.size >= maxEntries) {
                const oldest = pending.keys().next();
                if (!oldest.done) pending.delete(oldest.value);
            }
            pending.set(webContentsId, url);
        },
        claim(webContentsId, url, now = Date.now()) {
            if (webContentsId == null || !url) return false;
            if (pending.get(webContentsId) !== url) return false;
            pending.delete(webContentsId);

            const key = `${webContentsId} ${url}`;
            const last = retried.get(key);
            if (last != null && now - last < cooldownMs) return false;

            retried.set(key, now);
            prune(now);
            return true;
        },
        clear(webContentsId) {
            if (webContentsId == null) return;
            pending.delete(webContentsId);
        },
        size() {
            return { pending: pending.size, retried: retried.size };
        }
    };
}

module.exports = {
    BOT_MANAGER_COOKIE,
    hasBotManagerCookie,
    isBotBlockResponse,
    createBotBlockRetryTracker
};
