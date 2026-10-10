# The Accidental Resurrection: How Closing a Tab Defeated Tab Hibernation

How a naive index decrement broke tab closure ergonomics, why sleeping background tabs were silently woken into memory, and how Most Recently Used (MRU) lifecycle awareness restored efficiency.

---

## 1. The Problem

One of the defining pillars of Mise Browser is True Tab Hibernation. On a fanless Linux laptop or a resource-constrained development environment, running multiple browser tabs quickly devours gigabytes of memory. In Mise, background tabs hibernate: their Chromium webview instances are unmounted from the DOM, releasing renderer processes and freeing memory until they are explicitly needed again.

Under normal browsing, this setup is remarkably light. I often keep five or six tabs organized in a workspace:
* Tab 0 (documentation, hibernated)
* Tab 1 (my active research page, loaded and awake in memory)
* Tab 2 (issue tracker, hibernated)
* Tab 3 (web mail, hibernated)
* Tab 4 (dashboard, hibernated)

The issue emerged during a simple, everyday interaction.

While reading my primary research page on Tab 1, I opened a transient new tab (`Ctrl + T`) to check a quick search query. The new tab was appended to the bottom of the sidebar at index 5 and focused. 

Once I found my answer, I closed the tab (`Ctrl + X`). I expected the browser to return me smoothly to Tab 1, the research page I was actively working on moments before.

Instead, Mise jumped straight to Tab 4 at the very bottom of the sidebar.

Because Tab 4 had been hibernated, the browser did what it always does when a user focuses a sleeping tab: it called `wakeTab()`, allocated a brand new Chromium renderer process, reloaded the page, and pulled tens or hundreds of megabytes of RAM back into active memory depending on the complexity of the site. 

The tab I had actually been working on sat completely awake and undisturbed near the top of the sidebar, ignored. Worse, if I closed Tab 4, the browser jumped to Tab 3 and woke that up too. Every tab closure was resurrecting sleeping renderers backwards up the sidebar, completely defeating the efficiency of tab hibernation.

---

## 2. The Solution (My First Attempt)

When I originally implemented tab removal in `modules/webview.js`, my mental model treated the sidebar as a simple list. If you remove the final item from an array or list widget, the standard UI convention is to highlight the preceding element:

```javascript
// Naive tab removal fallback
renderWorkspaceUI(tabs.length > 0 ? Math.max(0, currentIdx - 1) : null);
```

On paper, this seemed tidy and predictable:
1. Splice the closed tab from `state.sessionState.workspaces[currentWS]`.
2. Tear down its webview element from the DOM container.
3. Clean up the caches for titles, favicons, and media indicators.
4. Pass `Math.max(0, currentIdx - 1)` to `renderWorkspaceUI()` to focus the tab directly above the deleted one.

If you delete Tab 2 from the middle of a list of active tabs, selecting Tab 1 feels completely natural.

---

## 3. The Bug / The Fail

The flaw with `Math.max(0, currentIdx - 1)` is that spatial order in a list does not match temporal navigation order, especially when tabs have lifecycle states.

### Spatial Proximity vs Temporal Context

In Mise, newly created blank tabs are appended to the end of the workspace array (`workspaces[ws].push(defaultUrl)`). 

When I was on Tab 1 and opened a new tab, that new tab became Tab 5. When I closed Tab 5:
* `currentIdx` was 5.
* `currentIdx - 1` evaluated to 4.

Tab 4 was not my previous tab. It was merely the nearest neighbour sitting at the bottom of the pile. My actual previous context was Tab 1.

### The Renderer Spawning Cascading Loop

In a standard heavyweight browser where every tab maintains an open renderer process at all times, selecting the wrong tab is an annoyance. In Mise, where inactive tabs are aggressively hibernated, it is an architectural regression.

When `renderWorkspaceUI()` focused index 4, it invoked `switchTabFocus(4)`:

```javascript
if (!state.activeViewsCache[currentWS]?.[targetIdx] || state.tabSleepStates[currentWS]?.[targetIdx]) {
    wakeTab(currentWS, targetIdx);
}
```

Because Tab 4 was hibernated, `wakeTab()` immediately kicked in:
1. It created a fresh `<webview>` tag with preload scripts and security flags.
2. It mounted it into `#webview-container`.
3. Chromium spawned a new operating system renderer process.
4. The webview began loading the remote page over the network.

All of this CPU, network, and memory overhead was triggered purely because the selection algorithm blindly stepped backward by one index.

---

## 4. The Architectural Fix

