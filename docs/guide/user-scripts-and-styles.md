# Local User Scripts & User Styles

Mise Browser provides built-in support for custom user scripts and user styles, delivering the capabilities of extensions like Greasemonkey, Tampermonkey, and Stylus without the heavy memory footprint of a WebExtension background runtime.

---

## Architecture & Benefits

Traditional browser extensions run continuous background service workers and event loops, consuming hundreds of megabytes of RAM even when idle.

Mise replaces this overhead with a filesystem-driven engine:
* **Zero Extension Runtime**: Scripts and styles are plain text files stored directly in `~/.config/mise-browser/`.
* **Automatic Ingestion**: Mise injects matching `.user.js` and `.user.css` files into `<webview>` instances when the Document Object Model is ready (`dom-ready`).
* **Live Inotify Watching**: Modifications made in your favourite text editor are detected in real time. CSS styles update on the fly without refreshing the page.

---

## Why Mise Avoids Full WebExtensions

Mainstream browsers rely on the WebExtensions API (Manifest V2 and V3). While
flexible, this architecture creates significant problems on lightweight and
fanless Linux hardware:

1. **Heavy Background Memory Overhead**:
   Every installed extension typically spawns its own background service
   worker, isolated storage instance, and inter-process communication bus.
   A browser with five or six extensions routinely wastes 300MB to 800MB of
   system memory before any web page has loaded.

2. **Thermal Strain on Fanless Hardware**:
   Persistent background extension workers frequently wake CPU cores to poll
   events, preventing low-power idle C-states and triggering thermal throttling
   on fanless machines.

3. **Supply-Chain Security Risks**:
   Centralised extension stores suffer from a chronic security problem: popular
   extensions are regularly bought by data-collection companies and updated
   silently with tracking code. Mise enforces a strictly local-only policy.
   Only scripts and styles you explicitly save into your local config directory
   can ever execute.

4. **Native Handling of Core Capabilities**:
   When analysing what users actually install extensions for, four use cases
   dominate:
   * **Ad & Tracker Blocking**: Handled natively in Mise with network engine
     blocking via `@ghostery/adblocker-electron`.
   * **Tab Suspension**: Handled natively via Mise true tab hibernation.
   * **Custom Styling**: Handled cleanly via local `~/.config/mise-browser/styles/`.
   * **Page Script Tweaks**: Handled cleanly via local `~/.config/mise-browser/scripts/`.

By handling core browser mechanics in the engine and letting users drop in
clean `.user.js` and `.user.css` files, Mise delivers the exact customisations
users want while maintaining a near-zero idle resource footprint.

---

## Directory Locations

User content files are placed inside their respective configuration folders:

```text
~/.config/mise-browser/scripts/         # Local user scripts (*.user.js or *.js)
~/.config/mise-browser/styles/          # Local user styles (*.user.css or *.css)
~/.config/mise-browser/script-storage/  # Persistent JSON stores for GM_setValue
```

Mise automatically creates these directories and populates template examples on startup. You can also open any folder directly from the Command Palette (**Ctrl + P**):
* `Open User Scripts Directory (~/.config/mise-browser/scripts)`
* `Open User Styles Directory (~/.config/mise-browser/styles)`
* `Open User Script Storage Directory (~/.config/mise-browser/script-storage)`

---

## Writing User Scripts (`.user.js`)

Scripts support standard Greasemonkey/Tampermonkey metadata headers:

```javascript
// ==UserScript==
// @name         GitHub Minimalist
// @version      1.0.0
// @description  Streamline GitHub repository navigation
// @match        https://github.com/*
// @exclude      https://github.com/settings/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

(function() {
    console.log('Mise user script active on GitHub');
})();
```

### Supported Directives
* `@name`: Identifies the script in browser diagnostics and console logs.
* `@version`: Specifies the script version string.
* `@description`: Summary of what the script does.
* `@author`: Script author name or email.
* `@match`: Specifies URL match patterns (e.g. `https://*.example.com/*` or `*://*/*`).
* `@include`: Additional wildcard patterns or regular expressions.
* `@exclude`: Patterns to skip execution on specific paths or subdomains.
* `@grant`: Declares intended API permissions (e.g. `GM_xmlhttpRequest`, `GM_setValue`).
* `@run-at`: Determines execution timing (`document-end`, `document-idle`).

