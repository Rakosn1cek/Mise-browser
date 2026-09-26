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

***

## Auto-Collapsing Vertical Sidebar (36px Strip)

To dedicate maximum horizontal screen real estate to web content, Mise features an auto-collapsible vertical sidebar:

* **Compact 36px Strip**: In its default collapsed state, the sidebar shrinks to a 36px icon bar displaying only your workspace badge and crisp tab favicons.
* **Smooth Flyout on Hover**: Moving your mouse pointer over the 36px strip smoothly expands the sidebar to 260px as an overlay flyout with drop shadow. Because this expands as an overlay, the active webview never resizes, preventing GPU lag and page reflows on fanless hardware.
* **Shortcut Expansion**: Press **Ctrl + Shift + Z** to toggle sidebar expansion, or press **Ctrl + M** to focus the sidebar and expand it immediately for arrow-key navigation. Pressing **Escape** or **Ctrl + B** collapses the sidebar smoothly back to the 36px strip.
* **Pinning**: Click the pin icon button at the bottom of the sidebar, toggle **Auto-Collapse Sidebar** in Preferences (**Ctrl + H**), or run **Pin / Unpin Sidebar** in the Command Palette to pin the sidebar permanently open at 260px.

***

## Sidebar and Webview Focus Management

Mise maintains clean separation between sidebar navigation and active web page interaction:

- **Ctrl + M**: Shifts keyboard focus to the vertical tab sidebar, smoothly expanding it. Use the **Up** and **Down** arrow keys to cycle through open tabs, and press **Enter** to switch to the highlighted tab.
- **Ctrl + B**: Shifts keyboard focus directly into the active webview, automatically collapsing the sidebar back to the 36px strip.
- **Ctrl + W** or **Ctrl + D**: Closes the currently active tab.
- **Ctrl + R**: Reloads the active tab.

***

## Workspace Badges & Favicons

* **Workspace Badges**: The top of the strip displays a compact letter or number badge for the current workspace (such as `W1` or `P`). Clicking the workspace badge opens the Workspace Dashboard (**Ctrl + Shift + W**).
* **Favicons & Indicators**: Each tab renders its website favicon with smart local and remote caching. Sleeping tabs display a subtle moon indicator, while tabs playing audio render a green audio badge.

