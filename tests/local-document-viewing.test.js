// tests/local-document-viewing.test.js
// Regression test suite for configurable local document viewing, security policies, and UI toggles

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('Running Mise configurable local document viewing regression tests...');

// Mock minimal electron requirements if running in standalone Node
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'electron') {
        return {
            app: {
                getPath: () => path.join(__dirname, '..'),
                userAgentFallback: 'Mozilla/5.0'
            },
            ipcMain: {
                handle: () => {},
                on: () => {}
            }
        };
    }
    return origRequire.apply(this, arguments);
};

const security = require('../security.js');
const config = require('../main/config.js');

// 1. Static code analysis and schema verification
{
    // A. Configuration schema default
    assert.strictEqual(
        config.DEFAULT_CONFIG.allow_local_documents,
        false,
        'DEFAULT_CONFIG must keep allow_local_documents strictly disabled by default'
    );

    // B. validateConfigPatch boolean enforcement
    const validPatch = { allow_local_documents: true };
    const validRes = config.validateConfigPatch(validPatch);
    assert.deepStrictEqual(validRes.clean, { allow_local_documents: true });
    assert.deepStrictEqual(validRes.rejected, []);

    const invalidPatch = { allow_local_documents: 'yes' };
    const invalidRes = config.validateConfigPatch(invalidPatch);
    assert.strictEqual(invalidRes.clean.allow_local_documents, undefined);
    assert(invalidRes.rejected.includes('allow_local_documents'));

    // C. Preferences template markup
    const prefTemplate = fs.readFileSync(path.join(__dirname, '../templates/preferences.html'), 'utf8');
    assert(
        prefTemplate.includes('id="setting-allow-local-documents"'),
        'templates/preferences.html must contain toggle switch with id setting-allow-local-documents'
    );
    assert(
        prefTemplate.includes('Local Document Viewing'),
        'templates/preferences.html must present clear setting label'
    );

    // D. Command Palette preferences hydration
    const cmdPaletteSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/commandPalette.js'), 'utf8');
    assert(
        cmdPaletteSource.includes("document.getElementById('setting-allow-local-documents')"),
        'commandPalette.js must reference setting-allow-local-documents'
    );
    assert(
        cmdPaletteSource.includes('allow_local_documents: allowLocalDocsToggle.checked'),
        'commandPalette.js must dispatch allow_local_documents updates'
    );

    // E. Preload bridge exposure
    const preloadSource = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
    assert(
        preloadSource.includes('validateLocalDocumentPath'),
        'preload.js must expose validateLocalDocumentPath'
    );
    assert(
        preloadSource.includes('isAllowedLocalDocumentUrl'),
        'preload.js must expose isAllowedLocalDocumentUrl'
    );

    // F. System IPC registration
    const systemIpcSource = fs.readFileSync(path.join(__dirname, '../main/systemIpc.js'), 'utf8');
    assert(
        systemIpcSource.includes("ipcMain.on('validate-local-document-path'"),
        'systemIpc.js must register validate-local-document-path listener'
    );
    assert(
        systemIpcSource.includes("ipcMain.on('is-allowed-local-document-url'"),
        'systemIpc.js must register is-allowed-local-document-url listener'
    );

    console.log('✓ Configuration schema, preferences UI, IPC registration, and preload bindings verified');
}

