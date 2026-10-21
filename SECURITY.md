# Security Policy

Mise Browser treats security as a core architectural foundation. This document outlines supported versions, release cadence, security architecture, and procedures for reporting vulnerabilities.

***

## 1. Supported Versions & Update Cadence

Security updates and critical patches are actively maintained for the latest stable release. Because Mise Browser operates on a continuous release cycle without legacy long-term support branches, security fixes are not backported to older releases.

Mise tracks upstream Electron and Chromium releases and audits dependencies twice weekly. Upstream Electron and Chromium security patches are evaluated, integrated, and released as soon as they become available. Each release announcement and tagged milestone explicitly lists its corresponding Electron and Chromium runtime versions.

| Version | Supported | Notes |
| :--- | :--- | :--- |
| **Latest stable release** | Yes | Actively maintained with upstream security updates and bug fixes |
| **Development (`main` branch)** | Best effort | Evaluated and resolved in upcoming releases |
| **Prior releases** | No | Unsupported; please upgrade to the latest release |

***

## 2. Reporting a Vulnerability

The maintainer appreciates the efforts of security researchers and users who report vulnerabilities responsibly:

* **Private Reporting:** Please do **not** report security vulnerabilities via public GitHub issues, discussions, or pull requests.
* **Preferred Channel:** Submit vulnerability disclosures privately via [GitHub Security Advisories](https://github.com/Rakosn1cek/Mise-browser/security/advisories/new).
* **Alternative Contact:** If GitHub Security Advisories are unavailable, contact the project maintainer directly via GitHub profile details.
* **Information to Include:**
  * Detailed description of the vulnerability and its potential impact.
  * Step-by-step reproduction instructions or a minimal proof of concept.
  * Operating system, architecture, and exact Mise Browser release version.
* **Response Timeline:** The maintainer aims to acknowledge reports within 48 hours and provide a remediation timeline within 7 calendar days.

***

## 3. Security Architecture & Threat Model

Mise Browser is designed with multiple defence-in-depth layers:

### A. Process Isolation & Sandbox Hardening
* **Context Isolation:** Strict context isolation (`contextIsolation: true`) ensures renderer scripts cannot access Node.js or Electron internal APIs directly.
* **Zero Node Integration in Webviews:** All `<webview>` elements run with `nodeIntegration: false`, `nodeIntegrationInSubFrames: false`, and `sandbox: true`.
* **Remote Module Disabled:** Electron's deprecated `enableRemoteModule` is strictly disabled across all windows and webviews.
* **Preload API Boundary:** Communication between web pages and the main process occurs exclusively through a minimal, vetted `contextBridge` whitelist in `preload.js`.
* **Main Shell Navigation Lock:** Top-level navigation of the main application window is strictly locked to the local `index.html` interface via `will-navigate` listeners. Any attempt to navigate the primary shell to external or remote URLs is cancelled, and unmanaged popup windows are denied unconditionally via `setWindowOpenHandler`.
* **Guest Webview Navigation & Scheme Guards:** Guest `<webview>` instances are monitored globally through `app.on('web-contents-created')`. Navigations are strictly limited by `will-navigate` and `new-window` handlers to safe protocols (`http:`, `https:`, `about:blank`, or bundled local assets). Dangerous schemes such as `file:`, `javascript:`, and unauthorised custom protocols are rejected.
* **Content Security Policy & Local Asset Bundling:** The application shell (`index.html`) enforces a strict Content Security Policy (`default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `font-src 'self' data:`, `object-src 'none'`, `base-uri 'none'`). All UI assets, stylesheets, and FontAwesome webfonts are bundled 100% locally in `assets/`, eliminating external CDN tracking, IP leakage, and network requests on launch.
* **Second-Instance Command Validation:** When secondary process invocations dispatch URLs from the command line, targets are strictly validated with `security.isSafeTabUrl(url)` before dispatching to tabs, guaranteeing parity with `open-url` handling and preventing external processes from injecting arbitrary local file paths or dangerous schemes.
* **Canonical PDF Viewer Preload Capability Scoping:** The privileged `__misePDFBridge` contextBridge API is granted exclusively to the genuine vendored viewer (`viewer.html`). Preload scripts query the canonical viewer URL from the main process and verify exact pathname equality, preventing downloaded or crafted local files from accessing PDF bridge methods.
* **Address Bar Local File Navigation Guard:** Direct local filesystem inputs in the address bar (`/` or `file://`) are strictly validated against `isPdfUrl`. Only genuine `.pdf` documents are permitted, mediating rendering through the offline vendored PDF viewer. Arbitrary local file access is rejected, preventing unmediated file browsing or script execution in webviews.
* **Transient Modal Lifecycle Teardown:** Modal webview containers (including the transient sharing modal) execute `destroyGuestWebview` prior to closing or replacing guest frames, ensuring audio streams are muted, abort controllers triggered, and the guest navigated to `about:blank` to prevent background render processes or resource leaks.
* **Update Check Safety & Failure Diagnostic Auditing:** The in-app update checker explicitly validates check responses for network errors, rate limits, or timeouts. Failed checks display descriptive failure notifications rather than misleading up-to-date notices, and record structured warning entries in local diagnostics logs (`miseAPI.logDiagnosticsEvent`) for transparent local auditing.

### B. Workspace Container Partitions
* Each workspace operates inside a dedicated, isolated Chromium session partition (`persist:mise_ws_<workspace>`).
* Partitions prevent cross-site and cross-workspace cookie leakage, keeping personal, work, and banking sessions completely segregated.

### C. Clipboard-Mediated Terminal Handshake & Optional Oversight Tool
* **Clipboard Boundary:** Mise never executes terminal commands or shell processes automatically in the background. When terminal actions or script executions are triggered, Mise copies the target command to the user's system clipboard and launches an empty, unmanaged external terminal emulator.
* **Clipboard Pastejacking Sanitisation:** Staged terminal commands dispatched via `execute-terminal-command` are sanitised through `security.sanitiseTerminalCommand`. All carriage returns (`\r`), line feeds (`\n`), and null bytes (`\0`) are stripped and replaced with spaces, and length is bounded to 4096 characters. This neutralises terminal pastejacking attacks where embedded or trailing newlines would otherwise execute commands automatically upon pasting.
* **Optional Oversight Scanner:** Active command scanning, heuristic script inspection, Shannon entropy checks, and interactive confirmation paging are provided exclusively by [Oversight](https://github.com/Rakosn1cek/oversight), an independent, optional external utility created by the same author.
* **Execution at User's Own Risk:** Oversight is not bundled with Mise. Without the standalone Oversight utility installed in the system PATH, commands staged on the clipboard are pasted and run by the user entirely at their own risk, without automated scanning, heuristic checks, or safety prompts.

### D. Permission Sandboxing
* Sensitive hardware capabilities (microphone, camera, geolocation, and MIDI) are denied by default.
* Web notifications require explicit user opt-in via the interface toggle button.

### E. Native Request Filtering
* Network requests are intercepted in-process via Ghostery's blocking engine before departing the local machine.
* Known malicious hosts, tracking scripts, and cryptominers are dropped at the network interceptor layer.

### F. Session & Data Storage Architecture
* **Transparent Plaintext User Data:** Configuration (`config.json`), keybindings (`keybinds.json`), workspaces (`session.json`), history (`history.json`), bookmarks (`bookmarks.json`), and notes (`notes.md`) are stored in transparent, human-readable JSON and Markdown files under `~/.config/mise-browser/`, protected by standard user-only filesystem permissions (`0600`/`0700`). Users retain full ownership to inspect, edit, or back up files using standard tools.
* **Path Traversal Containment:** Local filesystem integrations, including opening Markdown notes in external editors, enforce strict path resolution confined to the application configuration directory (`resolveSafeNotesPath`). File paths supplied by renderer IPC requests are stripped or rejected to prevent directory traversal.
* **Prototype Pollution Prevention:** Userscript key-value storage (`GM_setValue` and `GM_getValue`) operates on isolated, null-prototype dictionaries (`Object.create(null)`). Storage keys are validated against prototype pollution targets (`__proto__`, `constructor`, `prototype`), and persisted objects are sanitised before saving to disk.
* **Markdown Hyperlink Sanitisation:** The integrated notes scratchpad strictly validates Markdown hyperlinks (`[label](url)`) against safe web schemes (`http:` and `https:`). Dangerous schemes such as `file:`, `javascript:`, and `data:` are neutralised and rendered as plain text. The preview click handler verifies `isSafeTabUrl` before creating tabs.
* **Quickmark & Bookmark Jump Safety Validation:** Quickmark assignments and bookmark entries are strictly validated with `isSafeTabUrl` before being stored or dispatched to tabs via `spawnTabWithUrl`. Targets with disallowed protocols (such as `file:`, `javascript:`, `data:`, or malformed URLs) are rejected and return focus cleanly to the active webview, preventing arbitrary local file loading or unintended protocol execution through keyboard shortcuts or overlay clicks.
* **OS Keyring Cookie Encryption:** Persistent workspace partitions isolate cookies and web caches per container. Sensitive session tokens written by Chromium are encrypted at rest using `safeStorage`, which binds encryption keys directly to the host operating system's credential keyring (`libsecret` / GNOME Keyring / KWallet on Linux, Apple Keychain on macOS, and DPAPI on Windows).
* **Zero Cloud Synchronisation:** No remote telemetry, no cloud profile syncing, and zero analytics.
* **Surgical Cookie Clearing:** Dedicated cache controls allow wiping tracking tokens for specific domains without invalidating sessions in unrelated tabs.

### G. Credential & Password Management Philosophy
* **Zero Embedded Password Manager:** Mise intentionally excludes built-in password saving, autofill prompts, and credential vaults.
* **Elimination of Malware Targets:** Browser-bundled password vaults (such as Chromium's `Login Data` file) represent the primary attack target for infostealers and credential extraction malware. By omitting internal password storage entirely, Mise removes this high-value vulnerability surface.
* **User Autonomy & External Tools:** Users retain full discretion to employ their preferred dedicated password managers (such as Pass, KeePassXC, Bitwarden, or system keychains) outside the browser's execution perimeter.

***

## 4. Responsible Disclosure Commitment

In return for responsible disclosure, the project maintainer commits to:

* Working collaboratively with researchers to validate and resolve reported issues promptly.
* Crediting researchers in release notes and security advisories (unless anonymity is requested).
* Providing reasonable notice prior to public disclosure of vulnerabilities and fixes.
