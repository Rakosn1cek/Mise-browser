const path = require('node:path');
const { Worker } = require('node:worker_threads');
const {
    ElectronBlocker,
    adsLists,
    adsAndTrackingLists,
    fetchLists,
    fetchResources
} = require('@ghostery/adblocker-electron');

const TRACKING_LIST_URLS = [
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/easylist/easyprivacy.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/privacy.txt'
];

const ANNOYANCE_LIST_URLS = [
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/easylist/easylist-cookie.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/annoyances-others.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/annoyances-cookies.txt'
];

const SOCIAL_LIST_URLS = [
    'https://easylist-downloads.adblockplus.org/fanboy-social.txt'
];

function resolveListUrls(filterLists) {
    if (!filterLists) {
        return adsAndTrackingLists;
    }
    const isDefaultPreset = filterLists.easylist !== false &&
        filterLists.easyprivacy !== false &&
        !filterLists.annoyances &&
        !filterLists.social &&
        (!filterLists.custom_urls || filterLists.custom_urls.length === 0);

    if (isDefaultPreset) {
        return adsAndTrackingLists;
    }

    const urls = new Set();
    if (filterLists.easylist !== false && Array.isArray(adsLists)) {
        adsLists.forEach(u => urls.add(u));
    }
    if (filterLists.easyprivacy !== false) {
        TRACKING_LIST_URLS.forEach(u => urls.add(u));
    }
    if (filterLists.annoyances === true) {
        ANNOYANCE_LIST_URLS.forEach(u => urls.add(u));
    }
    if (filterLists.social === true) {
        SOCIAL_LIST_URLS.forEach(u => urls.add(u));
    }
    if (Array.isArray(filterLists.custom_urls)) {
        filterLists.custom_urls.forEach(u => {
            if (typeof u === 'string' && u.startsWith('https://')) {
                urls.add(u.trim());
            }
        });
    }
    return urls.size > 0 ? Array.from(urls) : adsAndTrackingLists;
}

// Offload CPU-heavy adblock filter compilation to a worker thread.
// Preserves Ghostery's standard fetch and retry behaviour.
async function buildAdblocker(filterLists) {
    const urls = resolveListUrls(filterLists);
    const [lists, resources] = await Promise.all([
        fetchLists(fetch, urls),
        fetchResources(fetch)
    ]);
    const bytes = await new Promise((resolve, reject) => {
        let result, failure;
        const worker = new Worker(path.join(__dirname, 'adblocker-worker.js'), {
            workerData: {
                lists,
                resources,
                engineModulePath: require.resolve('@ghostery/adblocker', {
                    paths: [path.dirname(require.resolve('@ghostery/adblocker-electron'))]
                })
            }
        });
        worker.once('message', value => { result = value; });
        worker.once('error', error => { failure = error; });
        worker.once('exit', code => {
            if (failure) {
                reject(failure);
            } else if (code === 0 && result instanceof Uint8Array) {
                resolve(result);
            } else {
                reject(new Error(`Filter compiler worker exited unexpectedly (code ${code}).`));
            }
        });
    });
    return { blocker: ElectronBlocker.deserialize(bytes), cacheBytes: bytes, urls };
}

buildAdblocker.resolveListUrls = resolveListUrls;
buildAdblocker.TRACKING_LIST_URLS = TRACKING_LIST_URLS;
buildAdblocker.ANNOYANCE_LIST_URLS = ANNOYANCE_LIST_URLS;
buildAdblocker.SOCIAL_LIST_URLS = SOCIAL_LIST_URLS;

module.exports = buildAdblocker;
