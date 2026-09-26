# Mouse-Free Navigation

Mise Browser is built around a keyboard-driven workflow, enabling efficient navigation of complex web pages without reaching for a pointing device.

---

## Link Hints Overlay (`Ctrl + F`)

Link Hints allow you to click any link, button, or input field on a web page using short letter combinations:

1. Press **Ctrl + F** to trigger the hint labels.
2. Mise injects two-letter tags over every clickable element on the page, using an ergonomic left-hand home-cluster layout: `q, w, e, a, s, d, z, x, c, r, f, v`.
3. Type the two letters corresponding to your target element:
   - Links navigate immediately.
   - Text inputs and search bars automatically receive focus for immediate typing.
4. Press **Escape** or press **Ctrl + F** again to dismiss hints without clicking.

---

## Floating Address Bar (`Ctrl + L`)

Press **Ctrl + L** at any time to open the floating, high-contrast address overlay:

- **Direct Navigation**: Type any full or partial URL and press **Enter**.
- **Live Search Autocomplete**: As you type, Mise queries your browsing history and active bookmarks live. Use the **Up** and **Down** arrow keys to select a suggestion and press **Enter**.
- **Workspace Switching**: Type `ws` followed by a workspace name (e.g. `ws work`) to switch workspaces instantly from the address bar.
- Press **Escape** to hide the address bar and return focus directly to the active web page.

---

## Search Engine Aliases

When typing queries into the address bar, prepend shorthand prefixes to route searches directly to specific services:

| Shorthand Alias | Search Destination | Example Query |
| :--- | :--- | :--- |
| `g <query>` | Google Search | `g linux kernel archives` |
| `ddg <query>` | DuckDuckGo | `ddg rust async tutorial` |
| `a <query>` | Arch Linux Wiki | `a hyprland config` |
| `pkg <query>` | Arch Linux Package Search | `pkg neovim` |
| `gh <query>` | GitHub Repository Search | `gh electron` |
| `yt <query>` | YouTube Search | `yt ambient coding music` |
| `r <query>` | Reddit Search | `r archlinux` |
| `so <query>` | StackOverflow | `so javascript closures` |
| `sp <query>` | Startpage Search | `sp private search` |
| `b <query>` | Brave Search | `b web standards` |
| `k <query>` | Kagi Search | `k technical docs` |

If no alias is entered, Mise uses your configured default search engine set in Preferences.

---

## Sidebar and Webview Focus Management

Mise maintains clean separation between sidebar navigation and active web page interaction:

- **Ctrl + M**: Shifts keyboard focus to the vertical tab sidebar. Use the **Up** and **Down** arrow keys to cycle through open tabs, and press **Enter** to switch to the highlighted tab.
- **Ctrl + B**: Shifts keyboard focus directly into the active webview, allowing you to scroll and interact with the page immediately.
- **Ctrl + W** or **Ctrl + D**: Closes the currently active tab.
- **Ctrl + R**: Reloads the active tab.

---

## Zen Mode (`Ctrl + Shift + Z`)

When you want to maximise reading area or eliminate visual distractions:

- Press **Ctrl + Shift + Z** to toggle Zen Mode.
- Zen Mode smoothly hides the vertical sidebar and navigations, dedicating the entire window frame to the web page content.
- Press **Ctrl + Shift + Z** again to restore the sidebar.
