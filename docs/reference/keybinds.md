# Keyboard Shortcuts Reference

All keyboard shortcuts in Mise Browser are fully customisable via `~/.config/mise-browser/keybinds.json`.

---

## Default Shortcut Bindings

### Navigation & Workspaces

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **F1** | `toggle-menu-bar` | Toggles the Mise Settings and Menu Bar |
| **Ctrl + T** | `spawn-tab` | Opens a new blank tab (defaults to configured search engine) |
| **Ctrl + L** | `toggle-address` | Opens the floating address bar overlay |
| **Ctrl + W** | `remove-tab` | Closes the currently active tab or selected dashboard node |
| **Ctrl + D** | `remove-tab` | Secondary binding to close the current tab |
| **Ctrl + Shift + W** | `toggle-dashboard` | Opens the Workspace Dashboard tree overlay |
| **Ctrl + S** | `toggle-find` | Find in page / quick save active workspace |
| **Ctrl + R** | `reload-active-tab` | Reloads the active tab |
| **Ctrl + M** | `focus-sidebar` | Moves focus to the vertical tab sidebar |
| **Ctrl + B** | `focus-webview` | Moves focus directly into the active web page |
| **Ctrl + Shift + Z** | `toggle-zen-mode` | Toggles Zen Mode (hides or restores sidebar) |
| **Ctrl + P** | `toggle-palette` | Opens the Command Palette |
| **Ctrl + Shift + P** | `toggle-private-mode`| Toggles volatile in-memory private browsing mode |
| **Ctrl + H** | `toggle-help` | Opens the Preferences and settings overlay |
| **Ctrl + N** | `toggle-notes` | Opens the Markdown quick-notes overlay |
| **Ctrl + Shift + B** | `toggle-bookmarks` | Opens the Bookmarks and Quickmarks overlay |
| **Ctrl + Shift + H** | `toggle-history` | Opens the Actionable History overlay |

### Web Interaction & Power Tools

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **Ctrl + F** | `trigger-hints` | Toggles Link Hints overlay for mouse-free clicking |
| **Ctrl + Shift + Q [key]** | `set-quickmark` | Binds current page URL to any single key |
| **Ctrl + J [key]** | `jump-quickmark` | Jumps instantly to the URL bound to that key |
| **Ctrl + Shift + A** | `add-bookmark` | Saves the current tab into `bookmarks.json` |
| **Ctrl + Shift + 0** | `toggle-global-media` | Plays or pauses media playback globally |
| **F10** | `toggle-global-media` | Secondary global media play/pause binding |
| **Ctrl + Shift + I** | `toggle-devtools` | Opens Chromium DevTools in a dedicated window |
| **F12** | `toggle-devtools` | Secondary shortcut for DevTools |

---

## Customising Shortcuts (`keybinds.json`)

Keybindings are decoupled from source code and managed by `keybinds.js`. You can customise any shortcut by editing:

```text
~/.config/mise-browser/keybinds.json
```

### Example Custom Configuration

```json
{
  "spawn-tab": "Ctrl+T",
  "toggle-address": "Ctrl+O",
  "remove-tab": ["Ctrl+W", "Ctrl+D", "Ctrl+Q"],
  "focus-sidebar": "Alt+M",
  "focus-webview": "Alt+B",
  "trigger-hints": "Ctrl+F",
  "toggle-zen-mode": "F11"
}
```

- **Modifiers**: Use `Ctrl`, `Alt`, `Shift`, or `Meta` combined with `+`.
- **Multiple Bindings**: Assign an array of strings to bind multiple shortcuts to the same action (e.g. `["Ctrl+W", "Ctrl+D"]`).
- **Reloading**: Customisations apply immediately upon restarting Mise, or automatically when modifying bindings via the internal configuration bridge.
