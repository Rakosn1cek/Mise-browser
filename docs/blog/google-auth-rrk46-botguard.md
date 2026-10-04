# The Google Auth Botguard Saga: The rrk=46 Riddle and Poisoned Cookies

How an attempt to sign into Gmail in an isolated container led down a rabbit hole of Botguard detection, User-Agent traps, and self-perpetuating cookie poisoning.

---

## 1. The Problem

Mise Browser provides multi-partition workspaces, allowing users to run separate, isolated containers for Work, Personal, and Mail without session leakage or shared cookies. However, navigating to Gmail or Google Workspace inside an isolated partition produced an immediate stop sign:

> **Couldn't sign you in**  
> This browser or app may not be secure. Learn more.

Inspecting the URL parameters revealed the rejection token: `rrk=46`. The login flow refused to present a password field, and no amount of refreshing or re-entering credentials allowed the user to proceed.

---

## 2. The Solution (First Attempt)

The standard diagnosis across Chromium and Electron development when encountering Google rejection is User-Agent filtering. Chromium runtimes embedded inside `<webview>` containers carry runtime tokens that Google's login portal flags.

The initial fix appeared straightforward:
1. Override `app.userAgentFallback` with a clean, standard Chrome desktop User-Agent string.
2. Strip Electron and application tokens from outgoing request headers.
3. Enable privacy shields in `webview-preload.js` to farble hardware concurrency and canvas fingerprints.

The hypothesis was simple: make the browser appear as an ordinary desktop Chrome instance.

---

## 3. The Bug / The Fail

The initial approach failed spectacularly and actually made the lock-out far worse.

### Trap 1: The GlifWebSignIn Route & Botguard Detection
When Google receives requests carrying synthetic or altered User-Agent tokens, its edge routers automatically route the session into `flowName=GlifWebSignIn` (the full single-sign-on client). This flow executes **Botguard**, Google's proprietary anti-bot JavaScript payload.

Botguard performs runtime platform validation. Because an embedded `<webview>` runtime lacks proprietary Chrome platform components and extensions, Botguard flags the environment as an automated bot and instantly serves `rrk=46`. Furthermore, the privacy shield farbling prototype values on `navigator` triggered additional heuristic alarms.

```text
Synthetic User-Agent -> Routed to GlifWebSignIn -> Botguard runs -> Platform checks fail -> rrk=46
```

### Trap 2: Session Cookie Poisoning
The most baffling part of the failure was its persistence. Once an `rrk=46` rejection occurred, subsequent attempts to log in would instantly fail, even if User-Agent spoofing was disabled.

Google writes secure `__Host-GAPS` and `OTZ` cookies to the partition storage upon serving a rejection page. Every subsequent navigation to `accounts.google.com` sent those poisoned tokens back to the server. Google saw the poisoned cookies and immediately short-circuited the request back to the rejection screen before any login script even executed.

---

## 4. The Fix

The fix required understanding how Google treats embedded environments and eliminating the root triggers across three fronts:

### A. Transparent Flow Rewriting
Google maintains a lightweight authentication flow designed specifically for embedded runtimes and lower-friction logins: `flowName=WebLiteSignIn`.

Instead of fighting Botguard, Mise intercepts incoming authentication requests in `security.js` before they leave the browser and rewrites the query parameter:

```javascript
// Route Google authentication requests through the lightweight sign-in flow
if (targetSession.webRequest && typeof targetSession.webRequest.onBeforeRequest === 'function') {
    targetSession.webRequest.onBeforeRequest({ urls: ['*://accounts.google.com/*'] }, (details, callback) => {
        const url = details.url || '';
        if (url.includes('flowName=GlifWebSignIn')) {
            const redirectedUrl = url.replaceAll('flowName=GlifWebSignIn', 'flowName=WebLiteSignIn');
            return callback({ redirectURL: redirectedUrl });
        }
        callback({});
    });
}
```

### B. Baseline Runtime Preservation
Synthetic User-Agent spoofing was completely eliminated for trusted authentication endpoints:

```javascript
// Keep unmodified headers on trusted authentication domains
if (isTrustedDomain(hostname)) {
    return callback({ requestHeaders: details.requestHeaders });
}
```

Google authentication endpoints were added to the `isTrustedDomain` allowlist. Fingerprint spoofing and privacy farbling in `webview-preload.js` bypass these domains, ensuring genuine browser attributes are visible to Google's sign-in engine.

### C. Automated Cookie Detox
To prevent permanent partition lockouts, an automated cookie cleanup handler was introduced. If a partition ever encounters an authentication rejection, cached `__Host-GAPS` and `OTZ` cookies are immediately purged from partition storage, keeping the container clean for subsequent attempts:

```javascript
// In main.js: detect rejection navigation and trigger detox
webContents.on('did-navigate', (navEvent, url) => {
    logVisit(webContents.getTitle(), url);
    if (url && url.includes('accounts.google.com') && url.includes('signin/rejected')) {
        security.clearGoogleAuthCookies(webContents.session);
    }
});
```

The underlying cookie cleanup routine surgically strips all poisoned host tokens:

```javascript
// In security.js: clean poisoned Google tokens
async function clearGoogleAuthCookies(targetSession) {
    if (!targetSession || !targetSession.cookies) return;
    try {
        const domains = ['google.com', 'accounts.google.com', 'mail.google.com'];
        for (const dom of domains) {
            const cookies = await targetSession.cookies.get({ domain: dom });
            for (const c of cookies) {
                if (c.name.startsWith('__Host-') || c.name === 'OTZ' || c.name === 'NID' || c.name.startsWith('__Secure-')) {
                    const scheme = c.secure ? 'https://' : 'http://';
                    const cookieUrl = scheme + c.domain.replace(/^\./, '') + c.path;
                    await targetSession.cookies.remove(cookieUrl, c.name);
                }
            }
        }
    } catch (e) {}
}
```

---

## Architectural Takeaway

When building privacy-focused browsers, more spoofing is often counterproductive against sophisticated anti-bot systems. Rather than masking identities with synthetic fingerprints, routing to native lightweight interfaces (`WebLiteSignIn`), maintaining pristine baseline headers on trusted domains, and proactively eliminating poisoned state cookies yields a clean and reliable sign-in experience.
