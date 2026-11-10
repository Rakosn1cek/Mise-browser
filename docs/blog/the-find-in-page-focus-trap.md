# The Find-in-Page Focus Trap: Why Modal Navigation and Chromium Search Don't Mix

How a routine text search feature opened a hornet's nest of focus trapping, desktop window manager collisions, and case amnesia, and how Vim SmartCase and disciplined focus handoffs restored mouse-free browsing.

---

## 1. The Deceptive Simplicity of In-Page Search

When planning features for an Electron-based browser, in-page text search initially appears to be a straightforward task. Chromium provides the underlying engine: `webContents.findInPage(text, options)` executes the query inside Blink, coordinates DOM text scanning, and emits a `found-in-page` event containing match counts and active match indices.

In a conventional browser like Chrome or Firefox, the user journey is equally familiar:
1. The user presses `Ctrl + F`.
2. A small search bar floats down.
3. The user types a query, clicks next or previous with a mouse, and dismisses the bar with the `X` button when finished.

Mise Browser, however, is engineered for Arch Linux, Hyprland, and fanless hardware with a strict keyboard-centric philosophy inspired by Vim. In Mise, every single interaction must remain operable without lifting hands from the home row. Mice and trackpads are optional peripherals, not mandatory dependencies.

For Find in Page, the architectural specification was concise:
* Press `/`, `Ctrl + Shift + F`, or `F3` to toggle a floating Tokyo Night search bar (`#FindBarOverlay`).
* Display real-time match counters (`4 of 21 matches`).
* Use Vim-style `n` (next match) and `N` (previous match) single keys to navigate occurrences across the active page.
* Support case-sensitive searching.

On paper, this appeared to require fifty lines of JavaScript and a small HTML template. In practice, it exposed a fundamental architectural clash between DOM focus boundaries, Linux window manager modifiers, and modal keyboard ergonomics.

---

## 2. The Initial Implementation: The Illusion of Completion

The initial implementation followed standard Electron conventions.

A modular template was created in `templates/find-bar.html` and styled in `styles/overlays/findBar.css`. The markup housed a text input (`#FindInput`), an `Aa` button for case sensitivity (`#FindCaseBtn`), a match counter badge (`#FindMatchCount`), up and down chevron buttons for next and previous, and a close button (`#FindCloseBtn`).

In `modules/renderer/pageSearch.js`, typing into the input dispatched a debounced IPC call to the active `<webview>`:

```javascript
// Naive search dispatch
function executeFind(query, forward = true, findNext = false) {
    const webview = getActiveWebview();
    if (!webview || !query.trim()) return;

    webview.findInPage(query, {
        forward: forward,
        findNext: findNext,
        matchCase: isCaseSensitive
    });
}
```

Whenever Chromium located occurrences, `webview.addEventListener('found-in-page', (e) => ...)` updated the match counter:

```javascript
function formatMatchCount(result) {
    if (!result || result.matches === 0) return '0 matches';
    return `${result.activeMatchOrdinal} of ${result.matches} match${result.matches === 1 ? '' : 'es'}`;
}
```

Finally, in `webview-preload.js`, `n` and `N` were mapped inside the Normal mode keyboard handler:

```javascript
// webview-preload.js: Normal mode navigation
case 'n':
    sendHostIpc('find-next');
    break;
case 'N':
    sendHostIpc('find-previous');
    break;
```

Unit tests verified query execution and match counts against mock DOMs, and the feature appeared complete.

However, real-world keyboard navigation immediately exposed critical design flaws.

---

## 3. The Breakdown: Three Hidden Traps

Within minutes of hands-on testing, the initial design broke down across three distinct operational traps.

### Trap 1: The Focus Prison (The Mouse Trapper)

The most severe flaw was focus trapping across the renderer-to-webview boundary.

Pressing `/` brought up the search bar, and typing `security` successfully highlighted all matches, updating the badge to `1 of 14 matches`.

The expected next action for any Vim user is to navigate forward through the results by pressing `n`.

