# The Shadow DOM Keyboard Trap: When Reddit Swallowed My Vim Keys

How modal keyboard shortcuts broke inside modern Web Components, why `document.activeElement` lied to me, and how deep shadow root penetration restored keyboard control.

---

## 1. The Problem

I built Mise Browser around a strict, keyboard-first philosophy inspired by Vim, Vimium, and Tridactyl. In Normal mode, single keystrokes let me navigate the web rapidly without touching a mouse:
* `e` toggles Reader View
* `g` jumps to the top of the page
* `t` opens a new tab
* `w` pulls up the workspace dashboard
* `j` and `k` scroll down and up
* `Enter` submits searches and confirms actions

The contract is straightforward: when I am browsing, single keys control the browser. When I click into an input field or text area (Insert mode), these shortcuts stand down so I can type normally.

On classic websites like Wikipedia, DuckDuckGo, and traditional forums, this worked effortlessly.

Then I opened Reddit.

I clicked into Reddit's search bar to look up a discussion on `neovim`:
* I typed `n`.
* The moment I pressed `e`, Reader View instantly popped up, covering my screen with a distilled article overlay.
* I dismissed the overlay, clicked back into the search box, and tried typing `general`: the moment I pressed `g`, the page scrolled to the top.
* I tried typing `tools`: the letter `t` spawned an entirely new browser tab.
* I pressed `Enter`: nothing happened.

Ordinary search phrases were triggering a barrage of browser actions. Reddit had swallowed my keyboard input, and I was completely locked out of typing into the search bar.

---

## 2. The Solution (My First Attempt)

My original logic in `webview-preload.js` was textbook. I used a capture-phase `keydown` listener on `window` to intercept navigation chords before the guest web page could consume them:

```javascript
window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const inEditable = isEditableElement(activeEl);

    // In editable elements or explicit insert mode, allow normal typing
    if (inEditable || isExplicitInsert) {
        return;
    }

    // Normal mode actions (e -> Reader View, g -> Scroll, t -> Tab, etc.)
    ...
}, true);
```

To tell whether I was typing in a form or navigating, I wrote a standard DOM classification helper `isEditableElement(el)`:

```javascript
function isEditableElement(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return true;
    }
    if (el.isContentEditable || el.contentEditable === 'true') {
        return true;
    }
    const role = (el.getAttribute && el.getAttribute('role') || '').toLowerCase();
    if (role === 'textbox' || role === 'searchbox') {
        return true;
    }
    return false;
}
```

In standard DOM trees, this is as straightforward as it gets. If `document.activeElement` is an `INPUT` or `TEXTAREA`, return early and let the keystroke pass through.

---

## 3. The Bug / The Fail

It took a targeted debugging session in Electron's DevTools to realise that modern web applications no longer build search bars out of plain `<input>` tags sitting directly in the main document.

Reddit, YouTube, Discord, and GitHub are heavily architected around **Web Components and Shadow DOM**.

When I inspected Reddit's search box, I found a nested Russian doll of encapsulated shadow roots:

```text
<reddit-search-large> (Custom Element host in the main DOM)
  #shadow-root (open)
    <faceplate-search-input> (Nested custom component)
      #shadow-root (open)
        <textarea name="q"> (The actual text input element)
```

### The Shadow DOM Encapsulation Trap

By design, the standard DOM API encapsulates Shadow DOM boundaries from the outer document. 

When I clicked into that `<textarea>`, `document.activeElement` did not return the textarea. It stopped dead at the outermost shadow host boundary and returned `<REDDIT-SEARCH-LARGE>`.

When my `isEditableElement` helper inspected `document.activeElement`:
1. The tag name was `REDDIT-SEARCH-LARGE`, not `INPUT` or `TEXTAREA`.
2. `isContentEditable` was `false`.
3. The element had no ARIA `role="textbox"` or `role="searchbox"`.

My helper returned `false`. As far as Mise was concerned, I was sitting on an ordinary non-editable container in Normal mode. 

The capture-phase listener dutifully intercepted every single letter I typed, prevented default, and fired off vim commands instead:
* `e` -> Trigger Reader View overlay
* `g` -> Scroll page to top
* `t` -> Spawn new tab
* `w` -> Open workspace dashboard

The search bar remained completely blank.

