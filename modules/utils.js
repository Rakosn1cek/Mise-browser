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

// Validates whether a workspace name is reserved by the browser system
export function isReservedWorkspaceName(workspaceName) {
    if (!workspaceName || typeof workspaceName !== 'string') return false;
    return workspaceName.trim().toLowerCase() === 'private';
}

// Generates a filesystem-safe persistent container partition string for a workspace
export function getWorkspacePartition(workspaceName) {
    if (!workspaceName) return 'persist:default';
    if (String(workspaceName).trim().toLowerCase() === 'private') return 'MisePrivateProfile';
    const clean = String(workspaceName).trim().toLowerCase().replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return `persist:${clean || 'default'}`;
}

export function isPdfUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const parsed = new URL(url);
        return parsed.pathname.toLowerCase().endsWith('.pdf');
    } catch (e) {
        const clean = url.split('?')[0].split('#')[0];
        return clean.toLowerCase().endsWith('.pdf');
    }
}

export function getPdfViewerUrl(targetUrl) {
    if (!targetUrl || typeof targetUrl !== 'string') return targetUrl;
    if (typeof window.miseAPI?.getPdfViewerUrl === 'function') {
        return window.miseAPI.getPdfViewerUrl(targetUrl);
    }
    if (typeof window.miseAPI?.getPdfViewerPath === 'function') {
        const viewerHtml = window.miseAPI.getPdfViewerPath();
        if (targetUrl.startsWith(viewerHtml)) return targetUrl;
        return `${viewerHtml}?file=${encodeURIComponent(targetUrl)}`;
    }
    return targetUrl;
}

export function extractOriginalUrl(url) {
    if (!url || typeof url !== 'string') return url || '';
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'file:') {
            let localViewerPath = '';
            if (typeof window !== 'undefined' && typeof window.miseAPI?.getPdfViewerPath === 'function') {
                const raw = window.miseAPI.getPdfViewerPath();
                if (typeof raw === 'string') {
                    localViewerPath = raw.startsWith('file:') ? new URL(raw).pathname : raw;
                }
            }
            if (localViewerPath && parsed.pathname === localViewerPath) {
                const fileParam = parsed.searchParams.get('file');
                if (fileParam) return fileParam;
            }
        }
    } catch (e) {}
    return url;
}

// Validates whether a given URL belongs to a target domain or its subdomains
export function isMatchingDomain(url, targetDomain) {
    if (!url || typeof url !== 'string' || !targetDomain) return false;
    try {
        const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(url) ? url : `https://${url}`;
        const host = new URL(candidate).hostname.toLowerCase();
        const target = targetDomain.toLowerCase();
        return host === target || host.endsWith(`.${target}`);
    } catch (e) {
        return false;
    }
}

// Checks whether a URL matches domains designated for isolated private sessions
export function isTargetPrivateDomain(_url) {
    return false;
}

// Validates whether a tab URL has a safe web scheme (http or https) and valid length
export function isSafeTabUrl(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 16384) return false;
    try {
        const p = new URL(url);
        return p.protocol === 'http:' || p.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

// Validates whether a tab URL is persistable (http, https, or file scheme)
export function isPersistableTabUrl(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 16384) return false;
    try {
        const p = new URL(url);
        return p.protocol === 'http:' || p.protocol === 'https:' || p.protocol === 'file:';
    } catch (e) {
        return false;
    }
}

