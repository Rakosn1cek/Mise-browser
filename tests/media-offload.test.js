// tests/media-offload.test.js
// Automated regression test suite for low-resource media offloading to mpv and yt-dlp

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Mock Electron objects for headless execution before requiring contextMenus
try {
    const electronResolved = require.resolve('electron');
    class MockMenuItem {
        constructor(opts) {
            Object.assign(this, opts);
        }
    }
    class MockMenu {
        constructor() {
            this.items = [];
        }
        append(item) {
            this.items.push(item);
        }
    }
    require.cache[electronResolved] = {
        id: electronResolved,
        filename: electronResolved,
        loaded: true,
        exports: {
            Menu: MockMenu,
            MenuItem: MockMenuItem,
            app: { getPath: () => '/tmp' },
            clipboard: { writeText: () => {} },
            shell: { openExternal: () => {} }
        }
    };
} catch (_) {}

console.log('Running Mise Media Offload (mpv & yt-dlp) regression tests...');

const mediaOffload = require('../main/mediaOffload');
const config = require('../main/config');
const contextMenus = require('../main/contextMenus');
const keybinds = require('../keybinds');

// 1. Host binary detection tests
{
    const tempDir = path.join(__dirname, 'mock_binaries_' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        const mockMpvPath = path.join(tempDir, 'mpv');
        const mockYtdlpPath = path.join(tempDir, 'yt-dlp');

        fs.writeFileSync(mockMpvPath, '#!/bin/sh\nexit 0', { mode: 0o755 });
        fs.writeFileSync(mockYtdlpPath, '#!/bin/sh\nexit 0', { mode: 0o755 });

        const detected = mediaOffload.detectMediaBinaries({
            forceRefresh: true,
            customCandidates: [mockMpvPath, mockYtdlpPath]
        });

        assert.equal(detected.mpvAvailable, true, 'mpv should be detected when binary file exists');
        assert.equal(detected.ytdlpAvailable, true, 'yt-dlp should be detected when binary file exists');
        assert.equal(detected.missing.length, 0, 'No missing binaries should be reported');

        const missingDetected = mediaOffload.detectMediaBinaries({
            forceRefresh: true,
            customCandidates: [path.join(tempDir, 'non_existent_binary')]
        });

        assert.equal(missingDetected.mpvAvailable, false, 'mpv should not be detected for non-existent path');
        assert.equal(missingDetected.missing.includes('mpv'), true, 'mpv should be reported in missing array');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    console.log('✓ Host binary detection and fallback checks verified');
}

// 2. URL Candidate & Classification Logic
{
    const validYouTubeUrls = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
        'https://youtu.be/dQw4w9WgXcQ',
        'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://gaming.youtube.com/watch?v=dQw4w9WgXcQ',
        'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://www.youtube.com/shorts/dQw4w9WgXcQ',
        'https://www.youtube.com/live/dQw4w9WgXcQ',
        'https://www.youtube.com/embed/dQw4w9WgXcQ',
        'https://www.youtube.com/playlist?list=PL123456789'
    ];

    validYouTubeUrls.forEach(url => {
        assert.equal(mediaOffload.isCandidateMediaUrl(url), true, `Expected ${url} to be recognised as candidate media`);
    });

    const validStreamUrls = [
        'https://example.com/video.mp4',
        'https://cdn.test.org/path/playlist.m3u8',
        'https://media.org/clip.webm?token=abc',
        'https://stream.host.com/live/manifest.mpd'
    ];

    validStreamUrls.forEach(url => {
        assert.equal(mediaOffload.isCandidateMediaUrl(url), true, `Expected ${url} to be recognised as candidate stream`);
    });

    const invalidUrls = [
        'https://example.com/article.html',
        'https://en.wikipedia.org/wiki/Linux',
        'https://www.youtube.com/',
        'https://www.youtube.com',
        'https://m.youtube.com/',
        'https://www.youtube.com/feed/subscriptions',
        'https://www.youtube.com/results?search_query=linux',
        'https://www.youtube.com/@channelname',
        'https://youtu.be/',
        'file:///home/user/video.mp4',
        'javascript:alert(1)',
        'data:text/html,test',
        '',
        null,
        undefined,
        'not a url',
        'https://' + 'a'.repeat(2100) + '.com/video.mp4'
    ];

    invalidUrls.forEach(url => {
        assert.equal(mediaOffload.isCandidateMediaUrl(url), false, `Expected ${url} to be rejected as candidate media`);
    });

    console.log('✓ URL candidate identification and protocol restrictions verified');
}

