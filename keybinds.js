// keybinds.js
// Centralised action registry and keybind configuration manager for Mise Browser

const fs = require('fs');
const path = require('path');

const DEFAULT_KEYBINDS = {
    'toggle-menu-bar': 'F1',
    'spawn-tab': 'Ctrl+T',
    'toggle-address': 'Ctrl+L',
    'toggle-dashboard': 'Ctrl+Shift+W',
    'reload-active-tab': 'Ctrl+R',
    'remove-tab': ['Ctrl+W', 'Ctrl+D'],
    'focus-sidebar': 'Ctrl+M',
    'focus-webview': 'Ctrl+B',
    'trigger-hints': 'Ctrl+F',
    'toggle-help': 'Ctrl+H',
    'toggle-private-mode': 'Ctrl+Shift+P',
    'toggle-palette': 'Ctrl+P',
    'toggle-find': 'Ctrl+S',
    'toggle-devtools': ['Ctrl+Shift+I', 'F12'],
    'toggle-notes': 'Ctrl+N',
    'toggle-zen-mode': 'Ctrl+Shift+Z',
    'set-quickmark': 'Ctrl+Shift+Q',
    'jump-quickmark': 'Ctrl+J',
    'add-bookmark': 'Ctrl+Shift+A',
    'toggle-bookmarks': 'Ctrl+Shift+B',
    'toggle-global-media': ['Ctrl+Shift+0', 'F10'],
    'toggle-history': 'Ctrl+Shift+H'
};

const ACTION_METADATA = {
    'toggle-menu-bar': { label: 'Toggle Mise Settings (Menu Bar)', category: 'System' },
    'spawn-tab': { label: 'New Blank Tab', category: 'Navigation & Workspaces' },
    'toggle-address': { label: 'Toggle Floating Address Bar', category: 'Navigation & Workspaces' },
    'toggle-dashboard': { label: 'Toggle Workspace Dashboard', category: 'Navigation & Workspaces' },
    'reload-active-tab': { label: 'Reload Active Tab', category: 'Navigation & Workspaces' },
    'remove-tab': { label: 'Close Current Tab', category: 'Navigation & Workspaces' },
    'focus-sidebar': { label: 'Focus Sidebar Tab List', category: 'Navigation & Workspaces' },
    'focus-webview': { label: 'Focus Active Webview', category: 'Navigation & Workspaces' },
    'trigger-hints': { label: 'Toggle Link Hints Overlay', category: 'Web Interaction' },
    'toggle-help': { label: 'Toggle Preferences / Help', category: 'System' },
    'toggle-private-mode': { label: 'Toggle Private Browsing Mode', category: 'System' },
    'toggle-palette': { label: 'Toggle Command Palette', category: 'Navigation & Workspaces' },
    'toggle-find': { label: 'Find In Page', category: 'Web Interaction' },
    'toggle-devtools': { label: 'Toggle Active Webview DevTools', category: 'Web Interaction' },
    'toggle-notes': { label: 'Open Quick Notes Overlay', category: 'Navigation & Workspaces' },
    'toggle-zen-mode': { label: 'Toggle Zen Mode (Hide Sidebar)', category: 'Navigation & Workspaces' },
    'set-quickmark': { label: 'Set Quickmark', category: 'Web Interaction' },
    'jump-quickmark': { label: 'Jump to Quickmark', category: 'Web Interaction' },
    'add-bookmark': { label: 'Add Current Page to Bookmarks', category: 'Web Interaction' },
    'toggle-bookmarks': { label: 'Open Bookmarks and Quickmarks', category: 'Navigation & Workspaces' },
    'toggle-global-media': { label: 'Play/Pause Media Playback Globally', category: 'Web Interaction' },
    'toggle-history': { label: 'Toggle Actionable History', category: 'Navigation & Workspaces' }
};

let activeKeybinds = { ...DEFAULT_KEYBINDS };
let compiledKeymap = compileKeymap(activeKeybinds);

