// tests/bot-block-retry.test.js
// Regression tests for the bot-manager 403 recovery used by main.js.
//
// The flow this protects: a link behind Akamai Bot Manager (ebay.com) answers a
// request with a stale bot cookie with "Error Page | eBay" (HTTP 403) whose own
// sensor script mints the next cookie; clicking the same link again then works.
// Mise now does that second request itself - once per URL, after the error page
// settled, and only when the refusal actually carried bot-manager cookies.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    BOT_MANAGER_COOKIE,
    hasBotManagerCookie,
    isBotBlockResponse,
    createBotBlockRetryTracker
} = require('../main/botBlockRetry');

console.log('Running Mise bot-block 403 retry regression tests...');

// 1. Bot-manager cookie detection
{
    assert(BOT_MANAGER_COOKIE.test('bm_s=abc; Path=/'), 'bm_s must be recognised');
    assert(BOT_MANAGER_COOKIE.test('bm_sz=abc'), 'bm_sz must be recognised');
    assert(BOT_MANAGER_COOKIE.test('ak_bmsc=abc'), 'ak_bmsc must be recognised');
    assert(BOT_MANAGER_COOKIE.test('_abck=abc'), '_abck must be recognised');
    assert(!BOT_MANAGER_COOKIE.test('session=abc'), 'a plain session cookie is not a bot cookie');
    assert(!BOT_MANAGER_COOKIE.test('bm_something=abc'), 'a prefix match on a different name must not count');

    assert(hasBotManagerCookie({ 'Set-Cookie': 'bm_s=abc; Path=/' }), 'string Set-Cookie header must be read');
    assert(hasBotManagerCookie({ 'set-cookie': ['other=1', 'bm_so=abc; Path=/'] }), 'array Set-Cookie must be scanned');
    assert(!hasBotManagerCookie({ 'Content-Type': 'text/html' }), 'headers without Set-Cookie must not match');
    assert(!hasBotManagerCookie(null), 'missing headers must not throw');
    console.log('✓ bot-manager cookie detection (string, array, case, non-matches) verified');
}

// 2. Response classification: only a 403 that hands back bot cookies is retried
{
    const botHeaders = { 'Set-Cookie': 'bm_s=abc; Path=/' };
    assert.strictEqual(isBotBlockResponse(403, botHeaders), true);
    assert.strictEqual(isBotBlockResponse('403', botHeaders), true, 'string status must be accepted');
    assert.strictEqual(isBotBlockResponse(200, botHeaders), false, 'a 200 is never a refusal');
    assert.strictEqual(isBotBlockResponse(403, { 'Content-Type': 'text/html' }), false, 'a plain 403 must not be retried');
    assert.strictEqual(isBotBlockResponse(404, botHeaders), false, 'a 404 must not be retried');
    console.log('✓ 403-with-bot-cookie classification verified');
}

// 3. Tracker: one retry per URL per webContents, after the matching 403
{
    const tracker = createBotBlockRetryTracker({ cooldownMs: 1000 });
    const url = 'https://www.ebay.com/itm/137884540093?_skw=rtx+3090';

    assert.strictEqual(tracker.claim(7, url, 1000), false, 'claim without a recorded 403 must be refused');

    tracker.note(7, url);
    assert.strictEqual(tracker.claim(7, url, 1000), true, 'the recorded 403 must be claimable');

    tracker.note(7, url);
    assert.strictEqual(tracker.claim(7, url, 1500), false, 'a second retry inside the cooldown must be refused');
    tracker.note(7, url);
    assert.strictEqual(tracker.claim(7, url, 2500), true, 'the same URL may be retried again after the cooldown');

    tracker.note(7, url);
    assert.strictEqual(tracker.claim(8, url, 3000), false, 'a note belongs to one webContents only');

    const otherUrl = 'https://www.ebay.com/itm/999';
    tracker.note(9, otherUrl);
    assert.strictEqual(tracker.claim(9, url, 3000), false, 'a claim must match the exact blocked URL');
    assert.strictEqual(tracker.claim(9, otherUrl, 3000), true, 'the recorded URL is claimable');

    tracker.note(10, url);
    tracker.note(10, otherUrl);
    assert.strictEqual(tracker.claim(10, url, 3000), false, 'the newer navigation replaces the stale note');
    assert.strictEqual(tracker.claim(10, otherUrl, 3000), true, 'the latest blocked URL is claimable');

    tracker.note(11, url);
    tracker.clear(11);
    assert.strictEqual(tracker.claim(11, url, 3000), false, 'clear() must drop a pending retry');
    console.log('✓ tracker one-shot, per-URL, per-webContents and cooldown behaviour verified');
}

// 4. Tracker stays bounded under a page that refuses everything repeatedly
{
    const tracker = createBotBlockRetryTracker({ cooldownMs: 60000, maxEntries: 4 });
    for (let i = 0; i < 50; i += 1) {
        tracker.note(1, `https://example.test/page-${i}`);
        tracker.claim(1, `https://example.test/page-${i}`, 1000 + i);
    }
    const { pending, retried } = tracker.size();
    assert(pending <= 4 && retried <= 4, `tracker maps must stay bounded, got ${JSON.stringify({ pending, retried })}`);
    console.log('✓ tracker entry cap prevents unbounded growth');
}

// 5. Wiring: the decision is actually reachable from the running browser
{
    const repoRoot = path.join(__dirname, '..');
    const moduleSource = fs.readFileSync(path.join(repoRoot, 'main', 'botBlockRetry.js'), 'utf8');
    const securitySource = fs.readFileSync(path.join(repoRoot, 'security.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(repoRoot, 'main.js'), 'utf8');

    assert(!/require\(['"]electron['"]\)/.test(moduleSource),
        'main/botBlockRetry.js must stay electron-free so it can be unit tested');

    assert(/setBotBlockObserver/.test(securitySource),
        'security.js must expose setBotBlockObserver');
    assert(/hasBotManagerCookie\(details\.responseHeaders\)/.test(securitySource),
        'security.js must classify a response by its Set-Cookie headers');
    assert(/Number\(details\.statusCode\) === 403/.test(securitySource),
        'security.js must only report 403 responses');
    assert(/setBotBlockObserver,\s*\n/.test(securitySource) || /setBotBlockObserver,/.test(securitySource),
        'security.js must export setBotBlockObserver');

    assert(/security\.setBotBlockObserver\(/.test(mainSource),
        'main.js must register the bot-block observer');
    assert(/did-frame-navigate[\s\S]{0,400}Number\(httpResponseCode\) !== 403/.test(mainSource),
        'main.js must react to a main-frame 403 navigation');
    assert(/botBlockRetries\.claim\(webContents\.id, url\)/.test(mainSource),
        'main.js must claim the retry through the bounded tracker');
    assert(/toUpperCase\(\) !== 'GET'/.test(mainSource),
        'main.js must not replay a refused non-GET navigation (loadURL cannot re-send its body)');
    assert(/webContents\.getURL\(\) !== url/.test(mainSource),
        'the retry must be skipped when the tab already moved on');
    assert(/did-stop-loading[\s\S]{0,120}retry/.test(mainSource),
        'the retry must wait for the error page (and its sensor script) to settle');
    assert(/webContents\.loadURL\(url\)/.test(mainSource),
        'the retry must replay the refused URL');
    console.log('✓ main.js and security.js wiring verified');
}

console.log('All bot-block 403 retry tests passed successfully!');
