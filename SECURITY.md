# Security Policy

Mise Browser treats security as a core architectural foundation. This document outlines our supported versions, security architecture, and procedures for reporting vulnerabilities.

---

## 1. Supported Versions

Security updates and critical patches are actively maintained for the following versions:

| Version | Supported | Notes |
| :--- | :--- | :--- |
| **0.8.x** | Yes | Current stable release line |
| **< 0.8.0** | No | Please upgrade to the latest release |

---

## 2. Reporting a Vulnerability

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

## 3. Security Architecture & Threat Model

Mise Browser is designed with multiple defence-in-depth layers:

### A. Process Isolation & Sandbox Hardening
* **Context Isolation:** Strict context isolation (`contextIsolation: true`) ensures renderer scripts cannot access Node.js or Electron internal APIs directly.
* **Zero Node Integration in Webviews:** All `<webview>` elements run with `nodeIntegration: false`, `nodeIntegrationInSubFrames: false`, and `sandbox: true`.
* **Remote Module Disabled:** Electron's deprecated `enableRemoteModule` is strictly disabled across all windows and webviews.
* **Preload API Boundary:** Communication between web pages and the main process occurs exclusively through a minimal, vetted `contextBridge` whitelist in `preload.js`.

### B. Workspace Container Partitions
* Each workspace operates inside a dedicated, isolated Chromium session partition (`persist:mise_ws_<workspace>`).
* Partitions prevent cross-site and cross-workspace cookie leakage, keeping personal, work, and banking sessions completely segregated.

### C. Air-Gapped Terminal Oversight
* Web pages attempting to trigger terminal commands or scripts encounter an air-gapped handshake.
* Rather than spawning shell processes automatically, Mise sanitises and copies commands to your system clipboard for deliberate inspection before execution.

### D. Permission Sandboxing
* Sensitive hardware capabilities (microphone, camera, geolocation, and MIDI) are denied by default.
* Web notifications require explicit user opt-in via the interface toggle button.

### E. Native Request Filtering
* Network requests are intercepted in-process via Ghostery's blocking engine before departing the local machine.
* Known malicious hosts, tracking scripts, and cryptominers are dropped at the network interceptor layer.

### F. Session & Cookie Sanitisation
* Session cookies and local storage tokens are flushed to encrypted disk stores prior to tab hibernation or workspace switching.
* Surgical cookie clearing allows wiping tracking tokens for specific domains without invalidating sessions in unrelated tabs.

---

## 4. Responsible Disclosure Commitment

In return for responsible disclosure, project maintainers commit to:

* Working collaboratively with researchers to validate and resolve reported issues promptly.
* Crediting researchers in release notes and security advisories (unless anonymity is requested).
* Providing reasonable notice prior to public disclosure of vulnerabilities and fixes.