function normalizeKeyCombination(str) {
    if (!str || typeof str !== 'string') return '';
    const parts = str.split('+').map(p => p.trim()).filter(Boolean);
    let ctrl = false;
    let alt = false;
    let shift = false;
    let meta = false;
    let mainKey = '';

    for (const part of parts) {
        const lower = part.toLowerCase();
        if (lower === 'ctrl' || lower === 'control') ctrl = true;
        else if (lower === 'alt' || lower === 'option') alt = true;
        else if (lower === 'shift') shift = true;
        else if (lower === 'meta' || lower === 'super' || lower === 'cmd' || lower === 'command') meta = true;
        else mainKey = part;
    }

    if (!mainKey) return '';

    const lowerKey = mainKey.toLowerCase();
    let normalized = mainKey;
    if (/^f\d{1,2}$/i.test(mainKey)) normalized = mainKey.toUpperCase();
    else if (lowerKey === 'esc' || lowerKey === 'escape') normalized = 'Escape';
    else if (lowerKey === 'enter' || lowerKey === 'return') normalized = 'Enter';
    else if (lowerKey === 'del' || lowerKey === 'delete') normalized = 'Delete';
    else if (lowerKey === 'tab') normalized = 'Tab';
    else if (lowerKey === 'space') normalized = 'Space';
    else if (mainKey.length === 1) normalized = mainKey.toUpperCase();

    const res = [];
    if (ctrl) res.push('Ctrl');
    if (alt) res.push('Alt');
    if (shift) res.push('Shift');
    if (meta) res.push('Meta');
    res.push(normalized);
    return res.join('+');
}

function inputEventToKeyCombination(input) {
    if (!input || input.type !== 'keyDown') return '';
    const key = input.key;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return '';

    const parts = [];
    if (input.control) parts.push('Ctrl');
    if (input.alt) parts.push('Alt');
    if (input.shift) parts.push('Shift');
    if (input.meta) parts.push('Meta');

    let normalizedKey = key;
    if (/^f\d{1,2}$/i.test(key)) {
        normalizedKey = key.toUpperCase();
    } else if (key.toLowerCase() === 'escape') {
        normalizedKey = 'Escape';
    } else if (key.toLowerCase() === 'enter') {
        normalizedKey = 'Enter';
    } else if (key.toLowerCase() === 'delete') {
        normalizedKey = 'Delete';
    } else if (key.toLowerCase() === 'tab') {
        normalizedKey = 'Tab';
    } else if (key === ' ') {
        normalizedKey = 'Space';
    } else if (input.code && input.code.startsWith('Digit') && input.code.length === 6) {
        normalizedKey = input.code.slice(5);
    } else if (input.code && input.code.startsWith('Key') && input.code.length === 4) {
        normalizedKey = input.code.slice(3).toUpperCase();
    } else if (key.length === 1) {
        normalizedKey = key.toUpperCase();
    }

    parts.push(normalizedKey);
    return parts.join('+');
}

function compileKeymap(binds) {
    const map = new Map();
    for (const [action, binding] of Object.entries(binds)) {
        if (!binding) continue;
        const list = Array.isArray(binding) ? binding : [binding];
        for (const item of list) {
            const normalized = normalizeKeyCombination(item);
            if (normalized) {
                map.set(normalized, action);
            }
        }
    }
    return map;
}

function initializeKeybinds(configDir) {
    const keybindsPath = path.join(configDir, 'keybinds.json');
    try {
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
        if (!fs.existsSync(keybindsPath)) {
            fs.writeFileSync(keybindsPath, JSON.stringify(DEFAULT_KEYBINDS, null, 4), 'utf8');
            activeKeybinds = { ...DEFAULT_KEYBINDS };
        } else {
            const raw = fs.readFileSync(keybindsPath, 'utf8');
            const parsed = JSON.parse(raw);
            activeKeybinds = { ...DEFAULT_KEYBINDS, ...parsed };
        }
    } catch (err) {
        console.error('Failed to initialise keybinds configuration, using defaults:', err);
        activeKeybinds = { ...DEFAULT_KEYBINDS };
    }
    compiledKeymap = compileKeymap(activeKeybinds);
    return activeKeybinds;
}

function saveKeybinds(configDir, newBinds) {
    const keybindsPath = path.join(configDir, 'keybinds.json');
    try {
        activeKeybinds = { ...DEFAULT_KEYBINDS, ...newBinds };
        fs.writeFileSync(keybindsPath, JSON.stringify(activeKeybinds, null, 4), 'utf8');
        compiledKeymap = compileKeymap(activeKeybinds);
        return true;
    } catch (err) {
        console.error('Failed to save keybinds configuration:', err);
        return false;
    }
}

function getActionForInput(input) {
    const combo = inputEventToKeyCombination(input);
    if (!combo) return null;
    return compiledKeymap.get(combo) || null;
}

function getKeybinds() {
    return { ...activeKeybinds };
}

function getActionMetadata() {
    return { ...ACTION_METADATA };
}

module.exports = {
    DEFAULT_KEYBINDS,
    ACTION_METADATA,
    initializeKeybinds,
    saveKeybinds,
    getActionForInput,
    getKeybinds,
    getActionMetadata,
    normalizeKeyCombination,
    inputEventToKeyCombination
};
