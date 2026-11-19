# Keyboard Shortcuts Reference

All keyboard shortcuts in Mise Browser are fully customisable via `~/.config/mise-browser/keybinds.json`.

---

## Default Shortcut Bindings

![Mise Browser Help and Shortcuts Reference](/screenshots/preferences-4.webp)

### Navigation & Workspaces

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **F1** | `toggle-menu-bar` | Toggles the Mise Settings and Menu Bar |
| **Ctrl + T** | `spawn-tab` | Opens a new blank tab (defaults to configured search engine) |
| **Ctrl + L** | `toggle-address` | Focuses the centered status bar address bar |
| **Ctrl + X** | `remove-tab` | Closes the currently active tab or selected dashboard node |
| **Ctrl + Shift + W** | `toggle-dashboard` | Opens the Workspace Dashboard tree overlay |
| **Ctrl + Shift + F** | `toggle-find` | In-page text search overlay across active webview content |
| **Ctrl + R** | `reload-active-tab` | Reloads the active tab |
| **Ctrl + Tab** | `focus-nav-buttons` | Moves focus to the vertical tab sidebar (focuses navigation buttons, allows Down arrow into tabs) |
| **Ctrl + Shift + N** | `toggle-notifications` | Opens the Notifications & Activity overlay |
| **Ctrl + Shift + T** | `toggle-task-manager` | Opens the Task Manager (Tab Resource Inspector) overlay |
| **Ctrl + W** | `focus-webview` | Moves focus directly into the active web page |
| **Ctrl + Shift + Z** | `toggle-zen-mode` | Toggles sidebar expansion or pin mode |
| **Ctrl + P** | `toggle-palette` | Opens the Command Palette |
| **Ctrl + Shift + P** | `toggle-private-mode`| Switches focus to or from the permanent Private workspace |
| **Ctrl + H** | `toggle-help` | Opens the Preferences and settings overlay |
| **Ctrl + N** | `toggle-notes` | Opens the Markdown quick-notes overlay |
| **Ctrl + Shift + B** | `toggle-bookmarks` | Opens the Bookmarks and Quickmarks overlay |
| **Ctrl + Shift + H** | `toggle-history` | Opens the Actionable History overlay |
| **Ctrl + Shift + D** | `toggle-downloads` | Toggles the native download shelf |
| **Ctrl + /** | `toggle-status-bar` | Toggles the bottom status and mode footer bar |
| **Ctrl + Shift + S** | `toggle-split` | Toggles dual split view (1x2 side by side comparison) |
| **Ctrl + O** | `switch-split-focus` | Cycles keyboard focus between split pane 1 and pane 2 |
| **Ctrl + \\** | `swap-split-panes` | Swaps the positions of pane 1 and pane 2 |
| **F4** | `toggle-pin-tab` | Pins or unpins the active tab (anchored at top, closure-protected) |

### Web Interaction & Power Tools

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **Ctrl + F** | `trigger-hints` | Toggles Link Hints overlay for mouse-free clicking |
| **Ctrl + G** | `trigger-glance` | Toggles Ephemeral Tab Peek (Glance) hints for previewing links |
| **Shift + Click** | `peek-preview` | Opens link in Ephemeral Tab Peek modal preview frame |
| **Ctrl + D** | `toggle-dark-reader` | Toggles Dark Reader high-contrast dark theme on active tab |
| **F9** | `toggle-reader-view` | Toggles Native Reader View (distilled readable article format) |
| **Enter** / **n** | `find-next` | Finds next match in active page |
| **Shift + Enter** / **N** | `find-previous` | Finds previous match in active page |
| **Ctrl + Shift + E** | `export-reader-to-notes` | Exports distilled Reader View article or page clipping to Quick Notes |
| **Ctrl + Shift + Q [key]** | `set-quickmark` | Binds current page URL to any single key |
| **Ctrl + J [key]** | `jump-quickmark` | Jumps instantly to the URL bound to that key |
| **Ctrl + Shift + A** | `add-bookmark` | Saves the current tab into `bookmarks.json` |
| **F10** | `toggle-global-media` | Plays or pauses media playback globally |
| **Ctrl + M** | `toggle-tab-audio-mute` | Mutes or unmutes audio on active tab |
| **Ctrl + Shift + Y** | `play-in-mpv` | Offloads active video to native mpv (hardware-accelerated media offload) |
| **Ctrl + Shift + M** | `send-to-mobile` | Generates a local SVG QR code modal to open the active page on mobile |
| **Ctrl + =** / **Ctrl + WheelUp** | `zoom-in` | Enlarge active webview content zoom level |
| **Ctrl + -** / **Ctrl + WheelDown** | `zoom-out` | Reduce active webview content zoom level |
| **Ctrl + 0** | `zoom-reset` | Reset active webview content zoom level to default 100% |
| **Ctrl + Shift + I** | `toggle-devtools` | Opens Chromium DevTools in a dedicated window |
| **F12** | `toggle-devtools` | Secondary shortcut for DevTools |

---

## Modal Navigation (NORMAL Mode)

When viewing web content without an active text field or prompt, Mise operates in **NORMAL Mode**, allowing Vim-style single-key navigation without modifier chords (all listed directly within the in-app Preferences overlay under **Help & Shortcut Reference**):

| Key | Description |
| :--- | :--- |
| `j` / `k` | Scroll down / up (80px) |
| `d` | Toggle Dark Reader on active tab |
| `u` | Half-page scroll up |
| `h` / `l` | Scroll left / right (80px) |
| `gg` | Jump to top of page |
| `G` | Jump to bottom of page |
| `t` | Open new tab |
| `x` | Close current tab |
| `o` | Focus status bar address bar |
| `r` / `R` | Reload / Force reload current tab |
| `H` / `L` | History back / History forward |
| `/` | In-page text search |
| `n` | Find next match |
| `N` | Find previous match |
| `f` | Trigger Link Hints overlay |
| `gh` | Trigger Ephemeral Tab Peek (Glance) hints to preview link |
| `e` | Toggle Native Reader View |
| `m` | Toggle audio mute on active tab |
| `M` | Toggle audio mute globally across all tabs |
| `p` | Toggle pinned status on active tab |
| `w` | Open Workspace Dashboard |
| `s` | Focus sidebar tab list |
| `y` | Copy current page URL to clipboard |
| `?` | Open Preferences and Settings overlay |
| `i` | Enter INSERT mode |
| `Escape` | Blur active input field and return to NORMAL mode |
| `Shift + Escape` | Toggle PASSTHROUGH mode (sends raw keys to web applications) |

### Sidebar Navigation Mode (`Ctrl + Tab` or `s`)

When keyboard focus is inside the sidebar tab list:

| Key | Description |
| :--- | :--- |
| `1` - `9` | Jump directly to tab 1 through 9 (waking only that specific tab) |
| `j` / `k` or `↓` / `↑` | Move visual cursor outline through tabs without waking hibernated tabs |
| `Enter` / `Space` | Activate and wake the highlighted tab under the cursor |
| `l` / `→` | Activate the highlighted tab and return keyboard focus to the webview |
| `←` | Focus navigation action buttons |
| `x` | Close the tab under the cursor without waking it into memory |
| `y` | Copy the URL of the tab under the cursor to the clipboard |
| `Escape` | Dismiss expanded sidebar and return focus to the active webview |

---

## Notifications & Activity Overlay Navigation

When the Notifications & Activity overlay is active (`Ctrl + Shift + N` or clicking the sidebar bell):

| Key | Action |
| :--- | :--- |
| `←` / `→` or `h` / `l` | Cycle category filter chips (All, Downloads, System, Web) |
| `1` - `4` | Switch directly to category (1: All, 2: Downloads, 3: System, 4: Web) |
| `↓` / `↑` or `j` / `k` | Move cursor through activity items |
| `Enter` | Trigger primary action of highlighted item |
| `x` | Dismiss highlighted notification item |
| `c` | Clear notifications in the active view |
| `Tab` / `Shift + Tab` | Cycle focus between controls, category chips, and feed items |
| `Escape` | Dismiss overlay and restore focus to active webview |

---

## Task Manager Overlay Navigation

When the Task Manager (Tab Resource Inspector) overlay is active (`Ctrl + Shift + T`):

| Key | Action |
| :--- | :--- |
| `↓` / `↑` or `j` / `k` | Move cursor through open tabs across workspaces |
| `z` | Hibernate highlighted background tab immediately and compact memory |
| `Enter` | Jump directly to the highlighted tab (switching workspace if needed) |
| `x` | Close the highlighted tab (pinned tabs remain protected) |
| `r` | Refresh live CPU and memory metrics |
| `Tab` / `Shift + Tab` | Cycle focus across header controls (Hibernate All, Refresh, Close) |
| `Escape` | Dismiss overlay, stop polling, and restore focus to active webview |

---

## Actionable History Overlay Navigation

When the History overlay is active (`Ctrl + Shift + H`):

| Key | Action |
| :--- | :--- |
| `↓` / `↑` | Move selection cursor through matching history entries |
| `Enter` | Open the highlighted history entry in a new tab |
| `x` / `Delete` | Remove the highlighted history entry from `history.json` (`x` deletes when search is empty or after list navigation) |
| `Tab` / `Shift + Tab` | Cycle focus between the search input, Purge History button, and Close button |
| `Escape` | Dismiss overlay and restore focus to active webview |

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
  "focus-sidebar": "Ctrl+Shift+E",
  "focus-webview": "Ctrl+Shift+B",
  "trigger-hints": "Ctrl+F",
  "toggle-zen-mode": "F11"
}
```

- **Modifiers**: Use `Ctrl`, `Shift`, or `Meta` combined with `+` (avoid `Alt` to prevent conflicts with Linux tiling window managers).
- **Multiple Bindings**: Assign an array of strings to bind multiple shortcuts to the same action (e.g. `["Ctrl+W", "Ctrl+D"]`).
- **Reloading**: Customisations apply immediately upon restarting Mise, or automatically when modifying bindings via the internal configuration bridge.

### Unassigned Workspace Actions
These actions can be triggered via the Command Palette (`Ctrl + P`) or assigned custom chords in `keybinds.json`:
- `create-workspace`: Opens the workspace creation prompt to register a new container partition.
- `rename-workspace`: Renames the active container workspace and migrates its tabs.
- `delete-workspace`: Deletes the active container workspace after confirmation.
