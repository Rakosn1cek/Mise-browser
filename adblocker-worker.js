const { parentPort, workerData } = require('node:worker_threads');
const { FiltersEngine } = require(workerData.engineModulePath);

// One-shot worker parsing adblock rule lists off the main event loop
const engine = FiltersEngine.parse(workerData.lists.join('\n'));
if (workerData.resources !== undefined) {
    engine.updateResources(workerData.resources, String(workerData.resources.length));
}
const bytes = engine.serialize();
parentPort.postMessage(bytes, [bytes.buffer]);
parentPort.close();
