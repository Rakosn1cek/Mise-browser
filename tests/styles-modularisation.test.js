// tests/styles-modularisation.test.js
// Verification for modular stylesheet architecture and entry aggregator integrity

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise stylesheet modularisation regression tests...');

// 1. Verify style.css is a lean master aggregator importing all primary domain modules
{
    const stylePath = path.join(__dirname, '../style.css');
    const content = fs.readFileSync(stylePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('/*'));

    assert(lines.length <= 15, `style.css must remain a lean aggregator under 15 lines (currently ${lines.length})`);

    const expectedImports = [
        "@import './styles/base.css';",
        "@import './styles/layout.css';",
        "@import './styles/sidebar.css';",
        "@import './styles/statusbar.css';",
        "@import './styles/components.css';",
        "@import './styles/overlays.css';"
    ];

    expectedImports.forEach(imp => {
        assert(content.includes(imp), `style.css must import ${imp}`);
    });

    console.log('✓ style.css master aggregator integrity and native import structure verified');
}

// 2. Verify all primary style sheets exist under styles/ and are populated
{
    const rootStyles = ['base.css', 'layout.css', 'sidebar.css', 'statusbar.css', 'components.css', 'overlays.css'];
    rootStyles.forEach(file => {
        const filePath = path.join(__dirname, '../styles', file);
        assert(fs.existsSync(filePath), `styles/${file} must exist on disk`);
        const stats = fs.statSync(filePath);
        assert(stats.size > 50, `styles/${file} must be populated`);
    });

    console.log('✓ Primary domain stylesheets in styles/ verified on disk');
}

// 3. Verify styles/overlays.css imports all domain-specific overlay sheets
{
    const overlaysAggregatorPath = path.join(__dirname, '../styles/overlays.css');
    const content = fs.readFileSync(overlaysAggregatorPath, 'utf8');

    const expectedSubSheets = [
        'dashboard.css',
        'commandPalette.css',
        'preferences.css',
        'history.css',
        'findBar.css',
        'notes.css',
        'bookmarks.css',
        'diagnostics.css'
    ];

    expectedSubSheets.forEach(sub => {
        assert(
            content.includes(`@import './overlays/${sub}';`),
            `styles/overlays.css must import ./overlays/${sub}`
        );

        const subPath = path.join(__dirname, '../styles/overlays', sub);
        assert(fs.existsSync(subPath), `styles/overlays/${sub} must exist on disk`);
        const stats = fs.statSync(subPath);
        assert(stats.size > 20, `styles/overlays/${sub} must be populated`);
    });

    console.log('✓ Overlay sub-sheets and master overlay aggregator verified');
}

// 4. Verify package.json bundles styles directory in distribution builds
{
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    assert(
        pkg.build && pkg.build.files && pkg.build.files.includes('styles/**/*'),
        'package.json build.files must include styles/**/* for distribution packaging'
    );

    console.log('✓ package.json distribution packaging rule verified');
}

// 5. Verify recursive stylesheet import resolution has zero missing files
{
    function resolveCss(filePath, visited = new Set()) {
        assert(fs.existsSync(filePath), `Referenced stylesheet must exist: ${filePath}`);
        visited.add(filePath);

        const content = fs.readFileSync(filePath, 'utf8');
        const importRegex = /@import\s+['"]([^'"]+)['"];/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
            const relPath = match[1];
            const targetPath = path.resolve(path.dirname(filePath), relPath);
            resolveCss(targetPath, visited);
        }
        return visited;
    }

    const visitedSheets = resolveCss(path.join(__dirname, '../style.css'));
    assert(visitedSheets.size >= 15, `Expected at least 15 stylesheet files to be resolved (got ${visitedSheets.size})`);

    console.log(`✓ Recursive import traversal resolved all ${visitedSheets.size} modular sheets cleanly`);
}

console.log('All stylesheet modularisation regression tests passed successfully!');
