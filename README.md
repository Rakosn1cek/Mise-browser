# Mise Browser

> A lightweight, keyboard-first, and container-isolated web browser engineered specifically for low-resource and fanless Linux hardware.

[![Documentation](https://img.shields.io/badge/docs-GitHub_Pages-blue.svg)](https://rakosn1cek.github.io/Mise-browser/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

Mise leverages the Chromium rendering engine wrapped inside a streamlined Electron framework to minimise system overhead while delivering a fast, isolated web experience without mouse dependency.

📖 **Official Documentation & Landing Page**: [https://rakosn1cek.github.io/Mise-browser/](https://rakosn1cek.github.io/Mise-browser/)

***

## Key Highlights

* **True Tab Hibernation**: Detaches idle `<webview>` tags completely from the DOM across all workspaces, terminating idle Chromium renderer processes and reducing RAM usage by 60% or more. Live URLs, page titles, and scroll offsets are restored on demand.
* **Auto-Collapsing Vertical Strip**: The vertical sidebar collapses into a 36px icon strip displaying workspace badges and tab favicons, expanding smoothly as an overlay on hover or via shortcut without triggering webview layout shifts.
* **Multi-Account Container Partitions**: Each workspace runs in its own isolated Electron persistent partition (`persist:work`, `persist:personal`), preventing cookie cross-contamination across accounts.
* **Mouse-Free Navigation**: Complete keyboard control via Link Hints, floating address bar with search aliases, and customisable shortcuts in `keybinds.json`.
* **Clipboard-Mediated Terminal Oversight**: High-risk script execution and raw web commands trigger a clipboard-mediated security handshake, sanitising and staging vetted commands to your clipboard for deliberate user review and execution in an external terminal.
* **Native Privacy & Trusted Sites**: Built-in request interception blocks trackers, telemetry, and advertisements without heavy third-party extensions, while allowing selective whitelisting for trusted banking and shopping services.
* **Local User Scripts & Styles**: Lightweight native injection of `.user.js` and `.user.css` files directly from `~/.config/mise-browser/` with inotify watching and live CSS hot-reloading, avoiding the heavy memory overhead of full WebExtensions.
* **Power Tools**: Integrated Markdown notes, bookmarks, quickmarks, actionable history overlay, and a full-page Command Centre.

***

## Security & Release Cadence

Security, isolation, and upstream dependency freshness are foundational principles for Mise:

* **Twice-Weekly Upstream Tracking**: Mise monitors upstream Electron and Chromium security releases twice weekly. Patches are evaluated, verified, and shipped promptly.
* **Engine Version Verification**: Active Mise, Electron, and Chromium runtime versions are visible directly within the Preferences overlay (`Ctrl + H`) and the Welcome view.
* **Strict Process Sandboxing**: Webviews run with `contextIsolation: true`, `nodeIntegration: false`, and Chromium sandboxing enabled, guarded by a minimal IPC whitelist.
* **Permissions Denied by Default**: Hardware access (camera, microphone, geolocation, and MIDI) is blocked by default.
* **Local Data Ownership**: History and bookmarks reside in local SQLite databases under user-only permissions (`0600`) with zero cloud telemetry.
* **Responsible Disclosure**: See our [Security Policy](SECURITY.md) for vulnerability disclosure guidelines via GitHub Security Advisories.

***

## Quick Start

### Prerequisites
* Linux (recommended), macOS, or Windows
* `Node.js` (v20+ recommended) and `npm`
* A terminal emulator (e.g. Kitty, Alacritty, Foot, st, xterm)

### Installation & Launch

```bash
# Clone the repository
git clone git@github.com:Rakosn1cek/Mise-browser.git
cd Mise-browser

# Install dependencies
npm install

# Start the browser
npm start
```

On Linux systems, you can also launch directly using the helper script:
```bash
./launch.sh
```

***

## Documentation

Comprehensive user guides and configuration references are hosted on our GitHub Pages site:

* [Getting Started & Philosophy](https://rakosn1cek.github.io/Mise-browser/guide/getting-started)
* [Mouse-Free Navigation & Link Hints](https://rakosn1cek.github.io/Mise-browser/guide/navigation)
* [Workspaces & Multi-Account Containers](https://rakosn1cek.github.io/Mise-browser/guide/workspaces-and-containers)
* [True Tab Hibernation Guide](https://rakosn1cek.github.io/Mise-browser/guide/tab-hibernation)
* [Local User Scripts & Styles Guide](https://rakosn1cek.github.io/Mise-browser/guide/user-scripts-and-styles)
* [Terminal Security & Oversight Scanner](https://rakosn1cek.github.io/Mise-browser/guide/terminal-oversight)
* [Keyboard Shortcuts Reference](https://rakosn1cek.github.io/Mise-browser/reference/keybinds)
* [Configuration Files Reference](https://rakosn1cek.github.io/Mise-browser/reference/configuration)

***

## Standalone Security Scanner

The clipboard-mediated terminal handshake works alongside the standalone `oversight` utility. To enable active security scanning and paging for terminal commands, clone and install [Oversight](https://github.com/Rakosn1cek/oversight).

***

## Project Policies

* [Privacy Policy](PRIVACY.md) (Zero telemetry, container isolation, and local data ownership)
* [Security Policy](SECURITY.md) (Process sandboxing, threat model, and responsible disclosure)
* [AI Policy](AI_POLICY.md) (Human architecture governance and zero runtime AI integration)

***

## Licence

This project is licensed under the terms of the GNU General Public Licence v3.0 (or any later version). See the [LICENSE](LICENSE) file for details.
