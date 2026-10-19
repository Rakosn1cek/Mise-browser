// tests/restart-app.test.js
// Tests clean restart execution and prevents immediate process termination

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { restartApp } = require('../main/config');

console.log('Running Mise restartApp and clean restart regression tests...');

// 1. Verify call order and exit prevention with a stub app object
{
    const callOrder = [];
    let exitCalled = false;

    const stubApp = {
        relaunch: () => {
            callOrder.push('relaunch');
        },
        quit: () => {
            callOrder.push('quit');
        },
        exit: () => {
            exitCalled = true;
            callOrder.push('exit');
        }
    };

    const result = restartApp(stubApp);
    assert.strictEqual(result, true, 'restartApp must return true when valid stub is supplied');
    assert.deepStrictEqual(callOrder, ['relaunch', 'quit'], 'relaunch must be called before quit');
    assert.strictEqual(exitCalled, false, 'stub exit method must never be called');
    console.log('✓ restartApp executes relaunch before quit and never invokes exit');
}

// 2. Verify fallback behaviour for invalid or incomplete app references
{
    assert.strictEqual(restartApp(undefined), false, 'restartApp must return false when app is undefined');
    assert.strictEqual(restartApp({ relaunch: () => {} }), false, 'restartApp must return false when quit is missing');
    assert.strictEqual(restartApp({ quit: () => {} }), false, 'restartApp must return false when relaunch is missing');
    assert.strictEqual(restartApp(null), false, 'restartApp must return false when app is null');
    console.log('✓ restartApp handles invalid and incomplete app references safely');
}

// 3. Source-level regression check against direct app.exit usage
{
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const configSource = fs.readFileSync(path.join(__dirname, '..', 'main', 'config.js'), 'utf8');

    assert.strictEqual(mainSource.includes('app.exit('), false, 'main.js must not contain app.exit(');
    assert.strictEqual(configSource.includes('app.exit('), false, 'config.js must not contain app.exit(');
    console.log('✓ Verified neither main.js nor config.js contains app.exit(');
}

console.log('All restartApp regression tests passed.\n');
