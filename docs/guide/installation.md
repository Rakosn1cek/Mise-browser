# Installation & Setup

Mise is designed to be lightweight, modular, and easy to run from source on Linux systems.

---

## Prerequisites

Before setting up Mise, ensure your system has `Node.js` (v18 or newer) and `npm` installed.

On Arch Linux:
```bash
sudo pacman -S nodejs npm
```

Ensure you have a terminal emulator installed for the air-gapped terminal features (such as `kitty`, `alacritty`, `foot`, `st`, or `xterm`).

---

## Setup from Source

1. Clone the repository and navigate into the project directory:

```bash
git clone https://github.com/Rakosn1cek/MiseBrowser.git
cd MiseBrowser
```

2. Install runtime and build dependencies:

```bash
npm install
```

3. Start Mise Browser:

```bash
npm start
```

Alternatively, you can run the provided launcher script:

```bash
chmod +x launch.sh
./launch.sh
```

---

## Desktop Environment Integration

To integrate Mise directly into your desktop application launcher (such as Rofi, Wofi, or your desktop menu) and install high-resolution icons:

```bash
npm run install-desktop
```

This installs `mise.desktop` into `~/.local/share/applications/` and deploys icons at 48x48, 128x128, and 256x256 resolutions to `~/.local/share/icons/hicolor/`.

---

## Configuration Location

All runtime configuration and persistent session data are stored locally in standard Linux XDG format:

```text
~/.config/mise-browser/
├── config.json          # Core engine and preference settings
├── keybinds.json        # Customisable keyboard shortcuts map
├── session.json         # Workspaces, open tabs, titles, and scroll offsets
├── bookmarks.json       # Saved browser bookmarks
├── quickmarks.json      # Single-key jump assignments
├── history.json         # Actionable history entries
└── notes.md             # Integrated markdown notes
```
