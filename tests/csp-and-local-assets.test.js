// tests/csp-and-local-assets.test.js
// Verification for Content Security Policy and bundled local assets in index.html

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise Content Security Policy and local asset regression tests...');

// 1. Verify index.html contains strict CSP and no remote CDN references
{
    const indexPath = path.join(__dirname, '../index.html');
    const indexSource = fs.readFileSync(indexPath, 'utf8');

    // Remote CDN dependencies must not be present: all link and script tags must use local paths
    const remoteAssetMatches = indexSource.match(/<(?:link|script)[^>]+(?:href|src)=["']https?:\/\/[^"']+/gi);
    assert.equal(
        remoteAssetMatches,
        null,
        'index.html must not load remote stylesheet or script assets'
    );

    // Verify local FontAwesome stylesheet link
    assert(
        indexSource.includes('<link rel="stylesheet" href="assets/fontawesome/css/all.min.css">'),
        'index.html must reference local assets/fontawesome/css/all.min.css'
    );

    // Verify Content Security Policy meta tag presence
    const cspMatch = indexSource.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]+)"/i);
    assert(cspMatch, 'index.html must include a Content-Security-Policy meta tag');

    const cspDirectives = cspMatch[1];

    // Verify critical CSP directives
    assert(cspDirectives.includes("default-src 'self'"), 'CSP must specify default-src strictly to self');
    assert(cspDirectives.includes("script-src 'self'"), 'CSP must specify script-src strictly to self');
    assert(cspDirectives.includes("object-src 'none'"), 'CSP must forbid object embeddings via object-src none');
    assert(cspDirectives.includes("base-uri 'none'"), 'CSP must restrict base-uri to none');
    assert(cspDirectives.includes("font-src 'self'"), 'CSP must permit local font sources');

    console.log('✓ index.html Content Security Policy and local asset link verified');
}

// 2. Verify local FontAwesome stylesheet and webfont asset integrity
{
    const baseAssetsDir = path.join(__dirname, '../assets/fontawesome');
    const cssPath = path.join(baseAssetsDir, 'css/all.min.css');
    const webfontsDir = path.join(baseAssetsDir, 'webfonts');

    assert(fs.existsSync(cssPath), 'Local FontAwesome CSS file must exist on disk');
    const cssStats = fs.statSync(cssPath);
    assert(cssStats.size > 50000, 'Local FontAwesome CSS file must be fully populated');

    const requiredFonts = [
        'fa-solid-900.woff2',
        'fa-regular-400.woff2',
        'fa-brands-400.woff2',
        'fa-v4compatibility.woff2'
    ];

    for (const fontFile of requiredFonts) {
        const fontPath = path.join(webfontsDir, fontFile);
        assert(fs.existsSync(fontPath), `Webfont ${fontFile} must exist in assets/fontawesome/webfonts`);
        const fontStats = fs.statSync(fontPath);
        assert(fontStats.size > 1000, `Webfont ${fontFile} must not be empty`);
    }

    // Verify relative font path resolution in stylesheet
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    assert(
        cssContent.includes('../webfonts/fa-solid-900.woff2'),
        'Local CSS must reference relative webfonts directory paths'
    );

    console.log('✓ Local FontAwesome stylesheet and WOFF2 binary assets integrity verified');
    console.log('All CSP and local asset regression tests passed successfully!');
}
