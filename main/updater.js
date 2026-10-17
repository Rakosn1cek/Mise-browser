const https = require('https');

let electronModule;
try {
    electronModule = require('electron');
} catch (e) {
    electronModule = {};
}
const app = electronModule && electronModule.app ? electronModule.app : null;

function isNewerVersion(latest, current) {
    const cleanL = String(latest || '').replace(/^v/i, '').trim();
    const cleanC = String(current || '').replace(/^v/i, '').trim();
    const partsL = cleanL.split('.').map(n => parseInt(n, 10) || 0);
    const partsC = cleanC.split('.').map(n => parseInt(n, 10) || 0);
    const maxLen = Math.max(partsL.length, partsC.length);
    for (let i = 0; i < maxLen; i++) {
        const l = partsL[i] || 0;
        const c = partsC[i] || 0;
        if (l > c) return true;
        if (l < c) return false;
    }
    return false;
}

function fetchLatestRelease(currentVersion = '1.0.0', httpsModule = https) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: '/repos/Rakosn1cek/Mise-browser/releases/latest',
            headers: {
                'User-Agent': `Mise-Browser/${currentVersion}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 10000
        };

        const req = httpsModule.get(options, (res) => {
            if (res.statusCode === 404) {
                return resolve(null);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`GitHub API returned status ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });
    });
}

function getAppVersion(targetApp = app) {
    return {
        version: targetApp && targetApp.getVersion ? targetApp.getVersion() : '1.0.0',
        electron: process.versions.electron || '',
        chrome: process.versions.chrome || '',
        node: process.versions.node || ''
    };
}

async function checkAppUpdates(manual = false, options = {}) {
    const targetApp = options.app || app;
    const currentVersion = targetApp && targetApp.getVersion ? targetApp.getVersion() : (options.currentVersion || '1.0.0');
    const fetchFn = options.fetchLatestRelease || fetchLatestRelease;

    try {
        const release = await fetchFn(currentVersion);
        if (!release || !release.tag_name) {
            return { updateAvailable: false, currentVersion, checkedAt: Date.now(), manual };
        }
        const latestTag = release.tag_name;
        const updateAvailable = isNewerVersion(latestTag, currentVersion);
        return {
            updateAvailable,
            currentVersion,
            latestVersion: latestTag,
            releaseName: release.name || latestTag,
            releaseUrl: release.html_url || 'https://github.com/Rakosn1cek/Mise-browser/releases',
            publishedAt: release.published_at,
            releaseNotes: release.body || '',
            checkedAt: Date.now(),
            manual
        };
    } catch (err) {
        return {
            error: err.message,
            updateAvailable: false,
            currentVersion,
            checkedAt: Date.now(),
            manual
        };
    }
}

function registerUpdaterIpc(ipcMain, options = {}) {
    ipcMain.handle('get-app-version', () => {
        return getAppVersion(options.app || app);
    });

    ipcMain.handle('check-for-updates', async (event, manual = false) => {
        return checkAppUpdates(manual, options);
    });
}

module.exports = {
    isNewerVersion,
    fetchLatestRelease,
    getAppVersion,
    checkAppUpdates,
    registerUpdaterIpc
};
