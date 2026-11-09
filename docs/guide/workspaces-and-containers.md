# Workspaces & Container Partitions

Mise introduces Firefox Container-style isolation combined with a fluid workspace tree.

Traditional browsers store cookies, localStorage, and credentials in a single shared profile, making it difficult to maintain multiple logins to the same service (e.g. personal and work GitHub or Google accounts) without relying on separate windows or private browsing sessions.

---

## Multi-Account Container Partitions

In Mise, every workspace is automatically assigned its own dedicated, persistent Electron container partition:

- A workspace named `Work` runs inside partition `persist:work`.
- A workspace named `Personal` runs inside partition `persist:personal`.
- A workspace named `Cloud Dev` runs inside partition `persist:cloud-dev`.

### What This Enables:

1. **Simultaneous Account Logins**: Remain signed into different accounts on Google, GitHub, AWS, or Slack in separate workspaces without cross-contamination.
2. **Strict Cookie Isolation**: Third-party cookies and tracking beacons in one workspace cannot read session data from another workspace.
3. **Persistent State**: Unlike private browsing, container partitions persist across reboots, so you do not need to sign in every time you launch the browser.
4. **Automatic Migration**: Renaming a workspace automatically migrates tabs while maintaining safety and isolation.

---

## The Permanent Private Workspace (`Ctrl + Shift + P`)

Alongside your persistent workspaces, Mise includes a dedicated, permanent **Private** workspace:

- **Strict Volatile Isolation**: The `Private` workspace is bound directly to the volatile Chromium partition `MisePrivateProfile`. Cookies, web storage, and cache are kept strictly in memory and discarded upon exit.
- **Pinned Dashboard Placement**: In the Workspace Dashboard (`Ctrl + Shift + W`), the `Private` workspace is pinned to the top of the tree, badged with a shield icon and protected from accidental deletion or renaming.
- **Visual Identity**: The active private workspace applies a subtle Tokyo Night rose background tint via CSS `color-mix` across the canvas and sidebar, providing immediate visual feedback without bright or jarring colours.
- **Zero Disk Footprint**: When `session.json` is flushed to disk, the `Private` workspace and all associated tab URLs, titles, and sleep states are completely filtered out.
- **Reserved System Namespace**: Names matching `private` (case-insensitive) are strictly reserved. Attempting to create or rename a persistent workspace to any variation of `private` is rejected to eliminate partition collisions.
- **Legacy Session Migration**: When upgrading from pre-refactor releases of Mise where a persistent workspace was named "Private", Mise automatically migrates those tabs and metadata to "Private (old)" during session ingestion, guaranteeing that user tabs are never lost.
- **Instant Keyboard Toggle**: Press **Ctrl + Shift + P** at any moment to switch directly into the Private workspace, or return to your previous active workspace when pressed again.

---

## The Workspace Dashboard (`Ctrl + Shift + W`)

The Workspace Dashboard provides a structural tree view of all open tabs across your entire session:

![Mise Browser Workspace Dashboard](/screenshots/workspace-dashboard.webp)

- Press **Ctrl + Shift + W** to open or close the Dashboard.
- **Visual Overview**: Displays every workspace, highlighting the currently active workspace, along with the title, pinned state, and sleeping status of every tab.
- **Tree Navigation & Selection Anchoring**: Use the **Up** and **Down** arrow keys to traverse workspaces and tabs, and press **Enter** to jump directly to any tab. Opening or rebuilding the tree automatically anchors selection to the active workspace.
- **Container Partition Status & Live Cookie Counts**: Every workspace header displays its discrete Chromium container partition tag (such as `persist:work` or `volatile`) alongside a real-time stored cookie count (e.g. `34 cookies`). For the permanent Private Profile, the badge confirms volatile in-memory isolation (`0 cookies`), proving that tracking state is never committed to disk.
- **Surgical Workspace Cookie Purging**: Click the cookie purge icon button in any workspace header to wipe all stored cookies within that container partition. An explicit confirmation dialogue guards against accidental session sign-outs. This enables users to clean up accumulated trackers or fix corrupted login states in one workspace while preserving essential logins in all other containers.
- **Focus Release & Arrow Navigation Contracts**: After confirming or cancelling a cookie purge, DOM focus immediately releases from the button and returns to `#DashboardOverlay`. Navigating the virtual tree with arrow keys automatically clears any lingering button focus, ensuring that pressing **Enter** cleanly activates the selected tab.
- **Focus Trapping & Action Delegation**: Pressing **Tab** cycles keyboard focus smoothly through interactive action buttons (`+ New Workspace`, Rename, Purge Cookies, and Delete). Pressing **Enter** while focused on an action button triggers that button directly without inadvertently activating the virtual tree cursor.
- **Automatic Focus Restoration**: Focus returns automatically to `#DashboardOverlay` after tree rebuilds, prompt dismissals, or deletions, ensuring arrow navigation remains active without requiring mouse clicks.
- **Workspace Creation**: Click the **+ New Workspace** button, press Enter on the button, or run **Create New Workspace** in the Command Palette to register a new isolated container partition.
- **Workspace Visual Identity & Palette Customisation**: In the workspace creation dialogue, select an accent colour from the curated Tokyo Night swatches or enter a custom hex code, and assign an optional single-character glyph or emoji badge. Existing workspaces can be customised at any time by clicking the dedicated palette icon button in the workspace tree row.
- **Workspace Renaming**: Click the rename icon button, double-click a workspace header, or trigger **Rename Active Workspace** in the Command Palette.
- **Safe Workspace Deletion**:
  - The `Private` workspace and the final persistent workspace are strictly protected from deletion.
  - Workspaces containing open tabs prompt for explicit confirmation before deletion.
  - Deleting the active workspace automatically shifts the session to an adjacent surviving workspace without interrupting active windows.
  - Workspace deletion can be triggered from the dedicated trash icon button or via **Delete Active Workspace** in the Command Palette.
