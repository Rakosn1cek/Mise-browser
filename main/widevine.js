// main/widevine.js
// Subsystem for detecting and registering host Widevine CDM binaries on Linux
// Provides descriptive fallback diagnostics across Linux, macOS, and Windows

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Platform messages and guidance.
 */
const MESSAGES = {
    DARWIN: 'Widevine DRM is unavailable on macOS. Protected media playback requires a Google Verified Media Path (VMP) code-signing signature.',
    WIN32: 'Widevine DRM is unavailable on Windows. Protected media playback requires a Google Verified Media Path (VMP) code-signing signature.',
    UNSUPPORTED_OS: 'Widevine DRM is unsupported on this operating system.',
    NOT_FOUND_LINUX: 'Widevine CDM not detected on host. Install chromium-widevine or Google Chrome to enable DRM playback.',
    READY_LINUX: (version, binaryPath) => `Widevine CDM v${version} loaded from ${binaryPath}`
};

/**
 * Standard host candidate paths to search on Linux systems.
 */
function getLinuxCandidatePaths(customEnv = process.env) {
    const home = os.homedir ? os.homedir() : '';
    const candidates = [];

    // Optional environment variable override
    if (customEnv && customEnv.WIDEVINE_CDM_PATH) {
        candidates.push(customEnv.WIDEVINE_CDM_PATH);
    }

    candidates.push(
        '/opt/google/chrome/WidevineCdm',
        '/opt/google/chrome-beta/WidevineCdm',
        '/opt/google/chrome-unstable/WidevineCdm',
        '/usr/lib/chromium/WidevineCdm',
        '/usr/lib/chromium-browser/WidevineCdm',
        '/usr/lib/widevine',
        '/usr/lib/widevine-cdm',
        '/opt/brave.com/brave/WidevineCdm'
    );

    if (home) {
        candidates.push(
            path.join(home, '.config', 'google-chrome', 'WidevineCdm'),
            path.join(home, '.local', 'lib', 'widevine')
        );
    }

    return candidates;
}

/**
 * Detects presence of Widevine CDM library and manifest.
 * Supports injected options for testability across platforms.
 */
function detectWidevineCdm(options = {}) {
    const targetPlatform = options.platform || process.platform;
    const targetArch = options.arch || process.arch;

    if (targetPlatform === 'darwin') {
        return {
            status: 'unsupported',
            version: null,
            path: null,
            directory: null,
            message: MESSAGES.DARWIN
        };
    }

    if (targetPlatform === 'win32') {
        return {
            status: 'unsupported',
            version: null,
            path: null,
            directory: null,
            message: MESSAGES.WIN32
        };
    }

    if (targetPlatform !== 'linux') {
        return {
            status: 'unsupported',
            version: null,
            path: null,
            directory: null,
            message: MESSAGES.UNSUPPORTED_OS
        };
    }

    // Search Linux candidate paths
    const candidates = options.customPaths || getLinuxCandidatePaths(options.env || process.env);
    const archSubdir = targetArch === 'arm64' ? 'linux_arm64' : 'linux_x64';

    for (const candidate of candidates) {
        try {
            if (!candidate || !fs.existsSync(candidate)) continue;

            const stat = fs.statSync(candidate);
            let candidateDir = candidate;
            let binaryPath = null;

            if (stat.isFile()) {
                if (path.basename(candidate) === 'libwidevinecdm.so') {
                    binaryPath = candidate;
                    candidateDir = path.dirname(candidate);
                }
            } else if (stat.isDirectory()) {
                const directBinary = path.join(candidate, 'libwidevinecdm.so');
                const archBinary = path.join(candidate, '_platform_specific', archSubdir, 'libwidevinecdm.so');

                if (fs.existsSync(directBinary)) {
                    binaryPath = directBinary;
                } else if (fs.existsSync(archBinary)) {
                    binaryPath = archBinary;
                }
            }

            if (!binaryPath) continue;

            // Search for manifest.json in directory or parent directory
            let version = 'unknown';
            const manifestLocations = [
                path.join(candidateDir, 'manifest.json'),
                path.join(path.dirname(binaryPath), 'manifest.json'),
                path.join(path.dirname(path.dirname(binaryPath)), 'manifest.json')
            ];

            for (const manifestPath of manifestLocations) {
                if (fs.existsSync(manifestPath)) {
                    try {
                        const raw = fs.readFileSync(manifestPath, 'utf8');
                        const parsed = JSON.parse(raw);
                        if (parsed && typeof parsed.version === 'string') {
                            version = parsed.version;
                            break;
                        }
                    } catch (e) {
                        // Ignore corrupt manifest and proceed
                    }
                }
            }

            return {
                status: 'ready',
                version,
                path: binaryPath,
                directory: candidateDir,
                message: MESSAGES.READY_LINUX(version, binaryPath)
            };
        } catch (e) {
            // Ignore filesystem access errors on candidate directory
        }
    }

    return {
        status: 'unavailable',
        version: null,
        path: null,
        directory: null,
        message: MESSAGES.NOT_FOUND_LINUX
    };
}

let currentStatus = null;

/**
 * Initialises Widevine subsystem and appends Chromium switches if ready.
 */
function initializeWidevine(appInstance, detectionResult = null) {
    try {
        currentStatus = detectionResult || detectWidevineCdm();

        if (currentStatus.status === 'ready' && appInstance && appInstance.commandLine) {
            if (currentStatus.path) {
                appInstance.commandLine.appendSwitch('widevine-cdm-path', currentStatus.path);
            }
            if (currentStatus.version && currentStatus.version !== 'unknown') {
                appInstance.commandLine.appendSwitch('widevine-cdm-version', currentStatus.version);
            }
        }
    } catch (err) {
        currentStatus = {
            status: 'unavailable',
            version: null,
            path: null,
            directory: null,
            message: 'Error initialising Widevine: ' + (err && err.message ? err.message : String(err))
        };
    }

    return currentStatus;
}

/**
 * Returns current or lazily detected Widevine status.
 */
function getWidevineStatus() {
    if (!currentStatus) {
        currentStatus = detectWidevineCdm();
    }
    return currentStatus;
}

/**
 * Resets cached status (used in automated tests).
 */
function resetWidevineStateForTesting() {
    currentStatus = null;
}

module.exports = {
    MESSAGES,
    getLinuxCandidatePaths,
    detectWidevineCdm,
    initializeWidevine,
    getWidevineStatus,
    resetWidevineStateForTesting
};
