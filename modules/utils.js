import { state } from './state.js';

// Returns true if the browser interface is currently in dark mode
export const isDarkMode = () => document.body.classList.contains('dark-mode');

// Updates an element's background and text color based on the current theme
export function applyThemeToOverlayElement(element, darkBg, lightBg, darkText, lightText) {
    if (!element) return;
    const dark = isDarkMode();
    element.style.backgroundColor = dark ? darkBg : lightBg;
    element.style.color = dark ? darkText : lightText;
}

// Simple HTML escaping helper for safe rendering
export function escapeHtml(text) {
    if (!text) return "";
    return text
        .split("&").join("&amp;")
        .split("<").join("&lt;")
        .split(">").join("&gt;")
        .split('"').join("&quot;")
        .split("'").join("&#039;");
}

// Script extensions array for Oversight security check
export const SCRIPT_EXTENSIONS = [
    ".sh", ".bash", ".zsh", ".ksh", ".csh", ".fish", ".local",
    ".py", ".pyw", ".pl", ".rb", ".lua", ".tcl", ".pyi",
    ".c", ".cpp", ".cc", ".h", ".hpp", ".rs", ".go", ".js", ".ts"
];

export function isTargetScript(inputText) {
    if (!inputText) return false;
    const lowerInput = inputText.toLowerCase();
    return SCRIPT_EXTENSIONS.some(ext => lowerInput.endsWith(ext));
}

export function getActiveWebview() {
    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return null;
    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
    return state.activeViewsCache[currentWS]?.[currentIdx] || null;
}

export function focusActiveWebview() {
    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (activeListItem) {
        const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
        if (state.activeViewsCache[currentWS] && state.activeViewsCache[currentWS][currentIdx]) {
            window.miseAllowWebviewFocus = true;
            state.activeViewsCache[currentWS][currentIdx].focus();
        }
    }
}

// Generates a filesystem-safe persistent container partition string for a workspace
export function getWorkspacePartition(workspaceName) {
    if (!workspaceName) return 'persist:default';
    const clean = String(workspaceName).trim().toLowerCase().replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return `persist:${clean || 'default'}`;
}
