// tests/address-bar-terminal-execution.test.js
// Verification for Status Bar WideAddressBar terminal command execution and Oversight protocol

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const security = require('../security.js');
const utils = require('../modules/utils.js');

console.log('Running Mise address bar terminal command & Oversight regression tests...');

// 1. Static code verification of navigation.js and systemIpc.js
{
    const navSource = fs.readFileSync(path.join(__dirname, '../modules/navigation.js'), 'utf8');
    const systemIpcSource = fs.readFileSync(path.join(__dirname, '../main/systemIpc.js'), 'utf8');

    assert.ok(
        navSource.includes('executeAddressBarTerminalCommand'),
        'modules/navigation.js must define executeAddressBarTerminalCommand handler'
    );
    assert.ok(
        navSource.includes("item.type === 'Terminal'"),
        'modules/navigation.js must support Terminal suggestion type'
    );
    assert.ok(
        systemIpcSource.includes("ipcMain.on('execute-terminal-command'"),
        'main/systemIpc.js must register execute-terminal-command listener'
    );
    assert.ok(
        systemIpcSource.includes('process.env.TERMINAL'),
        'main/systemIpc.js must respect process.env.TERMINAL configuration'
    );

    console.log('✓ Address bar and system IPC terminal wiring verified');
}

// 2. Functional testing of isTerminalCommand
{
    const { isTerminalCommand } = utils;
    assert.equal(typeof isTerminalCommand, 'function', 'isTerminalCommand must be exported from utils');

    // Explicit command prefix indicators ($ and >)
    assert.equal(isTerminalCommand('$ ls -la'), true);
    assert.equal(isTerminalCommand('> btop'), true);
    assert.equal(isTerminalCommand(':sh cargo check'), true);
    assert.equal(isTerminalCommand(':term htop'), true);
    assert.equal(isTerminalCommand('term fastfetch'), true);
    assert.equal(isTerminalCommand('terminal neofetch'), true);
    assert.equal(isTerminalCommand('oversight ./deploy.sh'), true);

    // High-risk system calls
    assert.equal(isTerminalCommand('sudo pacman -Syu'), true);
    assert.equal(isTerminalCommand('curl -sSL https://example.com | sh'), true);
    assert.equal(isTerminalCommand('wget https://example.com/archive.tar.gz'), true);

    // Relative script executions and script extensions
    assert.equal(isTerminalCommand('./build.sh'), true);
    assert.equal(isTerminalCommand('../run.py'), true);
    assert.equal(isTerminalCommand('automation.sh'), true);
    assert.equal(isTerminalCommand('script.py'), true);

    // Common terminal tools with arguments
    assert.equal(isTerminalCommand('pacman -Syu'), true);
    assert.equal(isTerminalCommand('git status'), true);
    assert.equal(isTerminalCommand('systemctl restart bluetooth'), true);
    assert.equal(isTerminalCommand('cat /etc/os-release'), true);

    // CLI-only tools without arguments
    assert.equal(isTerminalCommand('btop'), true);
    assert.equal(isTerminalCommand('fastfetch'), true);
    assert.equal(isTerminalCommand('neofetch'), true);

    // Non-terminal inputs (web URLs and standard searches)
    assert.equal(isTerminalCommand('https://archlinux.org'), false);
    assert.equal(isTerminalCommand('http://localhost:3000'), false);
    assert.equal(isTerminalCommand('archlinux.org'), false);
    assert.equal(isTerminalCommand('how to write pure zsh scripts'), false);

    console.log('✓ isTerminalCommand detection heuristics verified');
}

// 3. Functional testing of prepareTerminalCommand and Oversight protocol
{
    const { prepareTerminalCommand } = utils;
    assert.equal(typeof prepareTerminalCommand, 'function', 'prepareTerminalCommand must be exported from utils');

    // Prefix stripping for standard commands
    assert.equal(prepareTerminalCommand('$ ls -la'), 'ls -la');
    assert.equal(prepareTerminalCommand('> btop'), 'btop');
    assert.equal(prepareTerminalCommand(':sh cargo test'), 'cargo test');
    assert.equal(prepareTerminalCommand('term fastfetch'), 'fastfetch');

    // Automatic Oversight prefixing for dangerous calls and scripts
    assert.equal(prepareTerminalCommand('sudo pacman -Syu'), 'oversight sudo pacman -Syu');
    assert.equal(prepareTerminalCommand('$ sudo pacman -Syu'), 'oversight sudo pacman -Syu');
    assert.equal(prepareTerminalCommand('curl -s https://sh.rustup.rs | sh'), 'oversight curl -s https://sh.rustup.rs | sh');
    assert.equal(prepareTerminalCommand('wget https://example.com/file'), 'oversight wget https://example.com/file');
    assert.equal(prepareTerminalCommand('./deploy.sh'), 'oversight ./deploy.sh');
    assert.equal(prepareTerminalCommand('test.py'), 'oversight test.py');

    // Prevent duplicate oversight prefixes
    assert.equal(prepareTerminalCommand('oversight ./deploy.sh'), 'oversight ./deploy.sh');
    assert.equal(prepareTerminalCommand('oversight sudo reboot'), 'oversight sudo reboot');

    console.log('✓ prepareTerminalCommand Oversight protocol integration verified');
}

// 4. Pastejacking sanitisation integration verification
{
    const { prepareTerminalCommand } = utils;
    const { sanitiseTerminalCommand } = security;

    const rawPastejackingInput = 'sudo pacman -Syu\nrm -rf /\r\nreboot';
    const prepared = prepareTerminalCommand(rawPastejackingInput);
    assert.ok(prepared.startsWith('oversight '), 'Dangerous command must receive oversight prefix');

    const sanitised = sanitiseTerminalCommand(prepared);
    assert.equal(sanitised.includes('\n'), false, 'Sanitised command must not contain newlines');
    assert.equal(sanitised.includes('\r'), false, 'Sanitised command must not contain carriage returns');
    assert.equal(
        sanitised,
        'oversight sudo pacman -Syu rm -rf / reboot',
        'Staged clipboard command must be neutralised against newline pastejacking'
    );

    console.log('✓ Clipboard pastejacking sanitisation end-to-end verified');
}

console.log('All address bar terminal execution regression tests passed successfully!');