Pressing `n`, however, simply typed the letter into the search input, mutating the query into `securityn`. Keyboard focus was still captured inside the text field.

Pressing `Enter` to confirm the search query left focus firmly anchored inside `#FindInput`.

Pressing `Tab` shifted focus to the `Aa` button. Pressing `Space` toggled case sensitivity, but focus remained on the button. Pressing `Tab` further to reach the Next button and pressing `Enter` advanced to match 2, but focus remained welded to the button element.

This produced a critical breakdown in user experience: **there was no mechanism to return keyboard focus to the webview to use `n` and `N` navigation without reaching for a mouse to click into the web page.**

In a keyboard-centric browser built to eliminate mouse dependency, the interface had created a focus cul-de-sac.

### Trap 2: The Desktop Environment Chord Collision (`Alt` vs `MainMod2`)

The initial attempt at providing a case sensitivity shortcut relied on `Alt + C`, accompanied by an `(Alt+C)` tooltip on the `Aa` button. This shortcut is standard in Visual Studio Code, Firefox, and Chromium DevTools.

In a custom Linux tiling environment, however, this assumption failed immediately.

On Arch Linux workstations running Hyprland, `Alt` is frequently configured as `MainMod2`, reserved for secondary window manipulation, floating tile dragging, and custom submap triggers. The moment `Alt + C` was pressed, Hyprland intercepted the chord at the compositor layer before Electron ever received a `keydown` event.

Hardcoding modifier chords like `Alt` in an application designed for advanced Linux setups creates direct conflicts with host window management.

### Trap 3: Case Amnesia and the Match Explosion

The third issue was visual clutter and query dilution caused by naive substring searching.

When searching for a project name such as `Mise` on technical documentation or repository pages, the match counter frequently reported `1 of 91 matches`. Along the right-hand edge of the screen, Chromium painted an almost solid yellow column of search tick indicators down the vertical scrollbar track.

Because the search defaulted to case-insensitive matching, searching for capitalised `Mise` matched every lowercase occurrence of words containing that substring, such as `customise`, `minimise`, and `optimisation`, as well as user handles and URLs. The active view became overwhelmed with yellow highlights, obscuring the intended matches.

Requiring users to manually tab to a toggle button to avoid dozens of false positives introduced unacceptable friction into routine searches.

---

## 4. The Architectural Fix

Resolving these issues required re-evaluating how modal keyboard focus transitions across the boundary between the Electron renderer chrome and the sandboxed guest webview.

### Fix 1: Seamless Focus Handoff (`focusActiveWebview`)

To break out of the focus prison, an explicit focus handoff contract was established: **confirming a search query must immediately relinquish renderer focus and restore it to the guest webview.**

In `modules/renderer/pageSearch.js`, pressing `Enter` on `#FindInput` was bound to trigger the search and call `focusActiveWebview()`:

```javascript
// Submit search and return focus immediately to guest webview
findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
            findInPagePrevious();
        } else {
            findInPageNext();
        }
        // Seamless handoff: drop focus to webview so n/N take over instantly
        focusActiveWebview();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        toggleInPageSearch(false);
    }
});
```

The `focusActiveWebview()` helper safely resolves active split panes and tab references:

```javascript
function focusActiveWebview() {
    const webview = getActiveWebview();
    if (webview) {
        webview.focus();
    }
}
```

This established a fluid keyboard workflow:
1. Press `/` (or `Ctrl + Shift + F` / `F3`) to open the find bar.
2. Type the query.
3. Press `Enter`.
4. Keyboard focus immediately returns to the webpage. Tapping `n` and `N` steps through matches across the document without mouse interaction.

### Fix 2: Circular Tab Trapping with Multi-Key Egress

To support keyboard users navigating the overlay controls directly, a circular focus trap was implemented within `#FindBarOverlay`. Tabbing forward from the close button wraps back to the search input, while shift-tabbing backward from the search input wraps to the close button:

