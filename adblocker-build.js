const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { ElectronBlocker, adsAndTrackingLists, fetchLists, fetchResources } = require('@ghostery/adblocker-electron');

// Offload CPU-heavy adblock filter compilation to a worker thread.
// Preserves Ghostery's standard fetch and retry behaviour.
module.exports = async function buildAdblocker() {
    const [lists, resources] = await Promise.all([
        fetchLists(fetch, adsAndTrackingLists),
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
    return { blocker: ElectronBlocker.deserialize(bytes), cacheBytes: bytes };
};