---

## 4. The Fix

Fixing this required teaching my modal navigation engine how to penetrate shadow boundaries and inspect event propagation paths across three layers:

### A. Recursive Shadow Root Traversal
Instead of trusting `document.activeElement`, I introduced a recursive helper that penetrates open shadow roots and same-origin frames until it reaches the true leaf element holding focus:

```javascript
// Recursively resolve active element across shadow DOM and frame boundaries
function getDeepActiveElement() {
    let el = document.activeElement;
    while (el) {
        if (el.shadowRoot && el.shadowRoot.activeElement) {
            el = el.shadowRoot.activeElement;
        } else {
            try {
                if (el.contentDocument && el.contentDocument.activeElement) {
                    el = el.contentDocument.activeElement;
                    continue;
                }
            } catch (err) {}
            break;
        }
    }
    return el;
}
```

### B. Event Composed Path Inspection
In the capture-phase `keydown` listener, `e.composedPath()` returns the complete array of nodes through which an event travels across shadow boundaries. The first node in the array (`path[0]`) is the actual leaf element where my cursor is sitting:

```javascript
// Deep inspection helper to verify if an event originated from an editable target
function isEventInEditable(e) {
    if (typeof e.composedPath === 'function') {
        const path = e.composedPath();
        for (let i = 0; i < path.length; i++) {
            const node = path[i];
            if (isEditableElement(node)) return true;
            if (node && node.shadowRoot && isEditableElement(node.shadowRoot.activeElement)) {
                return true;
            }
        }
    }
    if (isEditableElement(e.target)) return true;
    const deepActive = getDeepActiveElement();
    if (isEditableElement(deepActive)) return true;
    return false;
}
```

### C. Custom Web Component Tag Heuristics
Some custom elements use closed shadow roots or delay internal rendering. I expanded `isEditableElement` to recognize custom element tags denoting search or text input (`SEARCH`, `INPUT`, `TEXT`, `FIELD`, `EDITOR`, `COMPOSER`), while explicitly excluding buttons:

```javascript
function isEditableElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = (el.tagName || '').toUpperCase();
    const role = (el.getAttribute && el.getAttribute('role') || '').toLowerCase();

    // Explicit non-editable interactive elements
    if (tag === 'BUTTON' || role === 'button' || tag.includes('BUTTON')) {
        return false;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        const type = (el.type || '').toLowerCase();
        if (['button', 'submit', 'reset', 'checkbox', 'radio', 'image'].includes(type)) {
            return false;
        }
        return true;
    }
    if (el.isContentEditable || el.contentEditable === 'true') {
        return true;
    }
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') {
        return true;
    }
    // Heuristic for custom web component input and search hosts
    if (tag.includes('-') && (tag.includes('SEARCH') || tag.includes('INPUT') || tag.includes('TEXT') || tag.includes('FIELD') || tag.includes('EDITOR') || tag.includes('COMPOSER'))) {
        return true;
    }
    if (typeof el.closest === 'function') {
        const parentEditable = el.closest('[contenteditable="true"], input, textarea, [role="textbox"], [role="searchbox"]');
        if (parentEditable) return true;
    }
    return false;
}
```

### D. Clean Escape Blurring
When I finished typing and pressed `Escape` to return to Normal mode, calling `blur()` on `document.activeElement` only blurred the outer `<reddit-search-large>` host, leaving the internal shadow `<textarea>` focused. I updated the Escape handler to blur both the deep active element and the host:

```javascript
if (e.key === 'Escape') {
    if (inEditable) {
        if (deepActive && typeof deepActive.blur === 'function') {
            deepActive.blur();
        }
        if (activeEl && typeof activeEl.blur === 'function') {
            activeEl.blur();
        }
        e.preventDefault();
        e.stopPropagation();
    }
    try { ipcRenderer.sendToHost('guest-input-focus', false); } catch (err) {}
    return;
}
```

---

## Architectural Takeaway

The modern web is no longer a flat document; it is a nested tree of encapsulated applications. If you are building browser extensions, custom browsers, or keyboard navigation tools, `document.activeElement` will lie to you the moment you hit a modern Web Component. Penetrating open shadow roots and checking `e.composedPath()` is the only reliable way to keep your keyboard shortcuts sane.
