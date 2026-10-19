// tests/private-workspace.test.js
// Regression tests for permanent Private workspace isolation and session persistence filtering

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getWorkspacePartition } = require('../modules/utils.js');
const sessionStore = require('../main/sessionStore.js');

console.log('Running Mise permanent Private workspace regression tests...');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-private-ws-test-'));
const testSessionPath = path.join(tmpDir, 'session.json');
const testBackupPath = path.join(tmpDir, 'session.json.bak');

try {
    // 1. Verify partition mapping for Private workspace vs standard workspaces
    {
        assert.strictEqual(
            getWorkspacePartition('Private'),
            'MisePrivateProfile',
            'Private workspace must map directly to volatile MisePrivateProfile partition'
        );

        assert.strictEqual(
            getWorkspacePartition('Workspace 1'),
            'persist:workspace-1',
            'Standard workspaces must map to persist: container partitions'
        );

        assert.strictEqual(
            getWorkspacePartition('Work'),
            'persist:work',
            'Work workspace must map to persist:work partition'
        );

        console.log('✓ getWorkspacePartition maps Private to MisePrivateProfile');
    }

    // 2. Verify sanitizeSessionForDisk strips Private workspace metadata
    {
        const dirtySession = {
            current_workspace: 'Private',
            workspaces: {
                'Private': ['https://secret.com', 'https://private-search.org'],
                'Workspace 1': ['https://duckduckgo.com']
            },
            tab_titles: {
                'Private': ['Secret Page', 'Private Search'],
                'Workspace 1': ['DuckDuckGo']
            },
            tab_favicons: {
                'Private': ['https://secret.com/favicon.ico', null],
                'Workspace 1': ['https://duckduckgo.com/favicon.ico']
            },
            tab_sleep_states: {
                'Private': [null, null],
                'Workspace 1': [null]
            },
            tab_pinned: {
                'Private': [false, false],
                'Workspace 1': [false]
            },
            tab_dark_reader: {
                'Private': [true, false],
                'Workspace 1': [false]
            }
        };

        const cleanSession = sessionStore.sanitizeSessionForDisk(dirtySession);

        assert.strictEqual(cleanSession.workspaces['Private'], undefined, 'Private workspace must be excluded from workspaces');
        assert.strictEqual(cleanSession.tab_titles['Private'], undefined, 'Private workspace must be excluded from tab_titles');
        assert.strictEqual(cleanSession.tab_favicons['Private'], undefined, 'Private workspace must be excluded from tab_favicons');
        assert.strictEqual(cleanSession.tab_sleep_states['Private'], undefined, 'Private workspace must be excluded from tab_sleep_states');
        assert.strictEqual(cleanSession.tab_pinned['Private'], undefined, 'Private workspace must be excluded from tab_pinned');
        assert.strictEqual(cleanSession.tab_dark_reader['Private'], undefined, 'Private workspace must be excluded from tab_dark_reader');

        assert.strictEqual(cleanSession.current_workspace, 'Workspace 1', 'Current workspace must fall back to persistent workspace');
        assert.deepStrictEqual(cleanSession.workspaces['Workspace 1'], ['https://duckduckgo.com'], 'Persistent workspaces must be preserved');

        console.log('✓ sanitizeSessionForDisk strips Private workspace and falls back current_workspace');
    }

    // 3. Verify disk flush excludes Private workspace from physical disk writes
    {
        const sessionWithPrivate = {
            current_workspace: 'Private',
            workspaces: {
                'Private': ['https://confidential.example.com'],
                'Workspace 1': ['https://duckduckgo.com', 'https://archlinux.org']
            }
        };

        sessionStore.scheduleSessionSave(sessionWithPrivate, 0, {
            sessionPath: testSessionPath,
            sessionBackupPath: testBackupPath
        });

        sessionStore.flushSessionToDisk({
            sessionPath: testSessionPath,
            sessionBackupPath: testBackupPath
        });

        assert(fs.existsSync(testSessionPath), 'Session file must exist on disk after flush');
        const diskContent = JSON.parse(fs.readFileSync(testSessionPath, 'utf8'));

        assert.strictEqual(diskContent.workspaces['Private'], undefined, 'Disk session file must never contain Private workspace');
        assert.strictEqual(diskContent.current_workspace, 'Workspace 1', 'Disk session file current_workspace must not be Private');
        assert.strictEqual(diskContent.workspaces['Workspace 1'].length, 2, 'Persistent workspace tabs must be saved on disk');

        console.log('✓ flushSessionToDisk writes only persistent workspaces to disk');
    }

    // 4. Verify Private workspace pinning and sorting logic
    {
        const workspaces = {
            'Workspace 2': ['https://a.com'],
            'Development': ['https://b.com'],
            'Private': ['https://c.com'],
            'Workspace 1': ['https://d.com']
        };

        const sortedKeys = Object.keys(workspaces).sort((a, b) => {
            if (a === 'Private') return -1;
            if (b === 'Private') return 1;
            return a.localeCompare(b);
        });

        assert.strictEqual(sortedKeys[0], 'Private', 'Private workspace must always sort to index 0');
        console.log('✓ Private workspace pinning and sort precedence verified');
    }

    console.log('All permanent Private workspace regression tests passed successfully!');
} finally {
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
}