// 3. URL Sanitisation & Attack Surface Rejection
{
    const cleanUrl = mediaOffload.sanitiseMediaUrl('https://www.youtube.com/watch?v=test');
    assert.equal(cleanUrl, 'https://www.youtube.com/watch?v=test', 'Standard URL should be parsed cleanly');

    const trackedUrl = mediaOffload.sanitiseMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&t=42s&si=abc');
    assert.equal(trackedUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&t=42s&si=abc', 'Valid URL query parameters should be preserved without corruption');

    const newlineAttack = mediaOffload.sanitiseMediaUrl('https://www.youtube.com/watch?v=test\n--version');
    assert.equal(newlineAttack, 'https://www.youtube.com/watch?v=test--version', 'Newlines must be stripped');

    const nullByteAttack = mediaOffload.sanitiseMediaUrl('https://www.youtube.com/watch?v=test\0evil');
    assert.equal(nullByteAttack, 'https://www.youtube.com/watch?v=testevil', 'Null bytes must be stripped');

    const optionInjection = mediaOffload.sanitiseMediaUrl('--ytdl-format=best');
    assert.equal(optionInjection, null, 'Leading hyphen option injection must be rejected');

    const fileScheme = mediaOffload.sanitiseMediaUrl('file:///etc/passwd');
    assert.equal(fileScheme, null, 'file scheme must be rejected');

    const jsScheme = mediaOffload.sanitiseMediaUrl('javascript:alert(1)');
    assert.equal(jsScheme, null, 'javascript scheme must be rejected');

    console.log('✓ URL sanitisation and command injection defenses verified');
}

// 4. Argument Composition & Quality Formatting
{
    assert.equal(mediaOffload.formatYtdlQuality('1080p'), 'bestvideo[height<=?1080]+bestaudio/best[height<=?1080]');
    assert.equal(mediaOffload.formatYtdlQuality('720p'), 'bestvideo[height<=?720]+bestaudio/best[height<=?720]');
    assert.equal(mediaOffload.formatYtdlQuality('480p'), 'bestvideo[height<=?480]+bestaudio/best[height<=?480]');
    assert.equal(mediaOffload.formatYtdlQuality('best'), 'bestvideo+bestaudio/best');

    const args = mediaOffload.buildMpvArguments('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
        quality: '720p',
        title: 'Custom Title'
    });

    assert.equal(args.includes('--force-window=immediate'), true, 'force-window option must be set');
    assert.equal(args.includes('--hwdec=auto'), true, 'hwdec=auto option must be set');
    assert.equal(args.includes('--ytdl-format=bestvideo[height<=?720]+bestaudio/best[height<=?720]'), true, 'ytdl-format must match selected quality');
    assert.equal(args.includes('--title=Custom Title'), true, 'title option must be set');
    assert.equal(args[args.length - 2], '--', 'Double hyphen end of options flag must precede target URL');
    assert.equal(args[args.length - 1], 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Target URL must be last argument');

    console.log('✓ Argument composition and end of options flag verified');
}

// 5. Configuration Schema & Validation
{
    const loadedConfig = config.loadBrowserConfig();
    assert.equal(typeof loadedConfig.media_offload_enabled, 'boolean', 'media_offload_enabled must be boolean');
    assert.equal(typeof loadedConfig.media_offload_quality, 'string', 'media_offload_quality must be string');
    assert.equal(typeof loadedConfig.media_offload_pause_tab, 'boolean', 'media_offload_pause_tab must be boolean');

    const validPatch = config.validateConfigPatch({
        media_offload_enabled: false,
        media_offload_quality: '720p',
        media_offload_pause_tab: false
    });
    assert.equal(validPatch.clean.media_offload_enabled, false);
    assert.equal(validPatch.clean.media_offload_quality, '720p');
    assert.equal(validPatch.clean.media_offload_pause_tab, false);
    assert.equal(validPatch.rejected.length, 0);

    const invalidPatch = config.validateConfigPatch({
        media_offload_enabled: 'not-a-bool',
        media_offload_quality: '4k-invalid',
        media_offload_pause_tab: 123
    });
    assert.equal(invalidPatch.rejected.includes('media_offload_enabled'), true);
    assert.equal(invalidPatch.rejected.includes('media_offload_quality'), true);
    assert.equal(invalidPatch.rejected.includes('media_offload_pause_tab'), true);

    console.log('✓ Configuration schema and validation rules verified');
}

// 6. Context Menu Integration
{
    const mockWebContents = {
        getURL: () => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        getTitle: () => 'Rick Astley - Never Gonna Give You Up',
        send: () => {}
    };

    const menuWithYouTubeLink = contextMenus.buildWebviewContextMenu({
        linkURL: 'https://www.youtube.com/watch?v=abc'
    }, mockWebContents);

    const linkItem = menuWithYouTubeLink.items.find(item => item.label === 'Play Link in mpv');
    assert.ok(linkItem, 'Play Link in mpv must be present when linkURL is YouTube');

    const pageItem = menuWithYouTubeLink.items.find(item => item.label === 'Play Page in mpv');
    assert.ok(pageItem, 'Play Page in mpv must be present when webContents URL is YouTube');

    const mockPlainWebContents = {
        getURL: () => 'https://example.com/blog',
        getTitle: () => 'Blog Post',
        send: () => {}
    };

    const mockYouTubeHomeWebContents = {
        getURL: () => 'https://www.youtube.com/',
        getTitle: () => 'YouTube',
        send: () => {}
    };

    const menuOnYouTubeHome = contextMenus.buildWebviewContextMenu({
        linkURL: 'https://www.youtube.com/watch?v=abc'
    }, mockYouTubeHomeWebContents);

    const homeLinkItem = menuOnYouTubeHome.items.find(item => item.label === 'Play Link in mpv');
    assert.ok(homeLinkItem, 'Play Link in mpv must be present when hovering a video link on YouTube home');

    const homePageItem = menuOnYouTubeHome.items.find(item => item.label === 'Play Page in mpv');
    assert.equal(homePageItem, undefined, 'Play Page in mpv must not appear on YouTube home page');

    const menuWithPlainLink = contextMenus.buildWebviewContextMenu({
        linkURL: 'https://example.com/about'
    }, mockPlainWebContents);

    const noLinkItem = menuWithPlainLink.items.find(item => item.label === 'Play Link in mpv');
    assert.equal(noLinkItem, undefined, 'Play Link in mpv must not appear for non-media link');

    const noPageItem = menuWithPlainLink.items.find(item => item.label === 'Play Page in mpv');
    assert.equal(noPageItem, undefined, 'Play Page in mpv must not appear for non-media page');

    console.log('✓ Context menu item injection and contextual visibility verified');
}

// 7. Keybinds Registry & Static DOM Assertions
{
    const defaultBinds = keybinds.DEFAULT_KEYBINDS;
    assert.equal(defaultBinds['play-in-mpv'], 'Ctrl+Shift+Y', 'Default keybind for play-in-mpv must be Ctrl+Shift+Y');

    const metadata = keybinds.ACTION_METADATA;
    assert.ok(metadata['play-in-mpv'], 'Action metadata for play-in-mpv must exist');
    assert.equal(metadata['play-in-mpv'].category, 'Web Interaction');

    const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    assert.ok(indexHtml.includes('id="StatusBarMediaOffload"'), 'StatusBarMediaOffload badge must exist in index.html');

    const prefHtml = fs.readFileSync(path.join(__dirname, '../templates/preferences.html'), 'utf8');
    assert.ok(prefHtml.includes('id="setting-media-offload-enable"'), 'Media offload toggle must exist in preferences.html');
    assert.ok(prefHtml.includes('id="setting-media-offload-quality"'), 'Media offload quality dropdown must exist in preferences.html');
    assert.ok(prefHtml.includes('id="setting-media-offload-pause"'), 'Media offload pause toggle must exist in preferences.html');
    assert.ok(prefHtml.includes('id="media-offload-binary-status"'), 'Media offload binary status element must exist in preferences.html');
    assert.ok(prefHtml.includes('data-action="play-in-mpv"'), 'Shortcut row for play-in-mpv must exist in preferences.html');

    console.log('✓ Keybinds metadata and DOM scaffolding contracts verified');
}

console.log('All Media Offload regression tests passed successfully!');
