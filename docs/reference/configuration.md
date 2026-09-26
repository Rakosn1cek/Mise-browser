# Configuration Files

All Mise configurations are stored in standard JSON and Markdown format within your user profile directory:

```text
~/.config/mise-browser/
```

---

## 1. Engine & Preferences (`config.json`)

Controls hardware switches, process limits, privacy whitelists, and search preferences:

```json
{
    "disable_gpu": false,
    "background_throttling": true,
    "process_limit": 1,
    "tab_sleep_timeout_minutes": 15,
    "email_handler": "system",
    "search_engine": "https://duckduckgo.com/?q=%s",
    "theme": "dark",
    "trusted_domains": [
        "x.com",
        "amazon.co.uk",
        "accounts.google.com",
        "google.com"
    ]
}
```

### Options Description

- **`disable_gpu`**: Set to `true` to disable hardware GPU acceleration on systems with problematic graphics drivers.
- **`background_throttling`**: Throttles timers and delays tasks in background tabs to conserve CPU cycles.
- **`process_limit`**: Hard cap on Chromium renderer process forks (1 to 5).
- **`tab_sleep_timeout_minutes`**: Inactivity timeout before background tabs detach and hibernate (5, 15, 30, 60, or 0 to disable).
- **`email_handler`**: Choose between `system` (OS default `mailto:`) or webmail providers (Gmail, Zoho, Outlook, Fastmail, ProtonMail).
- **`search_engine`**: Fallback search provider URL when non-URL queries are entered without an alias.
- **`theme`**: Interface theme preference (`dark` for Tokyo Night or `light`).
- **`trusted_domains`**: Array of domains exempted from tracker blocking and fingerprint spoofing.

---

## 2. Keybindings Map (`keybinds.json`)

Maps internal browser actions to custom keystroke combinations. See the [Keyboard Shortcuts Reference](/reference/keybinds) for the complete list of action names.

---

## 3. Session State (`session.json`)

Maintains persistent workspaces, URLs, titles, and sleeping tab scroll offsets:

```json
{
    "current_workspace": "Work",
    "workspaces": {
        "Work": [
            "https://github.com/notifications"
        ],
        "Personal": [
            "https://news.ycombinator.com"
        ]
    },
    "tab_titles": {
        "Work": ["Notifications"],
        "Personal": ["Hacker News"]
    },
    "tab_sleep_states": {
        "Personal": [
            {
                "url": "https://news.ycombinator.com",
                "title": "Hacker News",
                "scrollX": 0,
                "scrollY": 840,
                "hibernatedAt": 1727299000000
            }
        ]
    }
}
```

---

## 4. Bookmarks & Quickmarks

- **`bookmarks.json`**: An array of saved bookmark objects containing `title`, `url`, and creation timestamp.
- **`quickmarks.json`**: A key-value dictionary mapping single alphanumeric keys to URLs (e.g. `"g": "https://github.com"`).

---

## 5. Quick Notes (`notes.md`)

A standard Markdown file storing everything typed into the Quick Notes overlay (**Ctrl + N**). You can edit this file directly using your favourite text editor.
