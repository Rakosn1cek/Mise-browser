# Privacy & Trusted Sites

Mise is engineered to provide strong privacy defaults while ensuring that modern web applications, banking portals, and checkout flows work without artificial roadblocks.

---

## Native Tracker & Ad Blocking

Mise integrates an in-process network request blocker powered by Ghostery's block engine:

- Blocks known marketing trackers, advertising networks, and telemetry collectors natively before outbound network requests leave the browser.
- Operates at the network intercept layer, conserving CPU cycles and network bandwidth on slow or metered connections.
- Requires no external extensions or third-party web store plugins.

---

## Permanent Private Workspace (`Ctrl + Shift + P`)

For volatile browsing sessions where no trace should remain:

- Press **Ctrl + Shift + P** to switch directly to the permanent **Private** workspace (or return to your previous active workspace).
- All navigation inside the Private workspace routes through an isolated, in-memory partition (`MisePrivateProfile`).
- The canvas and sidebar apply a gentle Tokyo Night pale red background tint via CSS `color-mix`, giving clear visual feedback without harsh colours.
- Browsing history, remote favicon lookups, cookies, cache files, and web storage are completely omitted from disk writes and flushed when the browser exits.

---

## Fingerprint Protection & Farbling

Mise actively protects against passive browser fingerprinting:

- **User Agent Standardisation**: Strips internal Electron and Mise application tokens from HTTP headers and JavaScript `navigator` properties (`userAgent`, `appVersion`, and `userAgentData` client hints), matching a clean Chromium release. The one exception is Google's sign-in page (`accounts.google.com`), which receives Electron's own User-Agent, because Google refuses sign-in from the standardised profile.
- **Canvas & WebGL Farbling**: Applies subtle, imperceptible noise to Canvas data exports (`toDataURL`, `toBlob`, `getImageData`) and rotates WebGL extension order. Fingerprinting auditors such as EFF Cover Your Tracks recognise this as a randomised, non-trackable fingerprint.
- **Hardware Profile Masking**: Standardises `hardwareConcurrency` (8 cores), `deviceMemory` (8 GB), and WebGL unmasked vendor/renderer to a common Brave/Chromium baseline to blend into large anonymity pools.
- **Trusted Domains Exemption**: Any domain added to Trusted Sites automatically bypasses farbling, ensuring sensitive fraud-detection checks (like banking) see consistent device metrics.

---

## Trusted Sites (Online Banking & Shopping)

![Privacy and Trusted Sites Configuration](/screenshots/preferences-3.webp)

Modern online banks, Google authentication, and e-commerce sites (such as Amazon or checkout payment gateways) employ sophisticated anti-fraud algorithms. When a browser randomises fingerprints, alters user-agent client hints, or strips verification headers, fraud systems flag the session as suspicious and block logins or payments.

Mise resolves this through the **Trusted Sites** architecture:

- **Shield Indicator**: Every tab in the vertical sidebar features a shield button.
  - **Shield Active (Half Shield)**: Full protection, tracker blocking, and strict isolation are active.
  - **Shield Down (Full Shield)**: The domain is in your Trusted Sites list. Fraud detection signals are kept intact to ensure seamless logins and payment processing.
- **One-Click Whitelisting**: Click the shield icon in any sidebar tab to toggle trust status for that domain immediately. Mise updates your configuration and reloads the tab.
- **Managing Trusted Domains**: In Preferences (**F1** or **Ctrl + H**), open the **Trusted Sites** text area. Enter one domain per line (e.g. `amazon.co.uk`, `accounts.google.com`). All subdomains are covered automatically without requiring a browser restart.

---

## Granular Permission Vault & Sensor Lockdown

Mise provides a per-domain Permissions Vault that strictly isolates hardware sensor access:

* **Managed Sensors**: Controls camera, microphone, geolocation, notifications, and clipboard access.
* **Per-Domain Memory**: In standard workspaces, permissions granted or revoked are remembered on a per-domain basis in `~/.config/mise-browser/permissions.json` using atomic file writes.
* **Interactive Status Bar Popover**: Click the permission shield icon in the status bar to view all sensor privileges for the active domain and toggle them on the fly.
* **Vault Management in Preferences**: Open **Preferences** (**F1** or **Ctrl + H**) and navigate to **Permissions Vault** to search, inspect, or revoke domain permissions individually or perform a complete reset.
* **Zero-Trust Private Profile**: When browsing in the Private workspace (`MisePrivateProfile`), an unconditional Zero-Trust policy applies. All sensor requests are rejected immediately to guarantee zero identity leakage or physical environment fingerprinting.

