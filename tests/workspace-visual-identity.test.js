// tests/workspace-visual-identity.test.js
// Regression test suite for Workspace Visual Identity, colour sanitisation, glyph boundaries, and session persistence

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sessionStore = require('../main/sessionStore');

console.log('Running Mise Workspace Visual Identity regression tests...');

(async () => {
    try {
        // 1. Dynamic import of workspaceVisuals ES module
        const workspaceVisuals = await import('../modules/workspaceVisuals.js');
        const {
            validateAccentColor,
            sanitizeGlyph,
            getFallbackGlyph,
            resolveWorkspaceVisual,
            applyWorkspaceVisuals,
            TOKYO_NIGHT_PALETTE,
            DEFAULT_ACCENT_COLOR,
            PRIVATE_ACCENT_COLOR
        } = workspaceVisuals;

        // Verify palette integrity
        assert.ok(Array.isArray(TOKYO_NIGHT_PALETTE), 'TOKYO_NIGHT_PALETTE must be an array');
        assert.strictEqual(TOKYO_NIGHT_PALETTE.length, 9, 'Palette must contain 9 curated colours');
        assert.strictEqual(DEFAULT_ACCENT_COLOR, '#7aa2f7', 'Default accent must be Tokyo Blue');
        assert.strictEqual(PRIVATE_ACCENT_COLOR, '#f7768e', 'Private accent must be Rose');
        console.log('✓ Tokyo Night curated palette constants verified');

        // 2. Strict Colour Sanitisation
        {
            // Valid hex values
            assert.strictEqual(validateAccentColor('#7aa2f7'), '#7aa2f7');
            assert.strictEqual(validateAccentColor('#7AA2F7'), '#7aa2f7', 'Uppercase hex must be normalised to lowercase');
            assert.strictEqual(validateAccentColor('#fff'), '#fff');
            assert.strictEqual(validateAccentColor('#123456'), '#123456');

            // Malformed and malicious payloads must fall back safely
            const maliciousPayloads = [
                'red',
                'blue',
                'rgba(0,0,0,0)',
                'url(http://evil.com/leak)',
                'expression(alert(1))',
                '#12',
                '#12345',
                '#1234567',
                '#123456789',
                '<script>alert(1)</script>',
                '',
                null,
                undefined,
                123456,
                {}
            ];

            for (const bad of maliciousPayloads) {
                assert.strictEqual(
                    validateAccentColor(bad),
                    DEFAULT_ACCENT_COLOR,
                    `Malicious or invalid colour "${bad}" must fall back to default`
                );
            }
            console.log('✓ Strict hex colour validation and CSS injection prevention verified');
        }

        // 3. Strict Glyph Sanitisation & Boundary Protection
        {
            // Valid single alphanumeric glyphs
            assert.strictEqual(sanitizeGlyph('W', 'Work'), 'W');
            assert.strictEqual(sanitizeGlyph('1', 'Workspace 1'), '1');
            assert.strictEqual(sanitizeGlyph('9', 'Dev 9'), '9');

            // Valid Unicode emoji glyphs
            assert.strictEqual(sanitizeGlyph('💼', 'Business'), '💼');
            assert.strictEqual(sanitizeGlyph('⚡', 'Quick'), '⚡');
            assert.strictEqual(sanitizeGlyph('🔒', 'Vault'), '🔒');
            assert.strictEqual(sanitizeGlyph('★', 'Favourites'), '★');

            // Multi-character input truncated to single visual grapheme cluster
            assert.strictEqual(sanitizeGlyph('Work', 'Work'), 'W');
            assert.strictEqual(sanitizeGlyph('Development', 'Development'), 'D');
            assert.strictEqual(sanitizeGlyph('🚀🛸', 'Space'), '🚀');

            // Bidirectional override and control character stripping
            const bidiAttack = '\u202E\u200EAdmin';
            assert.strictEqual(sanitizeGlyph(bidiAttack, 'Admin'), 'A');

            const controlAttack = '\u0000\u001F\u007FTesting';
            assert.strictEqual(sanitizeGlyph(controlAttack, 'Testing'), 'T');

            // Empty or whitespace-only inputs fall back to deterministic abbreviation
            assert.strictEqual(sanitizeGlyph('', 'Workspace 2'), 'W2');
            assert.strictEqual(sanitizeGlyph('   ', 'Workspace 3'), 'W3');
            assert.strictEqual(sanitizeGlyph(null, 'Research'), 'RE');
            assert.strictEqual(sanitizeGlyph(undefined, 'Code'), 'CO');

            // HTML tags in glyphs truncated and safe
            assert.strictEqual(sanitizeGlyph('<script>alert(1)</script>', 'Test'), '<');
            console.log('✓ Glyph sanitisation, BiDi stripping, and single grapheme cluster bounds verified');
        }

        // 4. Visual Identity Resolution & Private Profile Immunity
        {
            const mockSession = {
                workspace_visuals: {
                    'Work': { color: '#9ece6a', glyph: '💼' },
                    'Personal': { color: '#ff9e64', glyph: 'P' },
                    'Private': { color: '#00ff00', glyph: 'X' } // Attempted spoof of Private
                }
            };

            // Non-private resolved from session
            const workVisual = resolveWorkspaceVisual('Work', mockSession);
            assert.strictEqual(workVisual.color, '#9ece6a');
            assert.strictEqual(workVisual.glyph, '💼');

            // Missing visual falls back gracefully
            const unconfiguredVisual = resolveWorkspaceVisual('Workspace 5', mockSession);
            assert.strictEqual(unconfiguredVisual.color, DEFAULT_ACCENT_COLOR);
            assert.strictEqual(unconfiguredVisual.glyph, 'W5');

            // Private profile retains hardcoded immunity
            const privateVisual = resolveWorkspaceVisual('Private', mockSession);
            assert.strictEqual(privateVisual.color, PRIVATE_ACCENT_COLOR, 'Private accent must remain Rose');
            assert.strictEqual(privateVisual.glyph, 'PR', 'Private glyph must remain PR');
            console.log('✓ Workspace visual resolution and Private profile immunity verified');
        }

        // 5. Safe DOM Application
        {
            const mockBadge = {
                textContent: '',
                style: {
                    borderColor: '',
                    color: '',
                    backgroundColor: ''
                }
            };

            const mockSession = {
                workspace_visuals: {
                    'Dev': { color: '#7dcfff', glyph: 'λ' }
                }
            };

            // Standard workspace application
            applyWorkspaceVisuals('Dev', mockBadge, false, mockSession);
            assert.strictEqual(mockBadge.textContent, 'λ');
            assert.strictEqual(mockBadge.style.borderColor, '#7dcfff');
            assert.strictEqual(mockBadge.style.color, '#7dcfff');
            assert.ok(mockBadge.style.backgroundColor.includes('#7dcfff'));

            // Private workspace application
            applyWorkspaceVisuals('Private', mockBadge, true, mockSession);
            assert.strictEqual(mockBadge.textContent, 'PR');
            assert.strictEqual(mockBadge.style.borderColor, PRIVATE_ACCENT_COLOR);
            assert.strictEqual(mockBadge.style.color, PRIVATE_ACCENT_COLOR);
            assert.ok(mockBadge.style.backgroundColor.includes('#f7768e'));
            console.log('✓ Safe DOM badge styling and XSS-free application verified');
        }

        // 6. Session Persistence, Sanitisation, and Migration Guards
        {
            const dirtySession = {
                current_workspace: 'Work',
                workspaces: {
                    'Work': ['https://duckduckgo.com'],
                    'Private': ['https://internal-private.com']
                },
                workspace_visuals: {
                    'Work': { color: '#9ece6a', glyph: 'W' },
                    'Private': { color: '#f7768e', glyph: 'PR' }
                }
            };

            const cleanDisk = sessionStore.sanitizeSessionForDisk(dirtySession);
            assert.ok(cleanDisk.workspace_visuals.Work, 'Persistent workspace visuals must be kept on disk');
            assert.strictEqual(cleanDisk.workspace_visuals.Private, undefined, 'Private workspace visuals must never be stored on disk');

            // Legacy private migration test
            const legacySession = {
                current_workspace: 'Private',
                workspaces: {
                    'Private': ['https://duckduckgo.com']
                },
                workspace_visuals: {
                    'Private': { color: '#f7768e', glyph: 'PR' }
                }
            };
            const migrated = sessionStore.migrateLegacyPrivateWorkspace(legacySession);
            assert.ok(migrated.workspaces['Private (old)'], 'Legacy Private workspace must be renamed');
            assert.ok(migrated.workspace_visuals['Private (old)'], 'Legacy Private visuals must migrate with workspace');
            assert.strictEqual(migrated.workspace_visuals['Private'], undefined);
            console.log('✓ Session persistence sanitisation and metadata migration verified');
        }

        // 7. Verification of Line Budgets and Modularity
        {
            const visualModulePath = path.join(__dirname, '../modules/workspaceVisuals.js');
            const visualLines = fs.readFileSync(visualModulePath, 'utf8').split('\n').length;
            assert.ok(visualLines < 200, `workspaceVisuals.js must be under 200 lines (current: ${visualLines})`);

            const wcPath = path.join(__dirname, '../modules/renderer/workspaceController.js');
            const wcLines = fs.readFileSync(wcPath, 'utf8').split('\n').length;
            assert.ok(wcLines < 250, `workspaceController.js must be under 250 lines (current: ${wcLines})`);

            const rendererPath = path.join(__dirname, '../renderer.js');
            const rendererLines = fs.readFileSync(rendererPath, 'utf8').split('\n').length;
            assert.ok(rendererLines < 250, `renderer.js must be under 250 lines (current: ${rendererLines})`);

            const mainPath = path.join(__dirname, '../main.js');
            const mainLines = fs.readFileSync(mainPath, 'utf8').split('\n').length;
            assert.ok(mainLines < 550, `main.js must be under 550 lines (current: ${mainLines})`);

            const indexPath = path.join(__dirname, '../index.html');
            const indexLines = fs.readFileSync(indexPath, 'utf8').split('\n').length;
            assert.ok(indexLines < 260, `index.html must be under 260 lines (current: ${indexLines})`);
            console.log('✓ Strict line budgets and modular encapsulation verified across all files');
        }

        console.log('All Workspace Visual Identity regression tests passed successfully!');
    } catch (err) {
        console.error('Workspace Visual Identity test failed:', err);
        process.exit(1);
    }
})();