// Displays a transient visual notification toast at the bottom of the viewport
export function showNotificationToast(message, icon = 'fa-shield-halved') {
    if (typeof document === 'undefined') return;
    let toast = document.getElementById('MiseToastNotification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'MiseToastNotification';
        toast.className = 'mise-toast-notification';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHtml(message)}</span>`;
    toast.classList.add('visible');
    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.classList.remove('visible');
    }, 3200);
}

// Recognised terminal executables and shell tools
export const COMMON_TERMINAL_COMMANDS = [
    'sudo', 'pacman', 'yay', 'paru', 'apt', 'apt-get', 'dnf', 'zypper', 'apk',
    'systemctl', 'journalctl', 'hyprctl',
    'git', 'cargo', 'npm', 'pnpm', 'yarn', 'bun', 'deno', 'rustc', 'python', 'python3', 'pip', 'pip3',
    'make', 'cmake', 'ninja', 'gcc', 'clang',
    'btop', 'htop', 'top', 'nvtop', 'neofetch', 'fastfetch',
    'docker', 'podman', 'kubectl',
    'cat', 'grep', 'rg', 'sed', 'awk', 'find', 'chmod', 'chown', 'kill', 'pkill', 'killall',
    'ssh', 'scp', 'rsync', 'tar', 'unzip', 'zip', 'curl', 'wget',
    'ping', 'traceroute', 'ip', 'ifconfig', 'netstat', 'ss',
    'ls', 'cd', 'pwd', 'mkdir', 'rm', 'cp', 'mv', 'touch', 'clear', 'man', 'echo'
];

// Checks whether an input string represents a terminal or shell execution
export function isTerminalCommand(inputText) {
    if (!inputText || typeof inputText !== 'string') return false;
    const trimmed = inputText.trim();
    if (!trimmed) return false;

    // Explicit command prefix indicators ($ or >)
    if (trimmed.startsWith('$') || trimmed.startsWith('>')) return true;

    const lower = trimmed.toLowerCase();
    if (lower.startsWith(':sh ') || lower.startsWith(':term ')) return true;
    if (lower.startsWith('term ') || lower.startsWith('terminal ')) return true;
    if (lower.startsWith('oversight ') || lower.startsWith('oversight:')) return true;

    // High-risk system calls that trigger the Oversight protocol
    if (lower.startsWith('sudo ') || lower.startsWith('curl ') || lower.startsWith('wget ')) return true;

    // Relative script paths
    if (trimmed.startsWith('./') || trimmed.startsWith('../')) return true;

    // Executable script files (avoid web URLs and absolute file paths handled by local file guard)
    if (!lower.startsWith('http://') && !lower.startsWith('https://') && !trimmed.startsWith('/')) {
        const cleanPath = trimmed.split('?')[0].split('#')[0].toLowerCase();
        if (SCRIPT_EXTENSIONS.some(ext => cleanPath.endsWith(ext))) {
            return true;
        }
    }

    // CLI-only utilities
    const firstWord = lower.split(/[\s=]+/)[0];
    const cliOnly = ['btop', 'htop', 'nvtop', 'neofetch', 'fastfetch'];
    if (cliOnly.includes(firstWord)) return true;

    // Multi-token commands matching known terminal utilities
    if (COMMON_TERMINAL_COMMANDS.includes(firstWord) && trimmed.includes(' ')) {
        return true;
    }

    return false;
}

// Prepares a command string for clipboard staging with optional Oversight scanning
export function prepareTerminalCommand(rawInputText) {
    if (!rawInputText || typeof rawInputText !== 'string') return '';
    let cleanCommand = rawInputText.trim();
    if (cleanCommand.startsWith('$') || cleanCommand.startsWith('>')) {
        cleanCommand = cleanCommand.slice(1).trim();
    } else if (/^:sh\s+/i.test(cleanCommand)) {
        cleanCommand = cleanCommand.replace(/^:sh\s+/i, '').trim();
    } else if (/^:(term|terminal)\s+/i.test(cleanCommand)) {
        cleanCommand = cleanCommand.replace(/^:(term|terminal)\s+/i, '').trim();
    } else if (/^(term|terminal)\s+/i.test(cleanCommand)) {
        cleanCommand = cleanCommand.replace(/^(term|terminal)\s+/i, '').trim();
    }

    if (!cleanCommand) return '';

    let finalCommandToCopy = cleanCommand;
    const lowerInput = cleanCommand.toLowerCase();
    const isRawWebUrl = lowerInput.startsWith('http://') || lowerInput.startsWith('https://');
    const isDangerousSysCall = lowerInput.startsWith('sudo ') || lowerInput.startsWith('curl ') || lowerInput.startsWith('wget ');

    if ((isTargetScript(cleanCommand) || isRawWebUrl || isDangerousSysCall) && !lowerInput.startsWith('oversight ') && !lowerInput.startsWith('oversight:')) {
        finalCommandToCopy = `oversight ${cleanCommand}`;
    }

    return finalCommandToCopy;
}