---

## WebRTC Leak Protection & IP Handling

Web Real-Time Communication (WebRTC) can inadvertently expose your local network IP address or bypass VPN tunnels through STUN and ICE candidate harvesting. Mise provides granular policy controls to protect your origin identity:

* **Balanced (`default_public_interface_only` - Default)**: WebRTC uses the default public network interface only. It eliminates private LAN IP disclosure while maintaining full compatibility with web conferencing tools (Google Meet, Discord, Zoom).
* **Strict / Proxy Safe (`disable_non_proxied_udp`)**: Disables non-proxied UDP bindings, forcing WebRTC media traffic strictly through your configured proxy or VPN tunnel.
* **Disabled (`disable`)**: Completely disables WebRTC peer connections inside webviews.
* **Permissive (`default_public_and_private_interfaces`)**: Standard Chromium behaviour without interface filtering.

You can adjust the active policy in Preferences under **Privacy & Protection**, or toggle protection on the fly using the Command Palette (**Ctrl + P**).

---

## Active Site Data Clearing

When debugging web applications or purging lingering sessions:

1. Open **Preferences** (**F1** or **Ctrl + H**) and navigate to **Privacy & Protection**.
2. **Clear Site Cookies**: Surgically deletes cookies specifically matching the active tab's domain without logging you out of unrelated sites in other tabs.
3. **Clear Cache**: Flushes the local Chromium disk and memory cache.

---

## DNS-over-HTTPS (DoH) Selector

Mise Browser provides an optional client-side DNS-over-HTTPS (DoH) selector to encrypt domain name resolution requests against local network eavesdropping and ISP inspection.

### Configuration & Placement

The DoH selector is located exclusively within the Preferences overlay under **Privacy & Protection** (**F1** or **Ctrl + H**). To preserve an uncluttered interface and avoid accidental switching, it is deliberately excluded from the Command Palette, status bar, and keyboard shortcuts.

### Supported Resolvers

* **System Resolver (Default / Off):** Relies on standard operating system network name resolution out of the box. No external HTTPS DNS tunnels are established.
* **Quad9 (`quad9`):** Routes encrypted queries to `https://dns.quad9.net/dns-query`. Operated by a non-profit foundation in Switzerland with integrated threat intelligence blocking.
* **Mullvad (`mullvad`):** Routes encrypted queries to `https://dns.mullvad.net/dns-query`. Adheres to strict Swedish privacy laws with zero logging.
* **Cloudflare (`cloudflare`):** Routes encrypted queries to `https://cloudflare-dns.com/dns-query` (1.1.1.1) for high-performance global anycast resolution.
* **Custom HTTPS Resolver (`custom`):** Enables a custom input field allowing you to specify any trusted DoH endpoint template (e.g. `https://dns.example.com/dns-query`). The URL must strictly use the `https://` scheme and remain within 512 characters. If an invalid or non-HTTPS URL is supplied, Mise safely falls back to standard system resolution.

> [!WARNING] Operational Security Advisory
> When DoH is enabled, domain lookups travel directly to the chosen provider and are subject to their independent terms and privacy policy. While DoH protects lookups against local ISP monitoring, it does not guarantee anonymity, cloak your origin IP address, or prevent Server Name Indication (SNI) inspection unless the destination host supports Encrypted Client Hello (ECH). Use is at your sole discretion and risk.

***

## Zero Remote Asset Leakage & Bundled Dependencies

Mise guarantees complete network silence on startup:

- **Local Asset Bundling**: All icons, stylesheets, and webfonts are bundled locally inside the application package. No third-party CDN connections (such as Cloudflare or Google Fonts) are initiated when opening the browser.
- **Strict Content Security Policy**: The application shell enforces a strict Content Security Policy (`default-src 'self'`, `form-action 'none'`), blocking unauthorised external script, style, form submission, or object injections.
