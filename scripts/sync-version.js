// scripts/sync-version.js
// Synchronises version references across repository assets upon npm version bumps
// Ensures package.json remains the canonical single source of truth for Mise Browser

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const readmePath = path.join(rootDir, 'README.md');
const whatsNewPath = path.join(rootDir, 'assets', 'whats-new.html');

if (!fs.existsSync(pkgPath)) {
    console.error('Error: package.json not found');
    process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
if (!version) {
    console.error('Error: No version specified in package.json');
    process.exit(1);
}

console.log(`Synchronising repository files to Mise Browser v${version}...`);

// 1. Synchronise README.md download links and badges
if (fs.existsSync(readmePath)) {
    let readme = fs.readFileSync(readmePath, 'utf8');

    // Update download badges and release headlines
    readme = readme.replace(
        /📦 \*\*Download Packages \(v[0-9a-zA-Z.-]+\)\*\*/g,
        `📦 **Download Packages (v${version})**`
    );
    readme = readme.replace(
        /> \*\*Latest Release\*\*: \[\*\*v[0-9a-zA-Z.-]+\*\*\]/g,
        `> **Latest Release**: [**v${version}**]`
    );

    // Update direct asset download URLs
    readme = readme.replace(
        /\/download\/v[0-9a-zA-Z.-]+\/Mise\.Browser-[0-9a-zA-Z.-]+\.AppImage/g,
        `/download/v${version}/Mise.Browser-${version}.AppImage`
    );
    readme = readme.replace(
        /\/download\/v[0-9a-zA-Z.-]+\/mise-browser-[0-9a-zA-Z.-]+\.tar\.gz/g,
        `/download/v${version}/mise-browser-${version}.tar.gz`
    );
    readme = readme.replace(
        /\/download\/v[0-9a-zA-Z.-]+\/Mise\.Browser-[0-9a-zA-Z.-]+-arm64\.dmg/g,
        `/download/v${version}/Mise.Browser-${version}-arm64.dmg`
    );
    readme = readme.replace(
        /\/download\/v[0-9a-zA-Z.-]+\/Mise\.Browser-[0-9a-zA-Z.-]+-arm64-mac\.zip/g,
        `/download/v${version}/Mise.Browser-${version}-arm64-mac.zip`
    );
    readme = readme.replace(
        /\/download\/v[0-9a-zA-Z.-]+\/Mise\.Browser\.Setup\.[0-9a-zA-Z.-]+\.exe/g,
        `/download/v${version}/Mise.Browser.Setup.${version}.exe`
    );
    readme = readme.replace(
        /\/download\/v[0-9a-zA-Z.-]+\/Mise\.Browser\.[0-9a-zA-Z.-]+\.exe/g,
        `/download/v${version}/Mise.Browser.${version}.exe`
    );
    readme = readme.replace(
        /\/download\/v[0-9a-zA-Z.-]+\/SHA256SUMS\.txt/g,
        `/download/v${version}/SHA256SUMS.txt`
    );

    // Update table link labels
    readme = readme.replace(
        /\[Mise\.Browser-[0-9a-zA-Z.-]+\.AppImage\]/g,
        `[Mise.Browser-${version}.AppImage]`
    );
    readme = readme.replace(
        /\[mise-browser-[0-9a-zA-Z.-]+\.tar\.gz\]/g,
        `[mise-browser-${version}.tar.gz]`
    );
    readme = readme.replace(
        /\[Mise\.Browser-[0-9a-zA-Z.-]+-arm64\.dmg\]/g,
        `[Mise.Browser-${version}-arm64.dmg]`
    );
    readme = readme.replace(
        /\[Mise\.Browser-[0-9a-zA-Z.-]+-arm64-mac\.zip\]/g,
        `[Mise.Browser-${version}-arm64-mac.zip]`
    );
    readme = readme.replace(
        /\[Mise\.Browser\.Setup\.[0-9a-zA-Z.-]+\.exe\]/g,
        `[Mise.Browser.Setup.${version}.exe]`
    );
    readme = readme.replace(
        /\[Mise\.Browser\.[0-9a-zA-Z.-]+\.exe\]/g,
        `[Mise.Browser.${version}.exe]`
    );

    // Update quick execution snippets
    readme = readme.replace(
        /chmod \+x Mise\.Browser-[0-9a-zA-Z.-]+\.AppImage/g,
        `chmod +x Mise.Browser-${version}.AppImage`
    );
    readme = readme.replace(
        /\.\/Mise\.Browser-[0-9a-zA-Z.-]+\.AppImage/g,
        `./Mise.Browser-${version}.AppImage`
    );

    fs.writeFileSync(readmePath, readme, 'utf8');
    console.log('✓ README.md download links and release badges updated');
}

// 2. Synchronise assets/whats-new.html titles
if (fs.existsSync(whatsNewPath)) {
    let whatsNew = fs.readFileSync(whatsNewPath, 'utf8');
    whatsNew = whatsNew.replace(
        /<title>What's New in Mise v[0-9a-zA-Z.-]+<\/title>/g,
        `<title>What's New in Mise v${version}</title>`
    );
    whatsNew = whatsNew.replace(
        /<h1>What's New in Mise v[0-9a-zA-Z.-]+<\/h1>/g,
        `<h1>What's New in Mise v${version}</h1>`
    );
    fs.writeFileSync(whatsNewPath, whatsNew, 'utf8');
    console.log('✓ assets/whats-new.html titles updated');
}

console.log('Version synchronisation complete.');
