// tests/terminal-command-pastejacking.test.js
// Verification for terminal command clipboard pastejacking sanitisation and length clamping

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const security = require('../security.js');

console.log('Running Mise terminal command pastejacking sanitisation regression tests...');

// 1. Static code inspection of terminal command IPC listener
{
    const systemIpcPath = path.join(__dirname, '../main/systemIpc.js');
    const targetSource = fs.existsSync(systemIpcPath)
        ? fs.readFileSync(systemIpcPath, 'utf8')
        : fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

    assert(
        targetSource.includes("ipcMain.on('execute-terminal-command'"),
        'systemIpc.js must register execute-terminal-command IPC handler'
    );

    assert(
        targetSource.includes('security.sanitiseTerminalCommand(commandStr)'),
        'systemIpc.js must invoke security.sanitiseTerminalCommand on incoming commandStr'
    );

    assert(
        targetSource.includes('clipboard.writeText(sanitised)'),
        'systemIpc.js must copy only sanitised command string to clipboard'
    );

    console.log('✓ execute-terminal-command handler sanitisation integration verified');
}

// 2. Functional testing of security.sanitiseTerminalCommand
{
    const { sanitiseTerminalCommand } = security;
    assert(typeof sanitiseTerminalCommand === 'function', 'security.sanitiseTerminalCommand must be exported');

    // A. Clean single-line commands are preserved
    assert.equal(sanitiseTerminalCommand('git status'), 'git status');
    assert.equal(sanitiseTerminalCommand('  uname -a  '), 'uname -a');

    // B. Trailing newlines (potential auto-execution triggers) are cleanly stripped
    assert.equal(sanitiseTerminalCommand('ls -la\n'), 'ls -la');
    assert.equal(sanitiseTerminalCommand('top\r\n'), 'top');
    assert.equal(sanitiseTerminalCommand('neofetch\n\n\n'), 'neofetch');

    // C. Multiline commands are flattened to neutralise newline-split commands
    assert.equal(
        sanitiseTerminalCommand('echo "safe"\nrm -rf /'),
        'echo "safe" rm -rf /'
    );
    assert.equal(
        sanitiseTerminalCommand('cat /etc/os-release\r\nreboot'),
        'cat /etc/os-release reboot'
    );

    // D. Null bytes are stripped
    assert.equal(
        sanitiseTerminalCommand('echo test\0injection'),
        'echo test injection'
    );

    // E. Empty and whitespace/newline-only inputs return empty string
    assert.equal(sanitiseTerminalCommand(''), '');
    assert.equal(sanitiseTerminalCommand('   '), '');
    assert.equal(sanitiseTerminalCommand('\n\r\n'), '');

    // F. Non-string inputs safely return empty string
    assert.equal(sanitiseTerminalCommand(null), '');
    assert.equal(sanitiseTerminalCommand(undefined), '');
    assert.equal(sanitiseTerminalCommand(12345), '');
    assert.equal(sanitiseTerminalCommand({ cmd: 'ls' }), '');
    assert.equal(sanitiseTerminalCommand(['ls', '-la']), '');

    // G. String length clamping
    const longCommand = 'echo ' + 'a'.repeat(5000);
    const clamped = sanitiseTerminalCommand(longCommand, 4096);
    assert.equal(clamped.length, 4096, 'Command length must be bounded to specified limit');
    assert.equal(clamped.startsWith('echo '), true);

    console.log('✓ security.sanitiseTerminalCommand newline flattening, input validation, and bounding verified');
}

console.log('All terminal command pastejacking sanitisation tests passed successfully!');
