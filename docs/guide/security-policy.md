# Security Policy

Mise Browser treats security as a core architectural foundation. This document outlines our supported versions, release cadence, security architecture, and procedures for reporting vulnerabilities.

---

## Supported Versions & Update Cadence

Security updates and critical patches are actively maintained for the latest stable release. Because Mise Browser operates on a continuous release cycle without legacy long-term support branches, security fixes are not backported to older releases.

Mise tracks upstream Electron and Chromium releases and audits dependencies twice weekly. Upstream Electron and Chromium security patches are evaluated, integrated, and released as soon as they become available. Each release announcement and tagged milestone explicitly lists its corresponding Electron and Chromium runtime versions.

| Version | Supported | Notes |
| :--- | :--- | :--- |
| **Latest stable release** | Yes | Actively maintained with upstream security updates and bug fixes |
| **Development (`main` branch)** | Best effort | Evaluated and resolved in upcoming releases |
| **Prior releases** | No | Unsupported; please upgrade to the latest release |

---

## Reporting a Vulnerability

We appreciate the efforts of security researchers and users who report vulnerabilities responsibly:

* **Private Reporting:** Please do **not** report security vulnerabilities via public GitHub issues, discussions, or pull requests.
* **Preferred Channel:** Submit vulnerability disclosures privately via [GitHub Security Advisories](https://github.com/Rakosn1cek/Mise-browser/security/advisories/new).
* **Alternative Contact:** If GitHub Security Advisories are unavailable, contact the project maintainer directly via GitHub profile details.
* **Information to Include:**
  * Detailed description of the vulnerability and its potential impact.
  * Step-by-step reproduction instructions or a minimal proof of concept.
  * Operating system, architecture, and exact Mise Browser release version.
* **Response Timeline:** We aim to acknowledge reports within 48 hours and provide a remediation timeline within 7 calendar days.

---

## Security Architecture & Threat Model

Mise Browser is designed with multiple defence-in-depth layers:

### Process Isolation & Sandbox Hardening
* **Context Isolation:** Strict context isolation (`contextIsolation: true`) ensures renderer scripts cannot access Node.js or Electron internal APIs directly.
* **Zero Node Integration in Webviews:** All `<webview>` elements run with `nodeIntegration: false`, `nodeIntegrationInSubFrames: false`, and `sandbox: true`.
* **Remote Module Disabled:** Electron's deprecated `enableRemoteModule` is strictly disabled across all windows and webviews.
* **Preload API Boundary:** Communication between web pages and the main process occurs exclusively through a minimal, vetted `contextBridge` whitelist in `preload.js`.

### Workspace Container Partitions
* Each workspace operates inside a dedicated, isolated Chromium session partition (`persist:mise_ws_<workspace>`).
* Partitions prevent cross-site and cross-workspace cookie leakage, keeping personal, work, and banking sessions completely segregated.

### Clipboard-Mediated Terminal Oversight
* Web pages or scripts attempting to trigger shell commands encounter a clipboard-mediated oversight boundary.
* Rather than spawning external shell processes automatically, Mise sanitises and stages vetted commands onto your system clipboard for deliberate user review and execution in an external terminal.

### Permission Sandboxing
* Sensitive hardware capabilities (microphone, camera, geolocation, and MIDI) are denied by default.
* Web notifications require explicit user opt-in via the interface toggle button.

### Native Request Filtering
* Network requests are intercepted in-process via Ghostery's blocking engine before departing the local machine.
* Known malicious hosts, tracking scripts, and cryptominers are dropped at the network interceptor layer.

### Session & Data Storage
* Session cookies and partition states are flushed to disk via Electron's cookie store prior to tab hibernation or workspace switching.
* Browsing history and bookmarks reside in local SQLite databases under standard user-only filesystem permissions (`0600`), without remote cloud synchronisation or telemetry transmission.
* Surgical cookie clearing allows wiping tracking tokens for specific domains without invalidating sessions in unrelated tabs.

---

## Responsible Disclosure Commitment

In return for responsible disclosure, project maintainers commit to:

* Working collaboratively with researchers to validate and resolve reported issues promptly.
* Crediting researchers in release notes and security advisories (unless anonymity is requested).
* Providing reasonable notice prior to public disclosure of vulnerabilities and fixes.
