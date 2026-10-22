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
- **Visual Overview**: Displays every workspace, highlighting the currently active workspace, along with the title and status of every tab.
- **Tree Navigation**: Use the **Up** and **Down** arrow keys to traverse workspaces and tabs, and press **Enter** to jump directly to any tab.
- **Workspace Creation**: Click the **+ New Workspace** button or use the input prompt to create a new isolated container workspace.
- **Workspace Renaming**: Double-click any workspace header to edit its name inline.
- **Drag-and-Drop Organization**:
  - Reorder tabs within a workspace by dragging them up or down.
  - Move tabs between different workspaces by dragging a tab item and dropping it onto another workspace node. When moved across workspaces, the tab automatically adapts to the target container partition.
- **Tab & Workspace Deletion**: Press **Delete** or **Ctrl + W** on any highlighted node in the dashboard tree to close tabs or remove an empty workspace.

---

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