```javascript
findOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        const focusable = [findInput, findCaseBtn, findPrevBtn, findNextBtn, findCloseBtn]
            .filter(el => el && el.offsetParent !== null);
        const idx = focusable.indexOf(document.activeElement);
        if (e.shiftKey && (idx <= 0)) {
            e.preventDefault();
            focusable[focusable.length - 1].focus();
        } else if (!e.shiftKey && (idx === focusable.length - 1)) {
            e.preventDefault();
            focusable[0].focus();
        }
    }
});
```

Crucially, all button controls were equipped with **multi-key egress**. When focus resides on the `Aa`, Previous, or Next button:
* Pressing `Enter` or `Space` executes the action and returns focus to the webview.
* Pressing `n` or `N` executes the navigation step and drops focus back to the webview.
* Pressing `Escape` dismisses the bar and returns focus to the webview.

This guarantees that keyboard focus is never trapped inside the overlay chrome.

### Fix 3: Vim SmartCase Sensitivity

To eliminate conflicts with window manager modifier chords, case sensitivity was redesigned around classic Vim **SmartCase** conventions.

In SmartCase matching, case sensitivity is inferred directly from the query:
* If the search string consists solely of lowercase characters (`mise`), the search executes case-insensitively.
* The moment a single uppercase character is introduced (`Mise`), the engine automatically switches to exact case-sensitive matching.

This rule was implemented directly into the search engine:

```javascript
function isMatchCaseActive(query) {
    if (manualCaseOverride !== null) {
        return manualCaseOverride;
    }
    // Vim SmartCase: case-sensitive if query contains any capital letter
    return /[A-Z]/.test(query);
}
```

Manual override remains accessible via the `Aa` button when needed, backed by an illuminated Tokyo Night border (`.find-case-btn.active`) indicating active state.

Searching for `Mise` immediately eliminated the false-positive flood, narrowing 91 scattered matches down to the 6 intended occurrences without requiring modifier chords.

### Fix 4: Chromium Scrollbar Marker Teardown & Tab Isolation

The final refinement addressed Chromium's native scrollbar markers. When `findInPage` executes, Blink renders yellow match indicators directly onto the guest scrollbar canvas.

To prevent highlights from persisting when switching tabs or dismissing the overlay, active tab isolation was introduced in `modules/webview.js`:

```javascript
webview.addEventListener('found-in-page', (e) => {
    // Drop events from background or non-active split webviews
    if (webview !== getActiveWebview()) return;
    
    if (window.updateFindBarMatchCount) {
        window.updateFindBarMatchCount(e.result);
    }
});
```

Upon overlay dismissal (via `Escape`, the close button, or tab navigation), an explicit cleanup call is issued:

```javascript
function stopInPageSearch() {
    const webview = getActiveWebview();
    if (webview) {
        webview.stopFindInPage('clearSelection');
    }
}
```

This immediately clears the yellow indicators from the scrollbar track and restores clean rendering state.

---

## 5. Key Takeaways

1. **Focus Handoff is as Vital as Focus Trapping**: In modal interfaces, preventing focus from escaping into the outer application shell is only half the requirement. Establishing a clear, predictable handoff back to content upon submission is what distinguishes genuinely keyboard-native software from superficial keyboard shortcuts.
2. **System Modifiers Cannot Be Assumed Free**: Linux users running tiling window managers frequently repurpose `Alt` and `Super` for compositor and workspace control. Applications must avoid relying on modifier chords for internal utilities when ergonomic alternatives exist.
3. **SmartCase Remains an Ergonomic Masterclass**: Inferring user intent from the presence of capitalisation solves case sensitivity faster and with less friction than toolbar toggle buttons or complex key chords.
4. **Line Budget Discipline Enforces Decoupled Architecture**: By keeping `modules/renderer/pageSearch.js` cleanly separated from `renderer.js` and `webview.js`, comprehensive in-page search was integrated while maintaining strict line budgets (`renderer.js` under 250 lines and `main.js` under 550 lines).
