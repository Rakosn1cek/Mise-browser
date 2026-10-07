# The "Zero-RAM" Tab Hibernation Myth: Why Sleeping Tabs Still Cost 40-90MB

How chasing zero memory usage broke tabs with the `about:blank` amnesia trap, why Chromium partition sessions retain 40-90MB of RAM, and the pragmatic unmounting architecture that slashed memory bloat safely.

---

## 1. The Problem

I built Mise Browser specifically for fanless, low-resource Linux hardware. When you run an ultrabook or a fanless convertible on Arch Linux with Hyprland or sway, thermal budgets and physical memory are precious commodities.

Modern single-page applications are notorious resource gluttons:
* Discord and Slack routinely consume 350MB to 600MB of RAM each.
* Heavy documentation sites and Jira boards chew through 250MB to 400MB.
* Media feeds like Reddit or YouTube leak DOM nodes and keep graphics pipelines saturated.

In an ordinary browser session with fifteen to twenty open tabs distributed across separate workspace containers, memory consumption rapidly escalated past 3.5GB. On fanless hardware, this triggers a vicious cycle: physical RAM fills up, Linux begins swapping or invokes `systemd-oomd`, and background JavaScript timers keep the CPU spinning, causing the device to throttle its clocks down to minimum frequencies.

I needed background tabs to go to sleep. When a tab is not actively in view and has been idle for several minutes, it should relinquish its resources.

---

## 2. The First Attempt: Complete Hibernation via `about:blank`

My initial instinct was the textbook approach suggested across Electron discussion forums: when an inactive tab hits its timeout, instruct its `<webview>` to navigate away to `about:blank`.

The reasoning seemed sound:
1. Navigating to `about:blank` flushes the heavy DOM, destroys the guest JavaScript heap, and frees all decoded image textures.
2. The `<webview>` tag stays cleanly attached to the DOM tree, avoiding the overhead of re-creating custom element hosts and reconnecting IPC channels.
3. When the user clicks the tab again, re-navigate to the original URL.

I wired up a sleep scanner, tracked tab idle durations, and issued the navigation command:

```javascript
// The naive attempt: flush background guest tab to a blank page
function naiveHibernateTab(webview, originalUrl) {
    webview.setAttribute('data-hibernated-url', originalUrl);
    webview.loadURL('about:blank');
}
```

On paper, this looked like an elegant, zero-friction shortcut. In practice, it turned into an unmitigated disaster.

---

## 3. The Bug / The Disaster: Tab Amnesia and the `about:blank` Trap

The moment I deployed this logic across my daily browsing workflow, everything collapsed.

### The Navigation Event Storm

In Electron, `<webview>` instances are not passive iframes; they are out-of-process guest `WebContents` bound to main-process event pipelines. 

When you call `webview.loadURL('about:blank')`, Chromium triggers a full navigation lifecycle:
1. It fires `did-start-loading`.
2. It fires `did-navigate` with the destination URL set to `about:blank`.
3. It fires `page-title-updated` with an empty string or `"about:blank"`.

My browser state management in `renderer.js` listened for those very events to keep the tab titles and session files (`~/.config/mise-browser/session.json`) synchronised with the user's active browsing state.

The sleep scanner hibernated five inactive tabs. Within milliseconds, the event handlers fired:
* The real document titles in the sidebar were wiped and replaced with blank entries.
* The URLs stored in `state.sessionState.workspaces` were overwritten with `about:blank`.
* Before I could even switch back, the auto-save mechanism wrote the poisoned state to disk.

### The Recovery Nightmare

If the browser crashed or if I closed the window, my session was ruined. When I reopened Mise, every hibernated tab restored as an empty white canvas. The original links, documentation pages, and articles were permanently lost to `about:blank` amnesia.

To make matters worse, navigating to `about:blank` did not even solve the memory problem. Chromium still kept the guest renderer process alive for that frame, maintaining its baseline thread pool and V8 isolate. I had traded reliable tab recovery for an empty screen that still consumed 40MB to 60MB of RAM.

Recovering from that disaster was painful, and it proved that navigating live guest webviews to blank pages is fundamentally broken for stateful browsers.

---

## 4. The Second Attempt: DOM Unmounting and the "Zero-RAM" Illusion

Having learned my lesson, I changed architectural direction completely. Instead of mutating the URL of a live guest view, I decided to unmount the `<webview>` element from the DOM entirely.

Before touching the DOM, Mise inspects the live tab and extracts an exact state snapshot:
* **Current Live URL**: Capturing client-side redirects and hash routes.
* **Document Title**: Preserving the human-readable heading.
* **Precise Scroll Coordinates**: Querying `[window.scrollX, window.scrollY]`.
* **Session Storage**: Serialising `window.sessionStorage` keys into JSON.

Once the snapshot is safely recorded in `state.tabSleepStates`, the `<webview>` is detached:

```javascript
// Safely unmount dormant webview without polluting session state
webview.remove();
state.activeViewsCache[currentWS][idx] = null;
```

When the user selects the tab in the sidebar, Mise re-instantiates a fresh `<webview>` element, appends it to `#webview-container`, and re-hydrates the scroll coordinates and session storage on `dom-ready`.

