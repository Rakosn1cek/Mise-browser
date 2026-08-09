import { state } from '../state.js';
import { applyThemeToOverlayElement, focusActiveWebview } from '../utils.js';

export function toggleHelpMenuWindow() {
    const overlay = document.getElementById('HelpMenuOverlay');
    const content = document.getElementById('HelpMenuContent');
    
    state.helpActive = !state.helpActive;
    if (state.helpActive) {
        if (state.paletteActive) {
            state.paletteActive = false;
            document.getElementById('CommandPaletteOverlay').style.display = 'none';
        }
        if (state.dashboardActive) {
            state.dashboardActive = false;
            document.getElementById('DashboardOverlay').style.display = 'none';
        }
        
        applyThemeToOverlayElement(content, "#124647", "#f5f6f9", "#c0caf5", "#3c3e4f");
        
        content.innerHTML = `Mise Browser — v0.2.7\n==================================================\n
NAVIGATION & WORKSPACES
--------------------------------------------------
Ctrl + T           New DuckDuckGo Tab
Ctrl + L           Toggle Floating Address Bar
Ctrl + W           Close Current Tab (or Node)
Ctrl + Shift + W   Toggle Workspace Dashboard
Ctrl + S           Quick Save Active Workspace
Ctrl + R           Reload Active Tab
Ctrl + D           Quick Remove Current
Ctrl + M           Focus Sidebar Tab List
Ctrl + B           Focus Active Webview
Enter              Switch to Selected Sidebar Tab
Ctrl + P           Toggle Command Palette
Ctrl + Shift + P   Toggle Private Browsing Mode On/Off
Ctrl + N           Open Notes Taking Overlay
Ctrl + Shift + Tab Focus sidebar nav buttons
Ctrl + Shift + Z   Hide/Unhide Sidebar
Ctrl + Shift + B   Open Bookmarks and Quickmarks
Delete             Deletes/Removes Bookmarks/Quickmarks When Selected

WEB INTERACTION
--------------------------------------------------
Ctrl + F                    Toggle Link Hints Overlay
Right Click                 Contextual Actions + (Arch Wiki)
Ctrl + Shift + i            Toggle DevTools
Ctrl + Shift + Q [key]      Set quickmark (e.g., press Ctrl + Shift + Q then g for GitHub).
Ctrl + J then [key]         Jump to quickmark
Ctrl + A                    Add bookmark into bookmarks.json.

SIDEBAR CONTROLS
--------------------------------------------------
Arrow Keys L/R     Move around the nav buttons
Sun/Moon Icon      Toggle Light/Dark Layout
Bell Icon          Toggle Web Notifications

SEARCH BAR ALIASSES
--------------------------------------------------
g                  https://www.google.com/search?q=
yt                 https://www.youtube.com/results?search_query=
a                  https://wiki.archlinux.org/index.php?search=
gh                 https://github.com/search?q=
ddg                https://duckduckgo.com/?q=
pkg                https://archlinux.org/packages/?q=
so                 https://stackoverflow.com/search?q=
r                  https://www.reddit.com/search/?q=`;
        
        overlay.style.display = 'flex';
        overlay.focus();
    } else {
        overlay.style.display = 'none';
        focusActiveWebview();
    }
}
