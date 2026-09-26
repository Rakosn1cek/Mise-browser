# Mise Browser

> A lightweight, keyboard-first, and container-isolated web browser engineered specifically for low-resource and fanless Linux hardware.

[![Documentation](https://img.shields.io/badge/docs-GitHub_Pages-blue.svg)](https://rakosn1cek.github.io/Mise-browser/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

Mise leverages the Chromium rendering engine wrapped inside a streamlined Electron framework to minimise system overhead while delivering a fast, isolated web experience without mouse dependency.

📖 **Official Documentation & Landing Page**: [https://rakosn1cek.github.io/Mise-browser/](https://rakosn1cek.github.io/Mise-browser/)

***

## Key Highlights

* **True Tab Hibernation**: Detaches idle `<webview>` tags completely from the DOM across all workspaces, terminating idle Chromium renderer processes and reducing RAM usage by 60% or more. Live URLs, page titles, and scroll offsets are restored on demand.
* **Multi-Account Container Partitions**: Each workspace runs in its own isolated Electron persistent partition (`persist:work`, `persist:personal`), preventing cookie cross-contamination across accounts.
* **Mouse-Free Navigation**: Complete keyboard control via Link Hints, floating address bar with search aliases, and customisable shortcuts in `keybinds.json`.
* **Air-Gapped Terminal Handshake**: High-risk script execution and raw web commands trigger an air-gapped terminal protocol, safely copying vetted commands to your clipboard and opening an empty terminal emulator.
* **Native Privacy & Trusted Sites**: Built-in request interception blocks trackers, telemetry, and advertisements without heavy third-party extensions, while allowing selective whitelisting for trusted banking and shopping services.
* **Power Tools**: Integrated Markdown notes, bookmarks, quickmarks, actionable history overlay, and a Command Palette.

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
* [Terminal Security & Oversight Scanner](https://rakosn1cek.github.io/Mise-browser/guide/terminal-oversight)
* [Keyboard Shortcuts Reference](https://rakosn1cek.github.io/Mise-browser/reference/keybinds)
* [Configuration Files Reference](https://rakosn1cek.github.io/Mise-browser/reference/configuration)

***

## Standalone Security Scanner

The air-gapped terminal handshake works alongside the standalone `oversight` utility. To enable active security scanning and paging for terminal commands, clone and install [Oversight](https://github.com/Rakosn1cek/oversight).

***

## Licence

This project is licensed under the terms of the GNU General Public Licence v3.0 (or any later version). See the [LICENSE](LICENSE) file for details.