To solve this properly, tab removal needed two essential capabilities:
1. An understanding of user navigation history (temporal order).
2. Awareness of tab lifecycle states (distinguishing awake renderers from hibernated tabs).

### A. Per-Workspace Most Recently Used (MRU) History

I introduced a dedicated `tabHistory` store in `modules/state.js`, maintaining a chronological stack of focused tab indices for each workspace:

```javascript
// modules/state.js
export const state = {
    ...
    tabHistory: {}, // Per-workspace array of visited tab indices [oldest, ..., newest]
};
```

Whenever `switchTabFocus()` activates a tab, the index is moved to the top of the workspace's MRU stack:

```javascript
// modules/webview.js
export function switchTabFocus(targetIdx) {
    ...
    if (!state.tabHistory) state.tabHistory = {};
    if (!Array.isArray(state.tabHistory[currentWS])) state.tabHistory[currentWS] = [];
    const history = state.tabHistory[currentWS];
    const existingPos = history.indexOf(targetIdx);
    if (existingPos !== -1) {
        history.splice(existingPos, 1);
    }
    history.push(targetIdx);
    ...
}
```

### B. Three-Tier Lifecycle-Aware Tab Restoration

When a tab is closed in `handleTabRemoval()`, the removal logic now follows a three-tier decision tree:

```javascript
// modules/webview.js
let nextTargetIdx = null;

if (tabs.length > 0) {
    if (state.tabHistory && Array.isArray(state.tabHistory[currentWS])) {
        // Prune removed index and adjust shifted indices
        const updatedHistory = [];
        for (const histIdx of state.tabHistory[currentWS]) {
            if (histIdx === currentIdx) continue;
            const adjusted = histIdx > currentIdx ? histIdx - 1 : histIdx;
            if (adjusted >= 0 && adjusted < tabs.length && !updatedHistory.includes(adjusted)) {
                updatedHistory.push(adjusted);
            }
        }
        state.tabHistory[currentWS] = updatedHistory;

        // Tier 1: Prioritise returning to an already awake tab from recent history
        for (let i = updatedHistory.length - 1; i >= 0; i--) {
            const candidate = updatedHistory[i];
            const isAwake = state.activeViewsCache[currentWS]?.[candidate] && !state.tabSleepStates[currentWS]?.[candidate];
            if (isAwake) {
                nextTargetIdx = candidate;
                break;
            }
        }

        // Fallback within history even if sleeping
        if (nextTargetIdx === null && updatedHistory.length > 0) {
            nextTargetIdx = updatedHistory[updatedHistory.length - 1];
        }
    }

    // Tier 2: Check if ANY remaining tab in the workspace is already awake
    if (nextTargetIdx === null) {
        for (let i = 0; i < tabs.length; i++) {
            const isAwake = state.activeViewsCache[currentWS]?.[i] && !state.tabSleepStates[currentWS]?.[i];
            if (isAwake) {
                nextTargetIdx = i;
                break;
            }
        }
    }

    // Tier 3: Ultimate fallback to adjacent tab
    if (nextTargetIdx === null) {
        nextTargetIdx = Math.min(currentIdx, tabs.length - 1);
    }
}

renderWorkspaceUI(nextTargetIdx);
```

### How It Operates in Practice

1. **Tier 1 (Temporal Awake Priority)**: If I am on Tab 1, open Tab 5, and close Tab 5, the MRU history points directly to Tab 1. Because Tab 1 is still awake in memory, Mise immediately switches focus back to Tab 1. Not a single background tab is touched, and zero new renderers are spawned.
2. **Tier 2 (Awake Preservation)**: If history is exhausted or invalid, the engine inspects the workspace for any other awake tab before touching a sleeping one.
3. **Tier 3 (Adjacent Fallback)**: Only if every single remaining tab in the workspace is hibernated does the browser fall back to selecting an adjacent index.

---

## 5. Architectural Lessons & Takeaways

### UI Selection Must Be Lifecycle-Aware
In conventional web or desktop development, selecting an item in a list is considered a harmless visual change. When building an application that aggressively sleeps and wakes heavy underlying operating system processes, UI focus changes carry real resource costs. Selection logic must check process lifecycle state before triggering unintended wakeups.

### Spatial Proximity Rarely Equals Intent
Users navigate chronologically, not spatially. Closing a tab is almost always an expression of wanting to return to the task you were performing beforehand. Relying on spatial array offsets (`index - 1`) breaks this expectation and creates friction.

By pairing chronological MRU history with lifecycle state validation, Mise preserves user context seamlessly while keeping RAM consumption under strict control.
