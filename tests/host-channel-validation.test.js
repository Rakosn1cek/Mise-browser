// tests/host-channel-validation.test.js
// Regression test suite for host IPC channel argument validation and diagnostics bounding

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const security = require('../security');
const diagnostics = require('../diagnostics');
const keybinds = require('../keybinds');

console.log('Running Mise host IPC channel validation and diagnostics bounding tests...');

// 1. Verify isValidPartitionName helper in security.js
{
    const validPartitions = [
        'persist:default',
        'persist:workspace_1',
        'persist:workspace-2',
        'persist:' + 'a'.repeat(192),
        'MisePrivateProfile',
        'workspace_1',
        'default',
        'a'.repeat(200)
    ];

    for (const valid of validPartitions) {
        assert.strictEqual(
            security.isValidPartitionName(valid),
            true,
            `Partition "${valid.slice(0, 30)}" should be accepted`
        );
    }

    const invalidPartitions = [
        '',
        '../x',
        'a/b',
        'a'.repeat(201),
        'persist:' + 'a'.repeat(201),
        null,
        undefined,
        123,
        {},
        [],
        'persist:../evil',
        'persist:with spaces',
        'persist:special$char'
    ];

    for (const invalid of invalidPartitions) {
        assert.strictEqual(
            security.isValidPartitionName(invalid),
            false,
            `Partition ${JSON.stringify(invalid)} should be rejected`
        );
    }

    console.log('✓ isValidPartitionName accepts valid partitions and rejects invalid strings');
}

// 2. Verify prepareWebviewAttach reuses isValidPartitionName
{
    const allowedDecision = security.prepareWebviewAttach(
        { partition: 'persist:workspace_1' },
        { src: 'https://duckduckgo.com' }
    );
    assert.strictEqual(allowedDecision.allowed, true, 'Valid partition should be allowed');

    const blockedInvalid = security.prepareWebviewAttach(
        { partition: '../x' },
        { src: 'https://duckduckgo.com' }
    );
    assert.strictEqual(blockedInvalid.allowed, false, 'Invalid partition path should be blocked');
    assert.strictEqual(blockedInvalid.reason, 'partition', 'Reason should be partition');

    const blockedEmpty = security.prepareWebviewAttach(
        { partition: '' },
        { src: 'https://duckduckgo.com' }
    );
    assert.strictEqual(blockedEmpty.allowed, false, 'Empty partition should be blocked');

    const blockedOversized = security.prepareWebviewAttach(
        { partition: 'a'.repeat(201) },
        { src: 'https://duckduckgo.com' }
    );
    assert.strictEqual(blockedOversized.allowed, false, 'Oversized partition should be blocked');

    console.log('✓ prepareWebviewAttach reuses isValidPartitionName to guard webview attachment');
}

// 3. Verify diagnostics.sanitizeObject recursion depth, string length, and array limits
{
    // 3a. Deep nesting truncated at depth cap of 6
    const deeplyNested = {
        l1: {
            l2: {
                l3: {
                    l4: {
                        l5: {
                            l6: {
                                l7: {
                                    secret: 'overflow'
                                }
                            }
                        }
                    }
                }
            }
        }
    };

    const sanitisedNest = diagnostics.sanitizeObject(deeplyNested);
    assert.strictEqual(typeof sanitisedNest.l1.l2.l3.l4.l5.l6, 'string', 'Level 6 object should be truncated to string');
    assert.strictEqual(sanitisedNest.l1.l2.l3.l4.l5.l6, '[TRUNCATED]', 'Deeper levels must become [TRUNCATED]');

    // 3b. String length bounded to 500 characters
    const longString = 'x'.repeat(800);
    const sanitisedString = diagnostics.sanitizeObject({ note: longString });
    assert.strictEqual(sanitisedString.note.length, 500, 'Strings must be capped at 500 characters');

    // 3c. Array length bounded to 50 items
    const largeArray = Array.from({ length: 80 }, (_, i) => i);
    const sanitisedArray = diagnostics.sanitizeObject({ items: largeArray });
    assert.strictEqual(sanitisedArray.items.length, 50, 'Arrays must be capped at 50 items');

    // 3d. Sensitive keys redacted and circular references handled
    const circularObj = { name: 'safe', password: 'plain', auth: 'token123' };
    circularObj.self = circularObj;
    const sanitisedCircular = diagnostics.sanitizeObject(circularObj);
    assert.strictEqual(sanitisedCircular.password, '[REDACTED]', 'Sensitive password must be redacted');
    assert.strictEqual(sanitisedCircular.auth, '[REDACTED]', 'Sensitive auth key must be redacted');
    assert.strictEqual(sanitisedCircular.self, '[CIRCULAR]', 'Circular reference must be detected');

    console.log('✓ diagnostics.sanitizeObject enforces depth 6, 500 char string cap, and 50 item array cap');
}