// 2. Functional security validation and path containment
{
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-doc-viewing-test-'));

    try {
        // Create mock documents
        const testHtml = path.join(tmpDir, 'page.html');
        fs.writeFileSync(testHtml, '<!DOCTYPE html><html><body>Test</body></html>');

        const testHtm = path.join(tmpDir, 'page.htm');
        fs.writeFileSync(testHtm, '<html><body>HTM</body></html>');

        const testXhtml = path.join(tmpDir, 'page.xhtml');
        fs.writeFileSync(testXhtml, '<html xmlns="http://www.w3.org/1999/xhtml"><body>XHTML</body></html>');

        const testTxt = path.join(tmpDir, 'document.txt');
        fs.writeFileSync(testTxt, 'Plain text content');

        const testSvg = path.join(tmpDir, 'image.svg');
        fs.writeFileSync(testSvg, '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>');

        const testPdf = path.join(tmpDir, 'sample.pdf');
        fs.writeFileSync(testPdf, '%PDF-1.4 mock content');

        const testScript = path.join(tmpDir, 'script.sh');
        fs.writeFileSync(testScript, '#!/bin/sh\necho "exploit"');

        const testBinary = path.join(tmpDir, 'disguised.html');
        const elfHeader = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
        fs.writeFileSync(testBinary, elfHeader);

        const testHidden = path.join(tmpDir, '.hidden.html');
        fs.writeFileSync(testHidden, '<html><body>Hidden</body></html>');

        // Initial state: disabled by default
        security.setAllowLocalDocuments(false);
        assert.strictEqual(security.getAllowLocalDocuments(), false);

        // A. Verification whilst disabled
        assert.strictEqual(
            security.isAllowedLocalDocumentUrl(`file://${testHtml}`),
            false,
            'Local HTML files must be rejected when setting is disabled'
        );
        assert.strictEqual(
            security.isAllowedLocalDocumentUrl(`file://${testTxt}`),
            false,
            'Local text files must be rejected when setting is disabled'
        );
        assert.strictEqual(
            security.isAllowedLocalDocumentUrl(`file://${testPdf}`),
            true,
            'Local PDF files must always remain permissible via offline PDF viewer'
        );

        // B. Verification whilst enabled
        security.setAllowLocalDocuments(true);
        assert.strictEqual(security.getAllowLocalDocuments(), true);

        // Permitted document formats
        assert.strictEqual(security.isAllowedLocalDocumentUrl(`file://${testHtml}`), true);
        assert.strictEqual(security.isAllowedLocalDocumentUrl(`file://${testHtm}`), true);
        assert.strictEqual(security.isAllowedLocalDocumentUrl(`file://${testXhtml}`), true);
        assert.strictEqual(security.isAllowedLocalDocumentUrl(`file://${testTxt}`), true);
        assert.strictEqual(security.isAllowedLocalDocumentUrl(`file://${testSvg}`), true);
        assert.strictEqual(security.isAllowedLocalDocumentUrl(`file://${testPdf}`), true);

        // Rejection of executable scripts and binaries
        assert.strictEqual(
            security.isAllowedLocalDocumentUrl(`file://${testScript}`),
            false,
            'Executable shell scripts must be blocked unconditionally'
        );
        assert.strictEqual(
            security.isAllowedLocalDocumentUrl(`file://${testBinary}`),
            false,
            'Disguised ELF binaries with html extensions must be blocked'
        );

        // Rejection of hidden files
        assert.strictEqual(
            security.isAllowedLocalDocumentUrl(`file://${testHidden}`),
            false,
            'Hidden dotfiles must be blocked'
        );

        // Rejection of system directory paths
        const systemTargets = [
            'file:///etc/passwd',
            'file:///etc/hosts.txt',
            'file:///etc/issue.html',
            'file:///proc/cpuinfo',
            'file:///sys/kernel/notes.txt',
            'file:///dev/null',
            'file:///boot/grub/grub.cfg',
            'file:///root/secret.html',
            'file:///usr/bin/bash.html',
            'file:///var/log/syslog.txt'
        ];
        for (const sysUrl of systemTargets) {
            assert.strictEqual(
                security.isAllowedLocalDocumentUrl(sysUrl),
                false,
                `System path must be strictly blocked: ${sysUrl}`
            );
        }

        // Rejection of sensitive credential and profile directories
        const credentialTargets = [
            'file:///home/user/.ssh/id_rsa.html',
            'file:///home/user/.ssh/authorized_keys.txt',
            'file:///home/user/.gnupg/pubring.kbx.txt',
            'file:///home/user/.aws/credentials.txt',
            'file:///home/user/.config/mise-browser/session.json',
            'file:///home/user/.config/mise-browser/notes.txt',
            'file:///home/user/.local/share/keyrings/login.keyring.txt'
        ];
        for (const credUrl of credentialTargets) {
            assert.strictEqual(
                security.isAllowedLocalDocumentUrl(credUrl),
                false,
                `Sensitive credential store must be blocked: ${credUrl}`
            );
        }

        // Rejection of null bytes and malformed inputs
        assert.strictEqual(security.isAllowedLocalDocumentUrl('file:///home/user/doc.html\0.txt'), false);
        assert.strictEqual(security.isAllowedLocalDocumentUrl(''), false);
        assert.strictEqual(security.isAllowedLocalDocumentUrl(null), false);

        // Reset state to default disabled
        security.setAllowLocalDocuments(false);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log('✓ Path sanitisation, format allowlist, binary blocking, and credential protections verified');
}

// 3. Functional address bar navigation interaction
{
    const navSource = fs.readFileSync(path.join(__dirname, '../modules/navigation.js'), 'utf8');

    let currentConfig = { allow_local_documents: false };
    let statusMessage = '';
    let toastMessage = '';
    let toastIcon = '';

    const mockState = {
        allowLocalDocuments: false,
        sessionState: {
            current_workspace: 'default',
            workspaces: {
                default: ['https://initial.example.org']
            }
        },
        activeViewsCache: {
            default: [{
                src: 'https://initial.example.org',
                loadURL: async function(u) { this.src = u; },
                setAttribute(attr, val) {
                    if (attr === 'src') this.src = val;
                }
            }]
        },
        customSearchAliases: {},
        addressSuggestions: [],
        addressSelectionIdx: -1
    };

    const selectedTab = { id: 'tab-0', title: '' };
    const mockDocument = {
        querySelector(selector) {
            if (selector === '#TabList li.selected') return selectedTab;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '#TabList li') return [selectedTab];
            return [];
        },
        getElementById(id) {
            if (id === 'WideAddressBar') {
                return {
                    style: { display: 'block' },
                    blur() { this.style.display = 'none'; },
                    value: ''
                };
            }
            if (id === 'AddressSuggestions') {
                return { style: { display: 'none' }, innerHTML: '' };
            }
            return null;
        }
    };

    const mockWindow = {
        miseAPI: {
            saveSession: () => {},
            getBrowserSettings: async () => currentConfig,
            validateLocalDocumentPath: (p) => security.validateLocalDocumentPath(p),
            isAllowedLocalDocumentUrl: (u) => security.isAllowedLocalDocumentUrl(u)
        }
    };

    function mockSetTargetUrl(msg) {
        statusMessage = msg;
    }

    function mockShowNotificationToast(msg, icon) {
        toastMessage = msg;
        toastIcon = icon;
    }

    function mockIsPdfUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return url.toLowerCase().endsWith('.pdf');
    }

    function mockGetPdfViewerUrl(url) {
        return `assets/pdfjs/viewer.html?file=${encodeURIComponent(url)}`;
    }

    const strippedSource = navSource
        .replace(/import\s+[^;]+;\s*/g, '')
        .replace('export const POPULAR_BANGS', 'const POPULAR_BANGS')
        .replace('export function dismissAddressBar', 'function dismissAddressBar')
        .replace('export function extractDdgBang', 'function extractDdgBang')
        .replace('export function displayAddressOverlay', 'function displayAddressOverlay')
        .replace('export async function handleNavigation', 'async function handleNavigation')
        .replace('export function setupAddressBarAutocomplete', 'function setupAddressBarAutocomplete')
        .replace('export function renderSuggestions', 'function renderSuggestions')
        .replace('export function updateSuggestionHighlight', 'function updateSuggestionHighlight')
        .replace('export async function selectSuggestion', 'async function selectSuggestion')
        .replace('export function hideSuggestions', 'function hideSuggestions');

    const factory = new Function(
        'state', 'document', 'window', 'isPdfUrl', 'getPdfViewerUrl', 'setTargetUrl',
        'showNotificationToast', 'formatSearchUrl', 'resolveSearchAliasUrl', 'evaluateMathExpression',
        'extractDdgBang', 'focusActiveWebview', 'wakeTab', 'renderWorkspaceUI',
        `${strippedSource}\nreturn { handleNavigation, applyTargetUrl };`
    );

    const { handleNavigation, applyTargetUrl } = factory(
        mockState, mockDocument, mockWindow, mockIsPdfUrl, mockGetPdfViewerUrl,
        mockSetTargetUrl, mockShowNotificationToast,
        (q) => `https://duckduckgo.com/?q=${q}`,
        () => null, () => null, () => null,
        () => {}, () => {}, () => {}
    );

    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-nav-test-'));
    const testDoc = path.join(testDir, 'sample.html');
    fs.writeFileSync(testDoc, '<h1>Sample Document</h1>');

    (async () => {
        try {
            // Test 1: Navigation whilst setting is disabled
            currentConfig.allow_local_documents = false;
            security.setAllowLocalDocuments(false);
            statusMessage = '';
            toastMessage = '';

            await handleNavigation(testDoc);
            assert.equal(statusMessage, 'Local file access restricted to PDF documents.');
            assert.equal(toastMessage, 'Local document access disabled. Enable in Preferences.');
            assert.equal(toastIcon, 'fa-shield-halved');
            assert.equal(mockState.sessionState.workspaces.default[0], 'https://initial.example.org');

            // Test 2: Navigation whilst setting is enabled
            currentConfig.allow_local_documents = true;
            security.setAllowLocalDocuments(true);
            statusMessage = '';
            toastMessage = '';

            await handleNavigation(testDoc);
            assert.equal(statusMessage, '');
            assert.equal(toastMessage, '');
            assert.equal(mockState.sessionState.workspaces.default[0], 'file://' + testDoc);
            assert.equal(mockState.activeViewsCache.default[0].src, 'file://' + testDoc);

            // Test 3: Navigation to sensitive path whilst enabled
            statusMessage = '';
            toastMessage = '';
            await handleNavigation('/etc/passwd');
            assert.equal(statusMessage, 'Local document rejected: invalid type or sensitive path.');
            assert.equal(toastMessage, 'Local document rejected: invalid type or sensitive path.');
            assert.equal(toastIcon, 'fa-triangle-exclamation');

            // Test 4: applyTargetUrl enforcement
            security.setAllowLocalDocuments(false);
            statusMessage = '';
            applyTargetUrl('file:///home/user/doc.html');
            assert.equal(statusMessage, 'Local file access restricted to PDF documents.');

            security.setAllowLocalDocuments(true);
            statusMessage = '';
            applyTargetUrl('file://' + testDoc);
            assert.equal(statusMessage, '');
            assert.equal(mockState.sessionState.workspaces.default[0], 'file://' + testDoc);
        } finally {
            fs.rmSync(testDir, { recursive: true, force: true });
            security.setAllowLocalDocuments(false);
        }

        console.log('✓ Address bar navigation and notification toast dispatch verified');
        console.log('All configurable local document viewing tests passed successfully!');
    })().catch((err) => {
        console.error('Test execution failed:', err);
        process.exit(1);
    });
}
