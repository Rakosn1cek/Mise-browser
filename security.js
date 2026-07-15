// security.js
// Decoupled security configuration module for the Mise browser

// 1. Explicit domain blocks for platforms that bypass keyword filters
const blockHosts = [
    "bugsnag.com",
    "sentry.io",
    "sentry-cdn.com",
    "advmaker.ru",
    "advmaker.net"
];

// 2. Heavy-duty ad-tech and tracking keywords (Restored to block standard ad servers)
const blockKeywords = [
    // --- Original General Keywords ---
    "telemetry", "analytics", "metrics", "log-upload", 
    "browser-intake", "stats", "pagead", "doubleclick",

    // --- Major Ad Networks & Ad Servers (Restored) ---
    "adsense", "adsystem", "adservice", "adnxs", "adserver",
    "quantserve", "scorecardresearch", "criteo", "taboola", 
    "amazon-adsystem", "outbrain", "popads", "yandex",

    // --- Behavioral Tracking & Tag Management ---
    "googletagmanager", "google-analytics", "fbevents", 
    "hotjar", "optimizely", "amplitude", "mixpanel", 
    "segment", "intercom", "clarity.ms",

    // --- App Error & Performance Telemetry ---
    "crashlytics", "raygun", "instabug", "bugsnag",
];

function requestFilter(details, callback) {
    let shouldBlock = false;
    try {
        const urlObj = new URL(details.url);
        const host = urlObj.hostname.toLowerCase();
        const urlPath = details.url.toLowerCase();

        // Rule A: Explicit Reddit Tracking/Eval Protections
        if (host.includes("alb.reddit.com") || details.url.includes(".reddit.com/api/eval")) {
            shouldBlock = true;
        } 
        // Rule B: Explicit Host Matching (Blocks Bugsnag, Sentry, Advmaker)
        else if (blockHosts.some(blockedHost => host === blockedHost || host.endsWith("." + blockedHost))) {
            shouldBlock = true;
        } 
        // Rule C: Aggressive Substring Keyword Matching (Restored for Ad/Adsystem blocks)
        else if (blockKeywords.some(keyword => host.includes(keyword))) {
            shouldBlock = true;
        }
        // Rule D: Smart Resource Context Filtering (Pings & beacons)
        else if (details.resourceType === 'ping' && urlPath.includes('track')) {
            shouldBlock = true;
        }
    } catch (e) {}

    if (shouldBlock) {
        callback({ cancel: true });
    } else {
        callback({ cancel: false });
    }
}

function hardenSession(targetSession) {
    // Enforce UK English spellchecking
    targetSession.setSpellCheckerLanguages(['en-GB']);

    // Telemetry, Ads, and Tracker request filtering with context
    targetSession.webRequest.onBeforeRequest(requestFilter);

    // Block permission requests (Camera, Mic, Location)
    targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const blocked = ['media', 'geolocation', 'notifications', 'midiSysex'];
        if (blocked.includes(permission)) {
            return callback(false); // Refuse sensory/tracking requests
        }
        callback(true);
    });
}

function hardenWebviewPreferences(webPreferences) {
    // Force-disable WebGL at the rendering engine level for all webviews
    webPreferences.webgl = false;
}

module.exports = {
    hardenSession,
    hardenWebviewPreferences
};
