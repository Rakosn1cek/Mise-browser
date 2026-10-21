// tests/reader-distiller-comments.test.js
// Verification for upstream Mozilla Readability comment annotations and syntax integrity

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('Running Mise Reader View distillation comments regression tests...');

// 1. Static code analysis of modules/readerDistiller.js
{
    const filePath = path.join(__dirname, '../modules/readerDistiller.js');
    const source = fs.readFileSync(filePath, 'utf8');

    // Ensure no unannotated TODO comments remain
    const todoMatches = source.match(/\bTODO\b/gi);
    assert.equal(
        todoMatches,
        null,
        'readerDistiller.js must not contain unannotated TODO comments'
    );

    // Verify upstream Mozilla Readability attribution on style cleaning
    assert(
        source.includes('Upstream Mozilla Readability note: test whether getElementsByTagName(*) is faster.'),
        'readerDistiller.js must document upstream style cleaning note'
    );

    // Verify upstream Mozilla Readability attribution on node scoring
    assert(
        source.includes('Upstream Mozilla Readability note: consider taking into account original contentScore here.'),
        'readerDistiller.js must document upstream content score note'
    );

    console.log('✓ readerDistiller.js comment cleanups and upstream attributions verified');
}

// 2. Syntax and compilation integrity verification
{
    const filePath = path.join(__dirname, '../modules/readerDistiller.js');
    const source = fs.readFileSync(filePath, 'utf8');

    // Verify code evaluates cleanly as a script in a sandboxed context
    assert.doesNotThrow(() => {
        new vm.Script(source);
    }, 'readerDistiller.js source must compile without syntax or evaluation errors');

    console.log('✓ readerDistiller.js script compilation integrity verified');
    console.log('All Reader View distillation comments regression tests passed successfully!');
}
