# Mise Browser Blog

Welcome to the Mise Browser technical publication, featuring architectural essays on web ecology and deep-dive engineering post-mortems.

---

## Perspectives & Essays

Commentary on browser culture, trust models, security realities, and deliberate software craftsmanship.

### [The Illusion of Corporate Safety: The Double Standard Facing Indie Browsers](./the-illusion-of-corporate-safety.md)

Why technical communities extend blind trust to corporate browsers harvesting telemetry while reflexively dismissing auditable indie alternatives, the paradox of third-party extensions, and engineering with discipline in the age of "vibe coding".

`Perspectives` · `Open Source` · `Browser Security` · `Craftsmanship` · `Mise Browser`

---

## Engineering Chronicles

Deep dives into the most challenging bugs, feature failures, and architectural lessons encountered during the development of Mise Browser.

Each chronicle follows the development anatomy: **Problem** → **Attempted Solution** → **The Bug / Fail** → **The Architectural Fix**.

### [The Silent Truncation Trap: How Mid-Write Crashes and Naive Fallbacks Destroyed User Data](./the-silent-truncation-trap.md)

Why direct synchronous file writes and silent default fallbacks caused catastrophic data loss, and how atomic filesystem guarantees and corrupt file snapshotting resolved it.

`Data Integrity` · `Filesystem Architecture` · `Crash Resilience` · `Storage Security` · `Electron`

---

### [The Anatomy of a Leak-Proof Private Workspace: When Toggling State Shatters Process Isolation](./the-anatomy-of-a-leak-proof-private-workspace.md)

Why toggling private mode across persistent workspaces was an architectural hazard, how remote favicon lookups leaked host requests, and how a dedicated volatile workspace restored true privacy.

`Privacy` · `Chromium Partitions` · `Process Isolation` · `Session Security` · `Electron`

---

### [From 2,000 Lines of Spaghetti to Clean Orchestration: Taming the Electron Main Process](./taming-the-electron-main-process.md)

How rapid prototyping turned `main.js` into a 2,100-line monolith, why shared mutable scope threatens browser stability, and how a disciplined six-phase modularisation protocol reduced technical debt without breaking tab hibernation or session state.

`Architecture` · `Refactoring` · `Process Isolation` · `Testing` · `Electron` · `Mise Browser`

---

### [The Awakening Cascade: How Naive Tab Traversal Defeated Tab Hibernation](./tab-traversal-awakening-cascade.md)

How linear keyboard navigation secretly allocated hundreds of megabytes of RAM, why scrolling past sleeping tabs broke process isolation, and how decoupled roving cursors and direct random-access tab jumping restored true memory efficiency.

`Memory Optimisation` · `Keyboard Ergonomics` · `State Architecture` · `Tab Hibernation` · `Electron`

---

### [The Dark Reader Dilemma: Taming Navigation Amnesia, Picture Inversion, and Blend Mode Blackouts](./dark-reader-navigation-persistence.md)

How transient Chromium frames wiped injected stylesheets on redirect, why responsive picture tags and blend modes turned product photos into black voids, and how lifecycle-aware state restored seamless dark mode.

`CSS Filters` · `Dark Reader` · `Lifecycle Architecture` · `Chromium` · `Electron`

---

### [The Blind Spot in the Browser: Conquering Shadow DOM and the 144-Key Limit in Link Hints](./shadow-dom-link-hints.md)

How Web Components hid navigation links from query selectors, why hardcoded 2-letter permutations created silent key collisions, and how recursive shadow tree crawling restored mouse-free navigation.

`DOM` · `Web Components` · `Keyboard Navigation` · `Link Hints` · `Vim`

---

### [The Accidental Resurrection: How Closing a Tab Defeated Tab Hibernation](./accidental-tab-resurrection.md)

How a naive index decrement broke tab closure ergonomics, why sleeping background tabs were silently woken into memory, and how Most Recently Used (MRU) lifecycle awareness restored efficiency.

`Tab Management` · `Memory Optimisation` · `State Architecture` · `Ergonomics` · `Electron`

---

### [The Google Auth Botguard Saga: The rrk=46 Riddle and Poisoned Cookies](./google-auth-rrk46-botguard.md)

How an attempt to sign into Gmail in an isolated container led down a rabbit hole of Botguard detection, User-Agent traps, and self-perpetuating cookie poisoning.

`Security` · `Authentication` · `Chromium` · `Electron`

---

### [The Shadow DOM Keyboard Trap: When Reddit Swallowed My Vim Keys](./shadow-dom-keyboard-trap.md)

How modal keyboard shortcuts broke inside modern Web Components, why `document.activeElement` lied to me, and how deep shadow root penetration restored keyboard control.

`DOM` · `Web Components` · `Keyboard Navigation` · `Vim`

---

### [The "Zero-RAM" Tab Hibernation Myth: Why Sleeping Tabs Still Cost 40-90MB](./tab-hibernation-zero-ram-myth.md)

How chasing zero memory usage broke tabs with the `about:blank` amnesia trap, why Chromium partition sessions retain 40-90MB of RAM, and the pragmatic unmounting architecture that slashed memory bloat safely.

`Memory Optimisation` · `Chromium` · `Electron` · `Linux` · `Architecture`

---

### Upcoming Chronicles

- **The Ghostery IPC Civil War: Adblocking Across Isolated Partitions**  
  How strict multi-account container partitions caused IPC channel collisions in the adblocking engine and the session detachment fix that resolved it.

- **Taming the Userscript Engine: SSRF and DNS Rebinding Defences**  
  Closing critical security holes in `GM_xmlhttpRequest` by enforcing `@connect` rules, private IP blocking, and pre-resolution socket pinning.

- **The Ghost in the CSS: Tracking Pixels in Reader View**  
  How inline CSS background images and SVG containers bypassed DOM distillation and how strict sanitisation closed the leak.

---

### Community & Discussion

Interested in discussing technical architectural decisions, bugs, or upcoming chronicles? Join the conversation on [Reddit (r/mise_browser)](https://www.reddit.com/r/mise_browser/) or connect on [Mastodon (@misebrowser@mastodon.social)](https://mastodon.social/@misebrowser).