The tab amnesia bug was gone. State was preserved, the UI remained responsive, and sleeping tabs woke cleanly.

Because the `<webview>` element was removed from the DOM and its guest contents destroyed, I assumed memory usage had dropped to zero. I even drafted documentation calling it "Zero-RAM Tab Hibernation".

Then I opened `ps_mem` and `smem` on Linux to measure the actual resident set size (RSS).

The "Zero-RAM" claim was a complete lie.

Even after all background tabs were hibernated, the browser was still holding onto hundreds of megabytes. Measuring per-tab increments showed that dormant tabs were still carrying an effective footprint of **40MB to 90MB of RAM**.

---

## 5. Why Hibernated Tabs Still Cost 40-90MB of RAM

At first, I suspected my own state caching: was serialising the tab information (`title`, `url`, `scrollX`, `scrollY`, `sessionStorage`) in JavaScript retaining hidden DOM references or bloating the V8 heap?

I profiled the heap in DevTools:
* The entire JavaScript state object holding sleep metadata across twenty tabs weighed less than **120 kilobytes**.
* The memory was not in my renderer's JavaScript heap at all.

The 40MB to 90MB residual RAM was being held by Chromium's native engine and the operating system process layer:

### A. Chromium Spare Renderer Pooling
Chromium's process model is heavily prioritised for perceived speed over raw memory conservation. When a `WebContents` is destroyed, Chromium's process manager does not always kill the underlying Linux process immediately. It frequently retains a warm "spare renderer" process in memory, primed to service the next navigation without the latency of a cold process fork.

### B. Multi-Workspace Partition Sessions
Mise isolates workspaces into distinct Chromium partitions (`persist:workspace_<id>`). Even when all webviews in a workspace are unmounted, the partition's underlying session remains alive in the main process. 

The Network Service process keeps partition-specific allocations cached:
* HTTP disk cache directories and in-memory index tables.
* TLS session tickets and connection pools.
* DNS pre-resolution caches and socket tables.
* Font caches and GPU resource bindings.

### C. 64-bit Linux Process Baseline RSS
On modern 64-bit Linux distributions, simply loading the dynamic runtime dependencies required by Chromium (`glibc`, `libX11`, `libwayland`, font engines, Mesa drivers) results in a resident memory baseline of roughly 40MB to 70MB before a single byte of user HTML is even parsed.

Claiming "zero RAM" ignored the foundational architecture of Chromium. Unless you terminate the browser or destroy the entire partition session (which would purge the user's cookies and log them out of all services), that 40MB to 90MB foundation cannot simply vanish.

---

## 6. The Pragmatic Architectural Fix

Recognising this technical reality forced an important mindset shift: chasing theoretical "Zero-RAM" perfection was a trap that led straight back to tab amnesia or session destruction.

Instead, the true objective is **safe, massive memory reduction without state risk**:

### 1. Unmounting Heavy Payloads
Detaching the `<webview>` element eliminates the parts of a web page that actually cause memory bloat:
* V8 execution contexts and complex JavaScript garbage collection roots.
* Large DOM trees and shadow roots (hundreds of megabytes on sites like Discord or Jira).
* Decoded bitmap images and WebGL context buffers.

This drops an active tab from **350-600MB down to the 40-90MB baseline**, delivering an immediate **80% to 85% memory saving**. On a machine with fifteen tabs, this frees upwards of 2.5GB to 3GB of RAM.

### 2. Explicit Memory Compaction
To ensure that detached V8 handles in the main process do not linger, Mise exposes a memory compaction bridge in `preload.js` and `main.js`:

```javascript
// In main.js: trigger V8 garbage collection when hibernating tabs
ipcMain.handle('compact-memory', () => {
    if (typeof global.gc === 'function') {
        try {
            global.gc();
            return true;
        } catch (e) {}
    }
    return false;
});
```

Whenever batch hibernation runs, Mise invokes `compactMemory()` to force immediate reclamation of unreferenced C++ wrappers and JavaScript objects.

### 3. Bulletproof State Preservation
The sleep state records live exclusively in `state.tabSleepStates` and `session.json`, completely decoupled from live navigation events:

```javascript
state.tabSleepStates[currentWS][idx] = {
    url: finalUrl,
    title: finalTitle,
    scrollX,
    scrollY,
    sessionStorage: savedSessionStorage,
    hibernatedAt: Date.now()
};
```

Because the webview is unmounted rather than navigated to `about:blank`, no spurious navigation events are ever fired. The tab title, URL, and reading scroll position remain 100% immune to corruption.

---

## Architectural Takeaways

1. **Beware the `about:blank` shortcut**: Navigating live webviews to blank pages to save memory fires native navigation events that poison session history and destroy user state, all while failing to release the underlying process.
2. **"Zero-RAM" is a myth in embedded Chromium**: Unmounting guest views purges the heavy DOM and JS heap, but native partition caches and process baselines still require 40MB to 90MB.
3. **Pragmatism beats theoretical purity**: An 85% memory reduction that guarantees 100% state reliability is far superior to a brittle attempt at zero RAM that leaves users staring at blank screens.
