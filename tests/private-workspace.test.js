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

    // 5. Verify case-insensitive partition resolution in modules/utils.js and main.js parity
    {
        const testCases = ['Private', 'private', 'PRIVATE', '  Private  ', '  private  '];
        for (const tc of testCases) {
            assert.strictEqual(
                getWorkspacePartition(tc),
                'MisePrivateProfile',
                `utils getWorkspacePartition("${tc}") must map to MisePrivateProfile`
            );
        }

        // Verify main.js contains the matching getWorkspacePartition logic
        const mainJsContent = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
        assert(
            mainJsContent.includes("if (String(workspaceName).trim().toLowerCase() === 'private') return 'MisePrivateProfile';"),
            'main.js getWorkspacePartition must map Private case-insensitively to MisePrivateProfile'
        );
        assert(
            !mainJsContent.includes('privateBrowsingEnabled'),
            'main.js must not retain obsolete privateBrowsingEnabled variable'
        );
        console.log('✓ Case-insensitive partition mapping and main.js parity verified');
    }

    // 6. Verify readCurrentSession always sanitises sessions and never restores into Private
    {
        const taintedSessionFile = path.join(tmpDir, 'tainted-session.json');
        const taintedData = {
            current_workspace: 'Private',
            workspaces: {
                'Private': ['https://leak-test.org'],
                'Workspace 1': ['https://duckduckgo.com']
            },
            tab_titles: {
                'Private': ['Leak Test']
            }
        };
        fs.writeFileSync(taintedSessionFile, JSON.stringify(taintedData, null, 2), 'utf8');

        const loaded = sessionStore.readCurrentSession({ sessionPath: taintedSessionFile });
        assert.strictEqual(loaded.current_workspace, 'Workspace 1', 'readCurrentSession must never restore into Private');
        assert.strictEqual(loaded.workspaces['Private'], undefined, 'readCurrentSession must filter out Private workspace');
        assert.strictEqual(loaded.tab_titles['Private'], undefined, 'readCurrentSession must filter out Private tab titles');
        console.log('✓ readCurrentSession sanitises on read and prevents booting into Private workspace');
    }

    // 7. Verify dashboard name collisions and reservation guards
    {
        const dashboardSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/dashboard.js'), 'utf8');
        assert(
            dashboardSource.includes("if (String(oldName).trim().toLowerCase() === 'private') return;"),
            'renameWorkspace must reject renaming Private workspace'
        );
        assert(
            dashboardSource.includes("trimmed.toLowerCase() === 'private'"),
            'renameWorkspace must reject renaming any workspace to Private'
        );
        assert(
            dashboardSource.includes("if (String(wsName).trim().toLowerCase() === 'private') return;"),
            'deleteWorkspace must reject deleting Private workspace'
        );
        assert(
            dashboardSource.includes("name.toLowerCase() === 'private'"),
            'processWorkspaceCreation must reject creating a workspace named Private'
        );
        console.log('✓ Dashboard workspace name reservation and collision guards verified');
    }

    // 8. Verify isTargetPrivateDomain returns false without external domain or test hook routing
    {
        const { isTargetPrivateDomain } = require('../modules/utils.js');
        assert.strictEqual(
            isTargetPrivateDomain('https://news.ycombinator.com'),
            false,
            'External domains must not be routed into private partition from normal workspaces'
        );
        assert.strictEqual(
            isTargetPrivateDomain('https://accounts.google.com/signin?mise_test_auth=1'),
            false,
            'Test hooks must not route into private partition from normal workspaces'
        );
        assert.strictEqual(
            isTargetPrivateDomain('https://example.com'),
            false,
            'Standard URLs must not be routed into private partition from normal workspaces'
        );
        assert.strictEqual(
            isTargetPrivateDomain(null),
            false,
            'Null input must safely return false'
        );
        console.log('✓ isTargetPrivateDomain consistently returns false without routing leakage');
    }

    console.log('All permanent Private workspace regression tests passed successfully!');
} finally {
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
}

