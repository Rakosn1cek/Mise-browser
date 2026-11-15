// main/mediaOffload.js
// Subsystem for low-resource media offloading to native mpv and yt-dlp on Linux

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

let cachedDetection = null;
let detectionTimestamp = 0;
const CACHE_TTL_MS = 60000;

const KNOWN_MEDIA_EXTENSIONS = new Set([
    '.mp4', '.webm', '.mkv', '.m3u8', '.mpd',
    '.flv', '.mov', '.avi', '.ogg', '.ogv'
]);

const YOUTUBE_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'gaming.youtube.com',
    'youtu.be'
]);

function getLinuxCandidatePaths(binaryName) {
    const home = process.env.HOME || '';
    const paths = [
        path.join('/usr/bin', binaryName),
        path.join('/usr/local/bin', binaryName)
    ];
    if (home) {
        paths.push(
            path.join(home, '.local', 'bin', binaryName),
            path.join(home, 'bin', binaryName)
        );
    }
    return paths;
}

function resolveBinaryPath(binaryName, options = {}) {
    const candidatePaths = options.customCandidates || getLinuxCandidatePaths(binaryName);
    for (const cand of candidatePaths) {
        try {
            if (fs.existsSync(cand)) {
                return cand;
            }
        } catch (_) {}
    }
    return null;
}

function detectMediaBinaries(options = {}) {
    const now = Date.now();
    if (!options.forceRefresh && cachedDetection && (now - detectionTimestamp < CACHE_TTL_MS)) {
        return cachedDetection;
    }

    const mpvCandidate = resolveBinaryPath('mpv', options);
    const ytdlpCandidate = resolveBinaryPath('yt-dlp', options) || resolveBinaryPath('youtube-dl', options);

    const missing = [];
    if (!mpvCandidate) missing.push('mpv');
    if (!ytdlpCandidate) missing.push('yt-dlp');

    const result = {
        available: Boolean(mpvCandidate),
        mpvAvailable: Boolean(mpvCandidate),
        ytdlpAvailable: Boolean(ytdlpCandidate),
        mpvPath: mpvCandidate,
        ytdlpPath: ytdlpCandidate,
        missing,
        timestamp: now
    };

    cachedDetection = result;
    detectionTimestamp = now;
    return result;
}

function isYouTubeMediaUrl(parsed) {
    const hostname = parsed.hostname.toLowerCase();
    const isYtHost = YOUTUBE_HOSTS.has(hostname) || Array.from(YOUTUBE_HOSTS).some(h => hostname.endsWith('.' + h));
    if (!isYtHost) return false;

    if (hostname === 'youtu.be' || hostname.endsWith('.youtu.be')) {
        return parsed.pathname.length > 1;
    }

    const pathname = parsed.pathname.toLowerCase();
    if (pathname === '/watch' || pathname.startsWith('/watch/')) {
        return parsed.searchParams.has('v') || parsed.searchParams.has('list');
    }
    if (pathname.startsWith('/shorts/') && pathname.length > 8) {
        return true;
    }
    if (pathname.startsWith('/live/') && pathname.length > 6) {
        return true;
    }
    if (pathname.startsWith('/embed/') && pathname.length > 7) {
        return true;
    }
    if (pathname.startsWith('/v/') && pathname.length > 3) {
        return true;
    }
    if (pathname === '/playlist' && parsed.searchParams.has('list')) {
        return true;
    }
    return false;
}

function isCandidateMediaUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    const trimmed = rawUrl.trim();
    if (trimmed.length === 0 || trimmed.length > 2048) return false;

    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return false;
        }

        if (isYouTubeMediaUrl(parsed)) {
            return true;
        }

        const ext = path.extname(parsed.pathname).toLowerCase();
        if (KNOWN_MEDIA_EXTENSIONS.has(ext)) {
            return true;
        }
    } catch (_) {
        return false;
    }

    return false;
}

function sanitiseMediaUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;

    const cleaned = rawUrl.replace(/[\0\r\n\t]+/g, '').trim();
    if (!cleaned || cleaned.length > 2048) return null;

    if (cleaned.startsWith('-')) {
        return null;
    }

    try {
        const parsed = new URL(cleaned);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed.href;
    } catch (_) {
        return null;
    }
}

function formatYtdlQuality(quality = '1080p') {
    switch (String(quality).toLowerCase()) {
        case '480p':
            return 'bestvideo[height<=?480]+bestaudio/best[height<=?480]';
        case '720p':
            return 'bestvideo[height<=?720]+bestaudio/best[height<=?720]';
        case 'best':
        case 'max':
            return 'bestvideo+bestaudio/best';
        case '1080p':
        default:
            return 'bestvideo[height<=?1080]+bestaudio/best[height<=?1080]';
    }
}

function buildMpvArguments(targetUrl, options = {}) {
    const quality = options.quality || '1080p';
    const ytdlFormat = formatYtdlQuality(quality);

    const args = [
        '--force-window=immediate',
        '--hwdec=auto',
        '--ytdl-format=' + ytdlFormat
    ];

    if (options.title) {
        args.push('--title=' + String(options.title).slice(0, 100));
    }

    args.push('--', targetUrl);
    return args;
}

function spawnMpvProcess(targetUrl, options = {}) {
    const sanitisedUrl = sanitiseMediaUrl(targetUrl);
    if (!sanitisedUrl) {
        return { success: false, error: 'Invalid or unsafe media URL provided.' };
    }

    const binaries = detectMediaBinaries(options);
    if (!binaries.mpvAvailable) {
        return { success: false, error: 'mpv executable not found on host system.' };
    }

    const args = buildMpvArguments(sanitisedUrl, options);

    try {
        const child = spawn(binaries.mpvPath, args, {
            detached: true,
            stdio: 'ignore'
        });

        child.on('error', (err) => {
            console.error('Failed to spawn mpv process:', err);
        });

        child.unref();

        return {
            success: true,
            mpvPath: binaries.mpvPath,
            url: sanitisedUrl
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    detectMediaBinaries,
    isCandidateMediaUrl,
    sanitiseMediaUrl,
    formatYtdlQuality,
    buildMpvArguments,
    spawnMpvProcess
};