- **Drag-and-Drop Organisation**:
  - Reorder tabs within a workspace by dragging them up or down.
  - Move tabs between different workspaces by dragging a tab item and dropping it onto another workspace node. When moved across workspaces, the tab automatically adapts to the target container partition.
- **Tab Deletion**: Press **Delete** or **Ctrl + W** on any highlighted tab node in the dashboard tree to close it immediately.

***

## Workspace Visual Identity (Accent Colours & Glyph Badges)

To distinguish container profiles instantly in the vertical sidebar, each workspace can be customised with a distinctive accent colour and a single-character glyph badge:

- **Sidebar Badge Customisation**: The 28x28px `#WorkspaceBadge` in the sidebar immediately adopts the custom glyph (e.g. `1`, `W`, `💼`, `★`, `⚡`) and accent colour, tinting its border, text, and translucent background.
- **Immediate Peripheral Feedback**: Even in the auto-collapsed 36px sidebar strip, the custom badge gives immediate peripheral visual feedback on which container context is active, preventing accidental cross-context actions.
- **Status Bar Container Sync**: The bottom status bar's container partition indicator (`#StatusBarPartition`) automatically inherits the active workspace's accent border and displays its glyph, providing redundant peripheral context.
- **Tokyo Night Harmonious Palette**: Choose from 9 curated Tokyo Night palette swatches or input a custom hex code:

| Swatch Name | Hex Code | Ideal Container Use Case |
| :- | :- | :- |
| **Tokyo Blue** | `#7aa2f7` | Default persistent workspaces and general browsing |
| **Cyan** | `#7dcfff` | Technical documentation, research, and API consoles |
| **Emerald Green** | `#9ece6a` | Financial portals, banking, and online commerce |
| **Amber Orange** | `#ff9e64` | Development, staging, and local web servers |
| **Lavender Purple**| `#bb9af7` | Media, streaming, music, and entertainment |
| **Magenta Rose** | `#f7768e` | Reserved for the permanent volatile Private Profile |
| **Teal** | `#2ac3de` | Communications, Slack, Discord, and Matrix chat |
| **Warm Yellow** | `#e0af68` | Observability, metrics, log portals, and monitoring |
| **Silver Storm** | `#a9b1d6` | Administrative utilities, email, and scratch containers |

### Configuring Visual Identity in the Dashboard

Visual identity is configured directly within the Workspace Dashboard (`Ctrl + Shift + W`):

1. **During Workspace Creation**: Click **+ New Workspace** (or press Enter on the button). In addition to entering a workspace name, pick any colour from the swatch row (or type a custom 3-digit or 6-digit hex code) and optionally specify a single-character glyph or emoji.
2. **Editing Existing Workspaces**: Every persistent workspace node in the dashboard tree features a dedicated palette icon button (`<i class="fa-solid fa-palette"></i>`). Clicking this button opens the visual identity editor with current values pre-populated. Press **Tab** to navigate between fields, pick an accent colour, and press **Enter** to apply changes instantly across the interface.
3. **Keyboard Ergonomics**: Press **Escape** at any time to cancel changes without modifying container state.

### Security and Privacy Safeguards

- **Strict Colour Sanitisation**: Custom hex values are validated against `/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/`. Arbitrary CSS injections, `url(...)` declarations, or JavaScript schemes are rejected outright with fallback to Tokyo Blue.
- **Single Grapheme Cluster Bounds**: Glyphs are normalised via `NFC`, stripped of control codes (`\u0000` to `\u001F`, `\u007F` to `\u009F`) and bidirectional override characters (`\u202A` to `\u202E`, `\u2066` to `\u2069`), and strictly bounded to one visual grapheme cluster using native `Intl.Segmenter`.
- **Zero-Trust XSS Protection**: Glyphs are inserted exclusively via `element.textContent`, preventing DOM injection attacks.
- **Private Profile Immunity**: The permanent `Private` profile (`MisePrivateProfile`) retains an immutable rose accent (`#f7768e`) and shield badge. Persistent workspaces cannot override or spoof the private container's identity.
- **Zero External Network Leaks**: All glyphs and colours render locally using host system font stacks and CSS variables without external CDN or web font queries.

***

## Session Persistence & Snapshot Rotation

Your workspace layout, active tabs, titles, container assignments, and sleeping states are saved continuously to:

```text
~/.config/mise-browser/session.json
```

If the browser closes or restarts, your complete environment is restored exactly as you left it.

### Persistence Integrity & Backup Rotation

To protect your browsing session from crash corruption or transient navigation states:

- **Scheme Validation (`isPersistableTabUrl`)**: Only safe web and local file URLs (`http:`, `https:`, and `file:`) are written to session storage. Transient blank pages (`about:blank`) or error pages during mid-flight navigation are prevented from overwriting active tab state.
- **Suspect Blank Session Quarantine**: If a write payload contains an empty workspace tree or missing active tab definitions, Mise quarantines the suspect state to `session.suspect.json` rather than overwriting `session.json`, protecting your active tabs from corruption.
- **Non-Blank Backup Rotation**: The atomic backup file (`session.json.bak`) is updated solely on verified, non-blank session flushes.
- **Timestamped Recovery Snapshots**: Mise automatically creates timestamped session snapshots (`session.snap-YYYYMMDD-HHMMSS.json`), rate-limited to at most one snapshot per 10 minutes and retaining the 10 most recent snapshots for point-in-time recovery.
