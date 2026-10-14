// tests/adblocker-build.test.js
// Verification for off-thread adblocker rule compilation and cache serialization

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const { ElectronBlocker, adsAndTrackingLists, Request } = require('@ghostery/adblocker-electron');

console.log('Running Mise off-thread adblocker build tests...');

const source = fs.readFileSync(path.join(__dirname, '../adblocker-build.js'), 'utf8');

(async () => {
    const lists = adsAndTrackingLists.map((_url, index) =>
        index % 2 ? 'example.org##.advert' : '||ads.example^\n@@||allowed.ads.example^'
    );
    let resources = JSON.stringify({ redirects: [], scriptlets: [] });
    const recipe = [];
    const exits = [];

    const context = {
        __dirname: path.resolve(__dirname, '..'),
        Uint8Array,
        fetch: () => {},
        module: { exports: {} },
        require: Object.assign(id => {
            if (id === 'node:worker_threads') {
                return {
                    Worker: class extends Worker {
                        constructor(...args) {
                            super(...args);
                            this.on('exit', code => exits.push(code));
                        }
                    }
                };
            }
            if (id === '@ghostery/adblocker-electron') {
                return {
                    ElectronBlocker,
                    adsAndTrackingLists,
                    fetchLists: async (_fetch, urls) => {
                        recipe.push(urls);
                        return lists;
                    },
                    fetchResources: async () => resources
                };
            }
            return require(id);
        }, { resolve: require.resolve })
    };

    vm.runInNewContext(source, context);
    const { blocker: engine, cacheBytes } = await context.module.exports();

    assert.deepEqual(exits, [0], 'Compiler worker must exit before engine is attached');
    assert.deepEqual(recipe, [adsAndTrackingLists]);

    const expected = await ElectronBlocker.fromPrebuiltAdsAndTracking(async url => ({
        text: async () => url.endsWith('resources.json') ? resources : lists[adsAndTrackingLists.indexOf(url)]
    }));

    assert.deepEqual(
        Buffer.from(cacheBytes),
        Buffer.from(expected.serialize()),
        'Worker output must match expected Ghostery serialized cache'
    );
    assert(engine.match(Request.fromRawDetails({ url: 'https://ads.example/banner.js', type: 'script' })).match);
    assert(!engine.match(Request.fromRawDetails({ url: 'https://allowed.ads.example/banner.js', type: 'script' })).match);

    resources = '{';
    await assert.rejects(context.module.exports(), /JSON|Unexpected|property/);
    assert.deepEqual(exits, [0, 1], 'Failed compiler worker must also cleanly exit before promise rejection');

    resources = JSON.stringify({ redirects: [], scriptlets: [] });
    await context.module.exports();
    assert.deepEqual(exits, [0, 1, 0], 'Subsequent build must be able to retry after initial failure');

    console.log('✓ Cold filter worker compiles rules off-thread and transfers cache successfully');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
