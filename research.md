To build an independent browser that competes directly with Zen, Qutebrowser, Min, and Vieb, the architecture must solve their individual trade-offs. Zen has great spatial workflow and modern aesthetics, but relies heavily on the full Firefox UI surface. Qutebrowser has pure keyboard efficiency, but its QtWebEngine foundation lacks container isolation and modern multi-tiling ergonomics. Min is lightweight and clutter-free, but lacks keyboard modal power. Vieb nails Vim key fidelity, but its Electron runtime incurs noticeable memory overhead and IPC latency.

Eliminating third-party extensions as a hard requirement simplifies security, but it places the entire burden of user utility onto native, out-of-the-box subsystems. People use extensions primarily for four reasons: content blocking, password handling, styling or dark mode, and workflow automation. If those are implemented as first-party features, the lack of an extension store becomes an asset rather than a liability.

### Visual Architecture and UI Layout

The interface should adopt a zero-chrome philosophy where every pixel is dedicated to content unless actively queried.

1. **Auto-Hiding Vertical Strip:**
Horizontal tab strips waste vertical viewing area on 16:9 and 16:10 screens. Implement an auto-collapsible vertical bar on the left edge. In collapsed state, it renders only subtle favicons or workspace markers (around 36px wide). When hovered, focused by a keybind, or during tab switching, it smoothly expands to show tab titles, audio indicators, and task hierarchies.
2. **Native Split Tiling:**
Do not rely on an external window manager to tile views; internal tiling preserves state, allows synchronized scrolling, and shares memory contexts. Support directional internal splitting (horizontal and vertical panes) navigable with standard spatial keys (`h, j, k, l` or arrow binds).
3. **Floating Omni-Palette:**
Eliminate persistent URL bars, bookmark toolbars, and search boxes. A centered, floating command palette (accessible via `o` for open, `b` for buffers/tabs, or standard hotkeys) handles URL entry, full-text history search, fuzzy search through active tabs, and command execution. It appears instantly over the content and disappears as soon as navigation begins.
4. **Status and Mode Bar:**
A thin 18px to 22px bar at the bottom displaying current mode (Normal, Insert, Hint, Passthrough), link hover targets, TLS encryption status, and zoom level. In full-focus mode, this can auto-hide entirely.

---

### Core Native Feature Set

Without extension support, the core binary must ship with essential modern web tooling built into the engine's network and rendering pipeline.

#### High-Performance Native Content Blocker

Third-party ad-blockers are the primary vector users miss when extensions are stripped. Integrate a network-level rule matching engine (using compiled EasyList, AdGuard, and uBlock rule formats directly in native code). Because this operates inside the browser's raw network stack rather than over an extension API bridge, request evaluation occurs with virtually zero IPC latency.

#### Contextual Workspaces and Network Containers

Take the container concept from Firefox and Vieb and make it foundational:

* Workspaces divide active sessions into isolated context graphs (e.g., Work, Personal, Research).
* Each workspace or specific tab can be assigned to an isolated Cookie Jar / Storage Container, ensuring complete session separation across different accounts on the same domain without launching separate browser instances.

#### First-Class Modal Navigation and Hinting

Keyboard driving must run synchronously within the browser's input handling layer, not injected via post-load DOM scripts that break when a page's JavaScript thread locks up:

* **Link Hinting:** Pressing `f` overlays two-character alphanumeric or home-row hints across clickable targets, inputs, and media elements.
* **Modal Separation:** Clear distinction between Normal mode (page navigation, scrolling, splits, tab actions) and Insert mode (typing into form inputs).
* **Caret and Passthrough Modes:** A mode to select and copy text purely via keys, and a raw pass-through mode for complex web applications (e.g., remote desktops, web terminals) that require every raw keystroke.

#### Native Reader and Local Dark Mode Engine

* An in-engine DOM distiller that strips scripts, tracking pixels, and layout clutter down to pure typography for long-form reading.
* A native shader or CSS inversion engine that generates high-contrast dark modes for sites lacking them, without needing extensions like Dark Reader.

#### Unix Pipeline and Process Integration

Power users choose Qutebrowser because it talks to the host OS. Support native external spawners and piping via plain-text IPC:

* Pipe video URLs directly to external media players (`mpv`) with a keystroke to bypass browser media decoding overhead.
* Support piping the current URL or DOM selection into local shell scripts, clipboard daemons, or note vaults.
* Allow external control via a local Unix domain socket (supporting actions like query tab count, navigate URL, close pane).

---

### Configuration and Scriptability

Without untrusted browser plugins, extensibility must be handled via deterministic configuration files and tightly scoped user scripts:

* **Single Plain-Text Config:** Follow standard XDG directory structure (`~/.config/yourbrowser/config.lua` or a simple key-value `rc` syntax). Allow every keybinding, UI color, default search engine, and network flag to be declared declaratively.
* **Granular Site Permissions:** A flat file or database defining per-domain security toggles (JavaScript enabled/disabled, WebRTC leak protection, local storage persistence, clipboard access).
* **Local User-Scripts (Greasemonkey-style):** Allow users to place plain `.js` or `.css` files into a specific directory, executed locally in a sandboxed context without giving permissions to external marketplaces.

---

### Architectural Blueprint

| Layer | Recommended Choice | Rationale |
| --- | --- | --- |
| **Engine / Runtime** | Native WebKit or Chromium embedding (via Rust/C++) | Avoid Electron to keep memory footprint under 200MB at idle; avoid running a full Node.js runtime inside the UI layer. |
| **UI Toolkit** | Wayland/X11-native lightweight GUI (e.g., GTK4 or Skia/wgpu direct render) | Ensures instantaneous startup, native subpixel rendering, zero compositor lag, and fractional scaling support. |
| **Blocking Core** | Native Rust-based content blocker (`adblock-rust` or similar) | Sub-millisecond URL filtering directly inside the resource load interceptor. |
| **IPC & Storage** | SQLite + Local Unix Domain Socket | High-speed history/bookmark indexing with full-text search (`FTS5`), plus headless command control from external scripts. |

By pairing Zen's spatial layout and container workspaces with the keyboard-first speed of Qutebrowser and Vieb—while executing it inside a lean, native compiled binary without extension overhead—the browser targets users who value speed, privacy, and distraction-free operation.
