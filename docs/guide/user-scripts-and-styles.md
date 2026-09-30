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
~/.config/mise-browser/scripts/    # Local user scripts (*.user.js or *.js)
~/.config/mise-browser/styles/     # Local user styles (*.user.css or *.css)
```

Mise automatically creates both directories and populates template examples on startup. You can also open either folder directly from the Command Palette (**Ctrl + P**):
* `Open User Scripts Directory (~/.config/mise-browser/scripts)`
* `Open User Styles Directory (~/.config/mise-browser/styles)`

---

## Writing User Scripts (`.user.js`)

Scripts support standard Greasemonkey/Tampermonkey metadata headers:

```javascript
// ==UserScript==
// @name         GitHub Minimalist
// @match        https://github.com/*
// @exclude      https://github.com/settings/*
// ==/UserScript==

(function() {
    console.log('Mise user script active on GitHub');
})();
```

### Supported Directives
* `@name`: Identifies the script in browser diagnostics and console logs.
* `@match`: Specifies URL match patterns (e.g. `https://*.example.com/*` or `*://*/*`).
* `@include`: Additional wildcard patterns or regular expressions.
* `@exclude`: Patterns to skip execution on specific paths or subdomains.

If no `@match` or `@include` is supplied, the script runs across all standard `http://` and `https://` websites.

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