If no `@match` or `@include` is supplied, the script runs across all standard `http://` and `https://` websites.

---

## Supported Userscript APIs (`GM_*` and `GM.*`)

Mise includes a lightweight, secure API shim for popular Greasemonkey and Tampermonkey scripts without needing an extension runtime:

| API | Type | Description |
| :--- | :--- | :--- |
| `GM_xmlhttpRequest(details)` | Network | Cross-origin HTTP request proxied via main process, bypassing webpage CORS. |
| `GM_getValue(key, default)` | Storage | Synchronously reads a stored value from the script's local JSON database. |
| `GM_setValue(key, value)` | Storage | Updates in-memory store immediately and persists to disk in the background. |
| `GM_deleteValue(key)` | Storage | Deletes a stored key from the script's JSON storage file. |
| `GM_listValues()` | Storage | Returns an array of all keys stored for the current script. |
| `GM_addStyle(css)` | DOM | Appends a `<style>` element containing custom CSS to the active document. |
| `GM_registerMenuCommand(name, fn)` | UI | Registers an action callback. |
| `GM_unregisterMenuCommand(id)` | UI | Unregisters a previously added menu action. |
| `GM_setClipboard(text)` | Clipboard | Writes plain text to the system clipboard. |
| `GM_log(...args)` | Debugging | Outputs formatted log entries with script name prefix to DevTools. |
| `GM_openInTab(url)` | Window | Opens a target URL in a new window or tab. |
| `GM_notification(text, title)` | System | Displays a desktop notification. |
| `GM_info` | Metadata | Provides script metadata, version, and execution environment details. |
| `unsafeWindow` | Window | Direct reference to the page window object. |
| `GM.*` (GM4 Promise API) | Promises | Promise-based counterparts (`GM.xmlHttpRequest`, `GM.getValue`, etc.). |

### Cross-Origin Requests (`GM_xmlhttpRequest`)

Standard `fetch()` inside a webpage cannot access third-party endpoints because of browser CORS restrictions. Mise routes `GM_xmlhttpRequest` requests through the privileged main process:

```javascript
GM_xmlhttpRequest({
    method: 'GET',
    url: 'https://api.github.com/repos/rakosn1cek/mise-browser/releases/latest',
    headers: {
        'Accept': 'application/vnd.github.v3+json'
    },
    onload: function(response) {
        const data = JSON.parse(response.responseText);
        console.log('Latest Mise release:', data.tag_name);
    },
    onerror: function(err) {
        console.error('Failed to query release info:', err);
    }
});
```

### Isolated Per-Script Storage

Values saved with `GM_setValue` are stored in isolated JSON files under `~/.config/mise-browser/script-storage/`:

```javascript
// Check stored user preference with fallback default
const viewMode = GM_getValue('view_mode', 'compact');

// Save updated preference
GM_setValue('view_mode', 'expanded');
```

---

## Writing User Styles (`.user.css`)

Styles can be authored using either modern UserStyle metadata or classic `@-moz-document` syntax.

### UserStyle Header Format

```css
/* ==UserStyle==
@name           Wikipedia Clean Dark
@match          https://*.wikipedia.org/*
==/UserStyle== */

body {
    background-color: #1a1b26 !important;
    color: #c0caf5 !important;
}
```

### Stylus / `@-moz-document` Format

Mise parses domain and prefix conditions natively, making userstyles from repositories like userstyles.world work out of the box:

```css
@-moz-document domain("reddit.com"), domain("old.reddit.com") {
    .side {
        display: none !important;
    }
}
```

---

## Live Reloading

* When you save changes to any file in `~/.config/mise-browser/styles/`, Mise reloads the stylesheet and hot-swaps the CSS in active tabs immediately.
* When you modify files in `~/.config/mise-browser/scripts/`, the updated JavaScript is parsed and staged for execution on the next page navigation.
* Run **Reload User Scripts and Styles** in the Command Palette (**Ctrl + P**) at any time to force an immediate disk re-scan.
