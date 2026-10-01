# Universal Dark Reader

Mise Browser features a high-performance, GPU-composited **Universal Dark Reader** engine built directly into the browser core.

Many web users rely on popular third-party extensions like Dark Reader to invert bright white pages at night. In Mise, this functionality is completely baked in, requiring zero third-party browser extensions, zero web store downloads, and zero background runtime overhead.

---

## Why Built-In Dark Mode Matters

Installing dark mode extensions in conventional browsers introduces significant trade-offs:

* **Zero Extension Bloat**: Traditional web extensions run persistent background workers, content script bridges, and DOM observers that frequently consume 100 MB or more of RAM per window. Mise executes dark mode transformations directly on Chromium's GPU compositor with 0ms script delay.
* **Privacy & Security**: Browser extension stores have repeatedly suffered from popular extensions being acquired or updated to inject tracking beacons and ad scripts. Mise's Dark Reader engine is 100% open source, runs entirely offline, and never sends data anywhere.
* **Fanless Hardware Efficiency**: Because transformations are handled at the compositor level using hardware-accelerated CSS filters, CPU wakeups and battery drain are kept to a minimum on low-power Linux devices.

---

## Intelligent Features & Protection

Mise's built-in Dark Reader does not simply invert colours blindly. It incorporates intelligent heuristics to maintain visual appeal and readability:

### Tokyo Night Midnight Palette
Light backgrounds are converted into a refined, low-glare Tokyo Night dark slate (`#1a1b26`), with carefully tuned contrast (`contrast(88%)`) and subtle midnight scrollbars (`#16161e` with `#3b4261` thumbs) to reduce eye strain.

### Media & Image Protection
Photographs, video streams, HTML5 canvases, vector graphics, and embedded charts preserve their original natural colours:
* `<img>`, `<picture>`, and `<video>` elements remain untouched.
* `<canvas>` and `<svg>` elements retain accurate data visualisation colours.
* CSS background-image icons on empty leaf elements are protected from colour corruption.

### Automatic Luminance Detection
Before applying dark styling, Mise samples the page background brightness in the webview. If a website already provides a native dark theme (for example, GitHub dark mode, YouTube dark theme, or DuckDuckGo dark), Dark Reader automatically skips inversion, preventing double-inversion artifacts.

### Fullscreen Video Passthrough
When a video player (such as YouTube, Vimeo, or a media stream) enters fullscreen mode (`:fullscreen`), Dark Reader automatically disables filtering so you enjoy media in its native clarity.

### Per-Site Exclusion and Overrides
Certain websites already feature bespoke colour schemes or delicate artwork that you may prefer not to invert. Mise provides an instant per-site exclusion system:
* **Host and Subdomain Matching**: Adding a domain such as `archlinux.org` automatically covers subdomains like `aur.archlinux.org`, whilst specific subdomains can also be targeted individually.
* **Instant Visual Indicator**: The Dark Reader sidebar icon highlights in soft red (`#f7768e`) whenever an excluded domain is focused, confirming that Dark Reader is inactive for that site.
* **Zero-Reload Switching**: Toggling an exclusion updates the active webview on the fly without refreshing the page or losing input state.

---

## How to Toggle Dark Reader

You can activate or deactivate Dark Reader globally, or manage site exclusions, using multiple controls:

| Method | Control | Action |
| :--- | :--- | :--- |
| **Global Toggle Shortcut** | <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> | Toggle dark mode globally across active tabs and split panes |
| **Domain Toggle Shortcut** | <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>E</kbd> | Exclude or re-enable the active website domain immediately |
| **Sidebar Toolbar** | <kbd>fa-circle-half-stroke</kbd> Icon | Left-click toggles globally; right-click toggles the active domain |
| **Page Context Menu** | Right-Click in Webview | Select **Toggle Dark Reader on this site** from the context menu |
| **Command Palette** | `Ctrl + P` | Search for `Toggle Dark Reader` or `Toggle Dark Reader for Current Domain` |
| **Preferences Overlay** | **Dark Reader Excluded Sites** | Add or remove domain names line by line in Preferences (<kbd>Ctrl + H</kbd>) |
| **Application Menu** | **Mise Settings** | Select **Universal Dark Reader** or **Toggle Dark Reader for Current Domain** |

---

## Configuration & Persistence

Dark Reader settings and excluded sites are saved automatically in your local configuration file:

```text
~/.config/mise-browser/config.json
```

```json
{
    "dark_reader": true,
    "dark_reader_disabled_domains": [
        "aur.archlinux.org",
        "example.com"
    ]
}
```

When enabled, Dark Reader automatically attaches to new tabs, woke background webviews, and dual-split view panes without requiring manual toggling.
