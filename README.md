# Mise Browser

Mise is a personal project designed to provide a highly lightweight, security-first, and privacy-focused browsing environment tailored specifically for low-end, fanless systems. By leveraging the rendering efficiency of the Chromium engine wrapped within a streamlined Electron framework, it minimises system resource consumption while delivering an isolated, responsive, and robust web experience. By combining powerful tab and workspace management with extensive keyboard shortcut integration, it enables a completely mouse-free browsing experience.

## ## Key Features

Mise is engineered with a modular suite of tools that bridge the gap between web documentation and local system environments, focusing heavily on user tracking mitigation and secure workflow automation.

- **Air-Gapped Terminal Handshake**: An input parsing algorithm identifies high-risk script extensions and raw network URIs inside the palette interface, automatically appending the `oversight` security wrapper. To eliminate remote code execution risks, the browser copies the formatted text to the system clipboard and opens an unmanaged, empty terminal instance for safe manual verification and execution.
- **Vertical Tabs Sidebar**: A persistent vertical sidebar optimises screen real estate and keeps tab management highly accessible, allowing users to scroll, select, and switch between open web pages cleanly.
- **Distro and Shell Agnostic Design**: The terminal spawning architecture dynamically branches based on the host platform, using localized environmental lookups to natively interface with Linux terminal emulators, macOS Terminal, or Windows Terminal/cmd without modifying backend configurations.
- **Privacy-First Network Interception**: A distribution-agnostic request filter blocks global telemetry packages, marketing tracker modules, and background logging endpoints natively before they can initialize outward network connections.
- **Granular Profile Management**: Features an isolated private browsing mode that decouples from the primary session into a volatile, memory-only cache partition alongside targeted cleanup utilities designed to surgically clear individual domain cookies or global profile data.
- **Dynamic Workspace Trees**: System profiles use persistent session caching to group concurrent tab layouts into distinct, named workspaces managed via a fluid, structural overlay dashboard.
- **Keyboard-Centric Navigation**: Customise and control your browsing behaviour using a comprehensive set of keyboard shortcuts.
- **Search Bar Aliases**: This allows for rapid navigation using shorthand keywords (e.g., `g` for Google, `a` for Arch Wiki, `gh` for GitHub).
- **Link Hints Overlay**: Navigate web pages without a mouse. Pressing the hint shortcut overlays two-letter labels using a left-hand cluster of keys (`q, w, e, a, s, d, z, x, c, r, f, v`) onto all interactive elements for instant triggering.
- **Interactive Command Palette**: Quickly filter and execute browser commands with the integrated search palette.
- **Workspace Dashboard**: Organise tabs and sessions into distinct workspaces, keeping different tasks and projects separated.
- **Built-in Privacy & Request Filtering**: Automatically blocks tracking, analytics, and telemetry requests to keep your browsing session fast and private.
- **Theme Customisation**: Instantly toggle between beautifully styled dark and light themes.
- **Notes**: Take notes right in the browser. All saved localy in notes.md. Suports markdown editing and preview.
- **DevTolls**: Intagrated DevTools. Toggled via keybind or within the Command Palette. Opens in a new window.
- **Hide/Unhide Sidebar**: Easy to hide and unhide sidebar with keybind of within the Command Palette.
---

## Installation
Mise is built to be modular, lightweight, and easy to set up across different platforms.

**Prerequisites**
Ensure the system has `Node.js` and `npm` installed. The application dynamically adapts to the host operating system to handle terminal integration:

- **Linux**: Ensure a compliant terminal emulator is installed (such as kitty, alacritty, foot, st, or xterm), or that xdg-terminal-exec is configured.
- **macOS**: Utilises the built-in system Terminal.app.
- **Windows**: Works automatically with Windows Terminal (wt) or falls back to the native cmd.exe.

## Setup Instructions
1. Clone the repository and navigate into the project root directory:

`git clone https://github.com/Rakosn1cek/MiseBrowser.git`
`cd MiseBrowser`

2. Install the production dependencies required by the Electron runtime framework:

`npm install`

3. Launch the application:

`npm start`

Alternatively, on Linux systems, you can use the provided distro-agnostic launcher script:

```bash
chmod +x launch.sh
./launch.sh
```

---

## Keyboard Shortcuts

Mise Browser is designed to be fully controllable via keyboard shortcuts. Below is a reference of the default bindings.

### Navigation & Workspaces

| Shortcut | Action |
| :--- | :--- |
| Ctrl + T | Open a new tab |
| Ctrl + L | Toggle the floating address bar |
| Ctrl + W | Close the current tab |
| Ctrl + Shift + W | Toggle the workspace dashboard |
| Ctrl + S | Quick-save the active workspace |
| Ctrl + R | Reload the active tab |
| Ctrl + D | Quick-remove the current tab |
| Ctrl + M | Focus the sidebar tab list |
| Ctrl + B | Focus the active webview |
| Ctrl + P | Toggle the command palette |
| Ctrl + Shift + P | Toggle private browsing mode |
| Ctrl + H | Toggle the help / shortcut reference overlay |
| Ctrl + N | Open Notes overlay |
| Ctrl + Shift + I | Opens DevTools in new window | 
| Ctrl + Shift + Z | Hide/unhide Sidebar |

### Web Interaction

| Shortcut | Action |
| :---  | :---  |
| Ctrl + F | Toggle link hints overlay |
| Right Click | Open contextual menu (Copy, Paste, Save Image As, etc.) |

### Search Bar 

| Alias | Action |
| :--- | :--- |
| a | https://wiki.archlinux.org/index.php?search= |
| g | https://www.google.com/search?q= |
| yt | https://www.youtube.com/results?search_query= |
| gh | https://github.com/search?q= |
| ddg | https://duckduckgo.com/?q= |
| pkg | https://archlinux.org/packages/?q= |
| so | https://stackoverflow.com/search?q= |
| r | https://www.reddit.com/search/?q= |


---

## Project Structure

- **`main.js`**: Configures the Electron main process, window creation, ad/telemetry blocking, and IPC message routing.
- **`preload.js`**: Safe bridge exposing specific APIs to the renderer context via `contextBridge`.
- **`renderer.js`**: Manages browser state, workspace layout, UI event handlers, and themes.
- **`hinter.js`**: Injectable script implementing the Link Hints overlay.
- **`webview-preload.js`**: Webview-level preload script bubbling key events and handling custom context menus.
- **`style.css`**: Standard stylesheet defining the dark and light theme colours and layout elements.
- **`launch.sh`**: Helper shell script to launch the application safely.

---

## Licence

This project is licensed under the terms of the licence included in this repository.
