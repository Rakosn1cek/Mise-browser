// tests/appstream-metadata.test.js
// Regression test suite for Freedesktop AppStream metainfo and desktop packaging metadata

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

console.log('Running Mise AppStream metadata regression tests...');

const rootDir = path.resolve(__dirname, '..');
const metainfoPath = path.join(rootDir, 'assets', 'io.github.rakosn1cek.mise-browser.metainfo.xml');
const desktopPath = path.join(rootDir, 'mise-browser.desktop');
const pkgPath = path.join(rootDir, 'package.json');

// 1. File existence checks
{
    assert(fs.existsSync(metainfoPath), 'AppStream metainfo XML file must exist in assets/');
    assert(fs.existsSync(desktopPath), 'Desktop launcher file must exist in root directory');
    assert(fs.existsSync(pkgPath), 'package.json must exist in root directory');
    console.log('✓ AppStream metainfo and desktop files exist on disk');
}

// 2. Metadata structural verification
const metainfoContent = fs.readFileSync(metainfoPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

{
    // Ensure forbiddden words are not present
    assert(!metainfoContent.toLowerCase().includes('lightweight'), 'The word lightweight is forbidden in metainfo');

    // Root component tag
    assert(metainfoContent.includes('<component type="desktop-application">'), 'Component type must be desktop-application');
    assert(metainfoContent.includes('</component>'), 'Component closing tag must be present');

    // Identifiers and licenses
    assert(metainfoContent.includes('<id>io.github.rakosn1cek.mise-browser</id>'), 'ID must match reverse-DNS format');
    assert(metainfoContent.includes('<metadata_license>FSFAP</metadata_license>'), 'Metadata licence must be FSFAP or CC0-1.0');
    assert(metainfoContent.includes('<project_license>GPL-3.0-or-later</project_license>'), 'Project licence must match GPL-3.0-or-later');

    // Display metadata
    assert(metainfoContent.includes('<name>Mise Browser</name>'), 'Name must be Mise Browser');
    assert(/<summary>[^<]+<\/summary>/.test(metainfoContent), 'Summary tag must be present');

    const summaryMatch = metainfoContent.match(/<summary>([^<]+)<\/summary>/);
    assert(summaryMatch, 'Summary element must exist');
    const summaryText = summaryMatch[1].trim();
    assert(summaryText.length < 80, 'Summary should be concise and under 80 characters');
    assert(!summaryText.endsWith('.'), 'AppStream summary should not end with a full stop');

    // Launchable desktop pairing
    assert(metainfoContent.includes('<launchable type="desktop-id">mise-browser.desktop</launchable>'), 'Launchable ID must link to mise-browser.desktop');

    // Mandatory URLs
    assert(metainfoContent.includes('<url type="homepage">https://rakosn1cek.github.io/Mise-browser/</url>'), 'Homepage URL must point to official docs');
    assert(metainfoContent.includes('<url type="bugtracker">https://github.com/Rakosn1cek/Mise-browser/issues</url>'), 'Bugtracker URL must be present');
    assert(metainfoContent.includes('<url type="vcs-browser">https://github.com/Rakosn1cek/Mise-browser</url>'), 'VCS repository URL must be present');

    // Developer attribution
    assert(metainfoContent.includes('<developer id="io.github.rakosn1cek">'), 'Developer tag must include unique ID');
    assert(metainfoContent.includes('<name>Rakosn1cek</name>'), 'Developer name must be present');

    // Content rating and categories
    assert(metainfoContent.includes('<content_rating type="oars-1.1" />'), 'Content rating must be declared using OARS 1.1');
    assert(metainfoContent.includes('<category>Network</category>'), 'Categories must include Network');
    assert(metainfoContent.includes('<category>WebBrowser</category>'), 'Categories must include WebBrowser');

    // Screenshots
    assert(metainfoContent.includes('<screenshots>'), 'Screenshots block must be present');
    assert(metainfoContent.includes('<screenshot type="default">'), 'Default screenshot must be specified');
    const screenshotMatches = metainfoContent.match(/<image>([^<]+)<\/image>/g) || [];
    assert(screenshotMatches.length >= 3, 'At least three screenshots must be supplied for rich store display');
    for (const match of screenshotMatches) {
        assert(match.includes('https://'), 'All screenshot URLs must be secure HTTPS links');
    }

    // Version synchronisation check
    const currentVersion = pkg.version;
    assert(metainfoContent.includes(`version="${currentVersion}"`), `Releases block must list current version ${currentVersion}`);

    console.log('✓ AppStream metadata tags, attributes, and URL schemas verified');
}

// 3. Packaging configuration verification
{
    const linuxConfig = pkg.build && pkg.build.linux;
    assert(linuxConfig, 'Linux build configuration must exist in package.json');

    const extraFiles = linuxConfig.extraFiles || [];
    const hasMetainfoMapping = extraFiles.some(entry =>
        entry.from === 'assets/io.github.rakosn1cek.mise-browser.metainfo.xml' &&
        entry.to === 'usr/share/metainfo/io.github.rakosn1cek.mise-browser.metainfo.xml'
    );
    assert(hasMetainfoMapping, 'package.json build.linux.extraFiles must bundle metainfo into usr/share/metainfo/');

    const installDesktopScript = pkg.scripts && pkg.scripts['install-desktop'];
    assert(installDesktopScript, 'install-desktop script must be defined');
    assert(installDesktopScript.includes('cp assets/io.github.rakosn1cek.mise-browser.metainfo.xml ~/.local/share/metainfo/'), 'install-desktop must install metainfo to ~/.local/share/metainfo/');

    console.log('✓ Packaging integration and extraFiles mappings verified');
}

// 4. External CLI validation with appstreamcli and desktop-file-validate
{
    let appstreamcliPath = null;
    try {
        appstreamcliPath = execFileSync('which', ['appstreamcli'], { encoding: 'utf8' }).trim();
    } catch {
        // appstreamcli not installed in this environment
    }

    if (appstreamcliPath) {
        const output = execFileSync(appstreamcliPath, ['validate', '--no-net', '--pedantic', metainfoPath], { encoding: 'utf8' });
        assert(output.includes('Validation was successful'), 'appstreamcli validate must succeed with zero errors or warnings');
        console.log('✓ appstreamcli pedantic validation passed with 0 errors');
    } else {
        console.log('ℹ appstreamcli not found, skipping binary CLI validation');
    }

    let desktopValidatePath = null;
    try {
        desktopValidatePath = execFileSync('which', ['desktop-file-validate'], { encoding: 'utf8' }).trim();
    } catch {
        // desktop-file-validate not installed
    }

    if (desktopValidatePath) {
        execFileSync(desktopValidatePath, [desktopPath], { encoding: 'utf8' });
        console.log('✓ desktop-file-validate passed with 0 errors');
    } else {
        console.log('ℹ desktop-file-validate not found, skipping desktop entry validation');
    }
}

console.log('All AppStream metadata tests passed successfully.');
