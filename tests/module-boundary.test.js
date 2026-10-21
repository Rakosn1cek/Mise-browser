// tests/module-boundary.test.js
// Verification for isolated ES module boundary in modules/ directory

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

console.log('Running Mise ES module boundary regression tests...');

// 1. Verify modules/package.json exists and specifies "type": "module"
{
    const pkgPath = path.join(__dirname, '../modules/package.json');
    assert(fs.existsSync(pkgPath), 'modules/package.json must exist');

    const content = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(content.type, 'module', 'modules/package.json must specify "type": "module"');

    console.log('✓ modules/package.json presence and "type": "module" declaration verified');
}

// 2. Verify root package.json preserves CommonJS configuration
{
    const rootPkgPath = path.join(__dirname, '../package.json');
    const rootContent = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));

    assert.notEqual(
        rootContent.type,
        'module',
        'Root package.json must not set "type": "module" to protect CommonJS main process'
    );

    console.log('✓ Root package.json CommonJS compatibility preserved');
}

// 3. Functional verification: loading modules in Node emits zero MODULE_TYPELESS_PACKAGE_JSON warnings
{
    const script = `
        const { state } = require('./modules/state.js');
        const { isSafeTabUrl } = require('./modules/utils.js');
        if (!state || typeof isSafeTabUrl !== 'function') {
            process.exit(2);
        }
    `;

    const result = execFileSync(
        process.execPath,
        ['-e', script],
        {
            cwd: path.resolve(__dirname, '..'),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }
    );

    // If warnings were emitted on stderr, execFileSync would still succeed,
    // but let us explicitly capture child process stderr to verify absence of typeless warning
    const testRunner = execFileSync(
        process.execPath,
        [
            '-e',
            `
            const { spawnSync } = require('child_process');
            const res = spawnSync(process.execPath, ['-e', ${JSON.stringify(script)}], { encoding: 'utf8' });
            process.stdout.write(res.stderr || '');
            `
        ],
        {
            cwd: path.resolve(__dirname, '..'),
            encoding: 'utf8'
        }
    );

    assert.equal(
        testRunner.includes('MODULE_TYPELESS_PACKAGE_JSON'),
        false,
        'Loading modules must not trigger MODULE_TYPELESS_PACKAGE_JSON warnings'
    );

    console.log('✓ Zero MODULE_TYPELESS_PACKAGE_JSON warnings verified during module imports');
}

console.log('All ES module boundary regression tests passed successfully!');
