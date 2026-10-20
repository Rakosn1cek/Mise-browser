// tests/notes-markdown-links.test.js
// Verification for markdown hyperlink sanitisation and click safety in notes overlay

const assert = require('node:assert/strict');
const { parseMarkdownToHtml } = require('../modules/overlays/notes.js');
const { isSafeTabUrl } = require('../modules/utils.js');

console.log('Running Mise notes markdown hyperlink sanitisation regression tests...');

// 1. Verify parseMarkdownToHtml converts valid http and https hyperlinks
{
    const safeMarkdown = 'Check out [Mise Browser](https://misebrowser.com) or [Local Dev](http://localhost:8080/app).';
    const html = parseMarkdownToHtml(safeMarkdown);

    assert(
        html.includes('<a href="https://misebrowser.com" target="_blank" rel="noopener noreferrer">Mise Browser</a>'),
        'Safe HTTPS URL must be rendered as an anchor tag'
    );
    assert(
        html.includes('<a href="http://localhost:8080/app" target="_blank" rel="noopener noreferrer">Local Dev</a>'),
        'Safe HTTP URL must be rendered as an anchor tag'
    );

    console.log('✓ Valid HTTP and HTTPS markdown links correctly rendered');
}

// 2. Verify parseMarkdownToHtml strips anchor tags from unsafe protocols
{
    const dangerousCases = [
        ['[System Passwd](file:///etc/passwd)', 'file:///etc/passwd'],
        ['[Script Execution](javascript:alert(1))', 'javascript:alert(1)'],
        ['[Data Payload](data:text/html,<b>exploit</b>)', 'data:text/html'],
        ['[VB Script](vbscript:msgbox(1))', 'vbscript:msgbox(1)'],
        ['[FTP Resource](ftp://example.com/files)', 'ftp://example.com']
    ];

    for (const [markdown, dangerousScheme] of dangerousCases) {
        const html = parseMarkdownToHtml(markdown);
        assert.equal(
            html.includes('<a href='),
            false,
            `Unsafe link "${dangerousScheme}" must not produce an HTML anchor tag`
        );
        assert(
            !html.includes(dangerousScheme),
            `Unsafe scheme "${dangerousScheme}" must not be rendered as an active destination`
        );
    }

    console.log('✓ Disallowed schemes (file, javascript, data, vbscript, ftp) safely neutralised');
}

// 3. Verify click handler navigation guard logic
{
    function simulateLinkClick(href) {
        const spawned = [];
        let overlayToggled = false;
        let defaultPrevented = false;

        const fakeEvent = {
            target: {
                closest: (selector) => (selector === 'a' ? { href } : null)
            },
            preventDefault: () => { defaultPrevented = true; }
        };

        const fakeLink = fakeEvent.target.closest('a');
        if (fakeLink && fakeLink.href) {
            fakeEvent.preventDefault();
            if (isSafeTabUrl(fakeLink.href)) {
                spawned.push(fakeLink.href);
                overlayToggled = true;
            }
        }

        return { defaultPrevented, spawned, overlayToggled };
    }

    // A. Safe HTTPS link click
    {
        const result = simulateLinkClick('https://duckduckgo.com');
        assert.equal(result.defaultPrevented, true, 'Default anchor navigation must be prevented');
        assert.equal(result.spawned.length, 1, 'Safe URL must trigger tab spawn');
        assert.equal(result.spawned[0], 'https://duckduckgo.com');
        assert.equal(result.overlayToggled, true, 'Notes overlay must toggle closed on safe spawn');
    }

    // B. Unsafe file scheme click
    {
        const result = simulateLinkClick('file:///etc/shadow');
        assert.equal(result.defaultPrevented, true, 'Default navigation must be prevented');
        assert.equal(result.spawned.length, 0, 'Unsafe file scheme must not trigger tab spawn');
        assert.equal(result.overlayToggled, false, 'Overlay must remain open when unsafe link is clicked');
    }

    // C. Malicious javascript scheme click
    {
        const result = simulateLinkClick('javascript:void(0)');
        assert.equal(result.defaultPrevented, true, 'Default navigation must be prevented');
        assert.equal(result.spawned.length, 0, 'Javascript scheme must not trigger tab spawn');
        assert.equal(result.overlayToggled, false, 'Overlay must remain open on javascript click');
    }

    console.log('✓ Click handler safe protocol enforcement verified');
    console.log('All notes markdown hyperlink sanitisation tests passed successfully!');
}