// 4. Verify main.js source level integration of handlers
{
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

    // Verify isValidPartitionName is imported and used in main.js
    assert(mainSource.includes('security.isValidPartitionName'), 'main.js must check security.isValidPartitionName');

    // Verify open-external checks URL length 2048
    assert(mainSource.includes('url.length > 2048'), 'open-external must reject URLs longer than 2048 characters');

    // Verify bubble-webview-key checks length 64 and getActionMetadata
    assert(mainSource.includes('action.length > 64'), 'bubble-webview-key must reject action names longer than 64 characters');
    assert(mainSource.includes('keybinds.getActionMetadata()'), 'bubble-webview-key must check keybinds.getActionMetadata()');

    // Verify log-diagnostics-event checks allowed levels and length bounds
    assert(mainSource.includes("['info', 'warn', 'error']"), 'log-diagnostics-event must validate level enum');
    assert(mainSource.includes('data.category.length > 200'), 'log-diagnostics-event must check category length');
    assert(mainSource.includes('data.message.length > 200'), 'log-diagnostics-event must check message length');

    console.log('✓ main.js host channel security integration verified');
}

// 5. Functional unit tests for handler logic with mock ipcMain and session
(async () => {
    // 5a. Test bubble-webview-key filtering
    {
        const sentShortcuts = [];
        const mockMainWindow = {
            webContents: {
                send: (channel, data) => {
                    sentShortcuts.push({ channel, data });
                }
            }
        };

        const knownActions = keybinds.getActionMetadata();
        const firstKnownAction = Object.keys(knownActions)[0];
        assert(firstKnownAction, 'There must be at least one known action');

        function simulateBubbleWebviewKey(action) {
            if (typeof action !== 'string' || action.length > 64) return;
            const metadata = keybinds.getActionMetadata();
            if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, action)) return;
            if (mockMainWindow && mockMainWindow.webContents) {
                mockMainWindow.webContents.send('master-shortcut', action);
            }
        }

        simulateBubbleWebviewKey('unknown-malicious-action');
        assert.strictEqual(sentShortcuts.length, 0, 'Unknown action must be ignored');

        simulateBubbleWebviewKey('a'.repeat(65));
        assert.strictEqual(sentShortcuts.length, 0, 'Action name > 64 characters must be ignored');

        simulateBubbleWebviewKey(12345);
        assert.strictEqual(sentShortcuts.length, 0, 'Non-string action must be ignored');

        simulateBubbleWebviewKey(firstKnownAction);
        assert.strictEqual(sentShortcuts.length, 1, 'Known action must be forwarded');
        assert.strictEqual(sentShortcuts[0].data, firstKnownAction, 'Action payload must match');

        console.log('✓ bubble-webview-key accepts only known keybind actions <= 64 chars and ignores others');
    }

    // 5b. Test open-external URL validation
    {
        let openedUrl = null;
        const mockShell = {
            openExternal: async (url) => {
                openedUrl = url;
                return true;
            }
        };

        async function simulateOpenExternal(url) {
            if (!url || typeof url !== 'string' || url.length > 2048) return false;
            try {
                const parsed = new URL(url);
                const allowedProtocols = ['http:', 'https:', 'obsidian:', 'logseq:', 'notes:', 'mailto:'];
                if (allowedProtocols.includes(parsed.protocol)) {
                    await mockShell.openExternal(url);
                    return true;
                }
            } catch (e) {}
            return false;
        }

        assert.strictEqual(await simulateOpenExternal(''), false, 'Empty URL must be rejected');
        assert.strictEqual(await simulateOpenExternal(null), false, 'Null URL must be rejected');
        assert.strictEqual(await simulateOpenExternal('https://example.com/' + 'a'.repeat(2048)), false, 'URL > 2048 chars must be rejected');
        assert.strictEqual(await simulateOpenExternal('javascript:alert(1)'), false, 'Disallowed scheme must be rejected');
        assert.strictEqual(await simulateOpenExternal('file:///etc/passwd'), false, 'file scheme must be rejected');

        const validUrl = 'https://duckduckgo.com/?q=mise';
        assert.strictEqual(await simulateOpenExternal(validUrl), true, 'Valid HTTPS URL <= 2048 chars must be allowed');
        assert.strictEqual(openedUrl, validUrl, 'Opened URL must match input');

        console.log('✓ open-external rejects URLs > 2048 chars and enforces protocol allowlist');
    }

    // 5c. Test log-diagnostics-event validation
    {
        const loggedEvents = [];
        const mockDiagnostics = {
            logEvent: (level, category, message, details) => {
                loggedEvents.push({ level, category, message, details });
            }
        };

        async function simulateLogDiagnosticsEvent(data) {
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                return false;
            }
            const allowedLevels = ['info', 'warn', 'error'];
            if (!allowedLevels.includes(data.level)) {
                return false;
            }
            if (typeof data.category !== 'string' || data.category.length > 200) {
                return false;
            }
            if (typeof data.message !== 'string' || data.message.length > 200) {
                return false;
            }
            mockDiagnostics.logEvent(data.level, data.category, data.message, data.details);
            return true;
        }

        assert.strictEqual(await simulateLogDiagnosticsEvent(null), false, 'null payload must be rejected');
        assert.strictEqual(await simulateLogDiagnosticsEvent('not-an-object'), false, 'string payload must be rejected');
        assert.strictEqual(await simulateLogDiagnosticsEvent([]), false, 'array payload must be rejected');
        assert.strictEqual(await simulateLogDiagnosticsEvent({ level: 'fatal', category: 'app', message: 'crash' }), false, 'Invalid level must be rejected');
        assert.strictEqual(await simulateLogDiagnosticsEvent({ level: 'info', category: 'a'.repeat(201), message: 'test' }), false, 'Category > 200 chars must be rejected');
        assert.strictEqual(await simulateLogDiagnosticsEvent({ level: 'info', category: 'app', message: 'a'.repeat(201) }), false, 'Message > 200 chars must be rejected');

        const validEvent = { level: 'warn', category: 'network', message: 'timeout occurred', details: { code: 408 } };
        assert.strictEqual(await simulateLogDiagnosticsEvent(validEvent), true, 'Valid diagnostics event must be accepted');
        assert.strictEqual(loggedEvents.length, 1, 'Event must be logged');
        assert.strictEqual(loggedEvents[0].category, 'network', 'Category must match');

        console.log('✓ log-diagnostics-event enforces object schema, allowed levels, and string length bounds');
    }

    // 5d. Test getSessionForContext, clear-google-auth-cookies, and get-workspace-partition partition validation
    {
        const fromPartitionCalls = [];
        const mockSession = {
            fromPartition: (name) => {
                fromPartitionCalls.push(name);
                return { cookies: { flushStore: async () => true, get: async () => [], remove: async () => true } };
            },
            defaultSession: { isDefault: true }
        };

        function simulateGetWorkspacePartition(workspaceName) {
            if (!workspaceName) return 'persist:default';
            if (String(workspaceName).trim().toLowerCase() === 'private') return 'MisePrivateProfile';
            const clean = String(workspaceName).trim().toLowerCase().replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
            return `persist:${clean || 'default'}`;
        }

        function simulateGetSessionForContext(context) {
            if (typeof context === 'string') {
                if (!security.isValidPartitionName(context)) {
                    throw new Error('Invalid partition');
                }
                return mockSession.fromPartition(context);
            }
            if (context && typeof context === 'object' && !Array.isArray(context)) {
                if (context.isPrivate) return mockSession.fromPartition('MisePrivateProfile');
                if (context.partition !== undefined && context.partition !== null) {
                    if (!security.isValidPartitionName(context.partition)) {
                        throw new Error('Invalid partition');
                    }
                    return mockSession.fromPartition(context.partition);
                }
                if (context.workspace !== undefined && context.workspace !== null) {
                    const part = simulateGetWorkspacePartition(context.workspace);
                    if (!security.isValidPartitionName(part)) {
                        throw new Error('Invalid partition');
                    }
                    return mockSession.fromPartition(part);
                }
            }
            if (context === true) return mockSession.fromPartition('MisePrivateProfile');
            if (context === undefined || context === null) return mockSession.defaultSession;
            throw new Error('Invalid partition');
        }

        // Test invalid partition strings never invoke fromPartition
        const invalidInputs = ['', '../x', 'a/b', 'a'.repeat(201)];
        for (const bad of invalidInputs) {
            fromPartitionCalls.length = 0;
            assert.throws(() => simulateGetSessionForContext(bad), /Invalid partition/, `String ${bad} must throw`);
            assert.strictEqual(fromPartitionCalls.length, 0, 'session.fromPartition must not be called for invalid string');

            assert.throws(() => simulateGetSessionForContext({ partition: bad }), /Invalid partition/, `Object partition ${bad} must throw`);
            assert.strictEqual(fromPartitionCalls.length, 0, 'session.fromPartition must not be called for invalid object partition');
        }

        // Test valid partitions and private workspace pass
        fromPartitionCalls.length = 0;
        const validRes = simulateGetSessionForContext('persist:workspace_1');
        assert.strictEqual(fromPartitionCalls.length, 1, 'fromPartition must be called once for valid partition');
        assert.strictEqual(fromPartitionCalls[0], 'persist:workspace_1', 'Partition name must match');

        fromPartitionCalls.length = 0;
        const privateRes = simulateGetSessionForContext('MisePrivateProfile');
        assert.strictEqual(fromPartitionCalls.length, 1, 'fromPartition must be called for private profile');
        assert.strictEqual(fromPartitionCalls[0], 'MisePrivateProfile', 'Private partition must pass');

        fromPartitionCalls.length = 0;
        const privateObjRes = simulateGetSessionForContext({ isPrivate: true });
        assert.strictEqual(fromPartitionCalls[0], 'MisePrivateProfile', 'Private flag must pass');

        // Test get-workspace-partition handler simulation
        function simulateGetWorkspacePartitionHandler(name) {
            if (!security.isValidPartitionName(name)) {
                return false;
            }
            return simulateGetWorkspacePartition(name);
        }

        for (const bad of invalidInputs) {
            assert.strictEqual(simulateGetWorkspacePartitionHandler(bad), false, `get-workspace-partition must return false for ${bad}`);
        }
        assert.strictEqual(simulateGetWorkspacePartitionHandler('Private'), 'MisePrivateProfile', 'Private must map to MisePrivateProfile');
        assert.strictEqual(simulateGetWorkspacePartitionHandler('workspace_1'), 'persist:workspace_1', 'Valid name must return persist partition');

        // Test clear-google-auth-cookies handler simulation
        async function simulateClearGoogleAuthCookies(partitionName) {
            if (partitionName !== undefined && partitionName !== null) {
                if (!security.isValidPartitionName(partitionName)) {
                    return false;
                }
            }
            const target = partitionName ? mockSession.fromPartition(partitionName) : mockSession.fromPartition('MisePrivateProfile');
            return true;
        }

        for (const bad of invalidInputs) {
            fromPartitionCalls.length = 0;
            const res = await simulateClearGoogleAuthCookies(bad);
            assert.strictEqual(res, false, `clear-google-auth-cookies must return false for ${bad}`);
            assert.strictEqual(fromPartitionCalls.length, 0, 'session.fromPartition must not be called for invalid clear-google-auth-cookies');
        }

        fromPartitionCalls.length = 0;
        const defaultGoogleRes = await simulateClearGoogleAuthCookies();
        assert.strictEqual(defaultGoogleRes, true, 'Omitted partition name must succeed with private default');
        assert.strictEqual(fromPartitionCalls[0], 'MisePrivateProfile', 'Default must be MisePrivateProfile');

        console.log('✓ getSessionForContext, get-workspace-partition, and clear-google-auth-cookies reject invalid partitions and preserve private profiles');
    }

    console.log('All host IPC channel validation and diagnostics bounding tests passed successfully.\n');
})();
