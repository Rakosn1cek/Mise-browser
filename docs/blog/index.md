# Engineering Chronicles

Deep dives into the most challenging bugs, feature failures, and architectural lessons encountered during the development of Mise Browser.

Each chronicle follows our development anatomy: **Problem** → **Attempted Solution** → **The Bug / Fail** → **The Architectural Fix**.

---

### [The Google Auth Botguard Saga: The rrk=46 Riddle and Poisoned Cookies](./google-auth-rrk46-botguard.md)

How an attempt to sign into Gmail in an isolated container led down a rabbit hole of Botguard detection, User-Agent traps, and self-perpetuating cookie poisoning.

`Security` · `Authentication` · `Chromium` · `Electron`

---

### [The Shadow DOM Keyboard Trap: When Reddit Swallowed My Vim Keys](./shadow-dom-keyboard-trap.md)

How modal keyboard shortcuts broke inside modern Web Components, why `document.activeElement` lied to me, and how deep shadow root penetration restored keyboard control.

`DOM` · `Web Components` · `Keyboard Navigation` · `Vim`

---

### Upcoming Chronicles

- **The Ghostery IPC Civil War: Adblocking Across Isolated Partitions**  
  How strict multi-account container partitions caused IPC channel collisions in the adblocking engine and the session detachment fix that resolved it.

- **Taming the Userscript Engine: SSRF and DNS Rebinding Defences**  
  Closing critical security holes in `GM_xmlhttpRequest` by enforcing `@connect` rules, private IP blocking, and pre-resolution socket pinning.

- **Zero-RAM Tab Hibernation Without State Amnesia**  
  Unmounting background `<webview>` elements to eliminate memory usage on fanless Linux hardware while preserving history stacks and form inputs.

- **The Ghost in the CSS: Tracking Pixels in Reader View**  
  How inline CSS background images and SVG containers bypassed DOM distillation and how strict sanitisation closed the leak.
