# External Password Managers

Mise deliberately excludes built-in password vaults, credential saving prompts, and in-browser autofill engines.

This guide explains the security principles behind this architectural decision and demonstrates how to configure external password managers on Linux using auto-type and automatic clipboard-clearing workflows.

***

## Why Mise Omits In-Browser Autofill

Mainstream browsers integrate built-in credential vaults and autofill engines by default. Whilst convenient, this architecture introduces major security and privacy vulnerabilities:

1. **Infostealer Malware Targets**  
   Local credential vaults (such as Chromium's `Login Data` file) are the primary targets of modern infostealer malware. Omitting internal credential storage eliminates this attack vector entirely from Mise.
2. **Invisible Form Scraping**  
   Autofill engines inspect web page inputs and fill credentials automatically or upon a single click. Malicious web pages exploit this behaviour by placing transparent or off-screen input fields (`<input type="password">`), tricking autofill mechanisms into harvesting credentials without the user ever clicking submit.
3. **Guest Webview Boundary Protection**  
   In-browser autofill requires injecting scripts into untrusted guest webview DOM trees and opening IPC channels to transmit secrets. Keeping credential management external preserves Mise's Zero-Trust process isolation.

***

## Recommended Linux Workflows

Linux provides robust, standalone password managers that integrate cleanly at the desktop environment level without touching the browser.

### 1. Clipboard with Automatic Wipe (Most Secure)

The most secure approach retrieves secrets directly from your vault onto the system clipboard with an automatic timeout that purges the password after a few seconds.

#### Using `pass` (Standard UNIX Password Manager)
`pass` integrates natively with GPG encryption and clipboard managers:
```bash
# Copies the password to clipboard and wipes it after 45 seconds
pass -c personal/github
```

#### Using Wayland with `wl-copy`
On Wayland compositors (such as Hyprland, Sway, or GNOME Wayland), `wl-copy` includes a built-in timeout flag (`-t` in milliseconds):
```bash
# Copies text to clipboard and wipes it after 15 seconds
wl-copy -t 15000 < <(pass personal/github)
```

#### Using Quick Launchers (`wofi-pass` / `rofi-pass`)
You can bind a global hotkey in your window manager (e.g. `Super + P`) to open a minimal launcher menu:
1. Press `Super + P` to summon `wofi` or `rofi`.
2. Type the service name and press `Enter`.
3. The launcher decrypts the entry and places it on your clipboard with an automatic wipe timer.
4. Press `Ctrl + V` in Mise to paste into the login field.

***

### 2. KeePassXC Auto-Type

KeePassXC is an offline, encrypted vault application that supports Auto-Type across Linux desktop environments.

#### How Auto-Type Operates
Instead of communicating with the browser through an extension or API, KeePassXC works at the OS compositor level:
1. Navigate to the login page in Mise and focus the username field.
2. Press KeePassXC's global Auto-Type shortcut (such as `Ctrl + Alt + A`).
3. KeePassXC inspects the active window title (e.g. `GitHub: Let's build from here · Mise Browser`).
4. Upon matching the title to an entry in your vault, KeePassXC simulates physical keystrokes:
   * Types the username
   * Sends a `Tab` keypress
   * Types the password
   * Sends an `Enter` keypress

Because the keystrokes arrive through native input events, Mise requires no internal autofill code or DOM hooks.

#### Wayland Compositor Compatibility
On Wayland compositors (such as Hyprland or Sway), application window titles and simulated keystrokes are protected by compositor security boundaries. KeePassXC can simulate keystrokes on Wayland using external typing utilities:
* Install `ydotool` or `wtype` via your distribution package manager (`pacman -S ydotool` on Arch Linux).
* Enable the `ydotoold` background service if required by your distribution.
* In KeePassXC settings, enable Auto-Type and configure the global desktop keybinding in your compositor configuration file (e.g. `hyprland.lua` or `sway/config`).

***

### 3. Standalone Desktop Applications (Bitwarden, 1Password)

If you use cloud-based vaults such as Bitwarden or 1Password:
* Run the official standalone desktop client rather than relying on browser extensions.
* In the desktop client preferences, configure **Clear clipboard after** to a short interval (e.g. 15 to 30 seconds).
* Use the client's global desktop shortcut to summon quick-search, copy credentials, and paste them manually into Mise.

***

## Security Best Practises

| Practise | Recommended Setting | Purpose |
| :--- | :--- | :--- |
| **Clipboard Auto-Clear** | 15 to 30 seconds | Prevents credentials from lingering in memory or clipboard history tools. |
| **Workspace Isolation** | Container partitions | Use separate Mise workspaces (`persist:workspace_<id>`) for banking, personal, and work accounts to prevent cross-session cookie tracking. |
| **No In-Browser Vaults** | External only | Eliminates infostealer attack surfaces from your local browser profile. |
