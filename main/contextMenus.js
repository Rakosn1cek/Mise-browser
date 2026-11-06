const path = require('path');
const fs = require('fs');
const { Menu, MenuItem, shell, clipboard } = require('electron');
const config = require('./config');
const {
    CONFIG_DIR,
    loadBrowserConfig,
    saveBrowserConfig,
    updateBrowserConfig,
    restartApp,
    buildEmailComposeUrl
} = config;
const security = require('../security');

let getMainWindowFn = () => null;

function setMainWindowGetter(fn) {
    if (typeof fn === 'function') {
        getMainWindowFn = fn;
    }
}

function resolveWindow(options) {
    if (options && typeof options.getMainWindow === 'function') {
        return options.getMainWindow();
    }
    return getMainWindowFn();
}

function buildSettingsSubmenu(cfg, options = {}) {
    return [
        {
            label: 'Disable GPU Hardware Acceleration',
            type: 'checkbox',
            checked: cfg.disable_gpu,
            click: (menuItem) => {
                saveBrowserConfig({ disable_gpu: menuItem.checked });
            }
        },
        {
            label: 'Enable Background Throttling',
            type: 'checkbox',
            checked: cfg.background_throttling,
            click: (menuItem) => {
                saveBrowserConfig({ background_throttling: menuItem.checked });
            }
        },
        { type: 'separator' },
        {
            label: 'Renderer Process Limit',
            submenu: [1, 2, 3, 4, 5].map(num => ({
                label: `Limit to ${num} process${num === 1 ? '' : 'es'}`,
                type: 'radio',
                checked: cfg.process_limit === num,
                click: () => {
                    saveBrowserConfig({ process_limit: num });
                }
            }))
        },
        { type: 'separator' },
        {
            label: 'Tab Hibernation (Sleep Timeout)',
            submenu: [
                { minutes: 5, label: '5 minutes' },
                { minutes: 15, label: '15 minutes (Default)' },
                { minutes: 30, label: '30 minutes' },
                { minutes: 60, label: '1 hour' },
                { minutes: 0, label: 'Never (Disabled)' }
            ].map(opt => ({
                label: opt.label,
                type: 'radio',
                checked: (cfg.tab_sleep_timeout_minutes ?? 15) === opt.minutes,
                click: () => {
                    updateBrowserConfig({ tab_sleep_timeout_minutes: opt.minutes });
                }
            }))
        },
        { type: 'separator' },
        {
            label: 'Auto-Collapse Sidebar (36px Strip)',
            type: 'checkbox',
            checked: cfg.sidebar_auto_collapse !== false,
            click: (menuItem) => {
                updateBrowserConfig({ sidebar_auto_collapse: menuItem.checked });
                const win = resolveWindow(options);
                if (win && !win.isDestroyed()) {
                    win.webContents.send('master-shortcut', 'toggle-sidebar-collapse-mode', menuItem.checked);
                }
            }
        },
        {
            label: 'Window Controls (Sidebar)',
            type: 'checkbox',
            checked: !!cfg.show_window_controls,
            click: (menuItem) => {
                updateBrowserConfig({ show_window_controls: menuItem.checked });
                const win = resolveWindow(options);
                if (win && !win.isDestroyed()) {
                    win.webContents.send('master-shortcut', 'toggle-window-controls', menuItem.checked);
                }
            }
        },
        { type: 'separator' },
        {
            label: 'WebRTC IP Handling & Leak Protection',
            submenu: [
                { policy: 'default_public_interface_only', label: 'Balanced: Hide Local LAN IPs (Default)' },
                { policy: 'disable_non_proxied_udp', label: 'Strict: Block Non-Proxied UDP (Proxy / VPN)' },
                { policy: 'disabled', label: 'Disabled: Neutralise WebRTC APIs' },
                { policy: 'default', label: 'Permissive: Standard Chromium' }
            ].map(opt => ({
                label: opt.label,
                type: 'radio',
                checked: (cfg.webrtc_policy || 'default_public_interface_only') === opt.policy,
                click: () => {
                    updateBrowserConfig({ webrtc_policy: opt.policy });
                    const win = resolveWindow(options);
                    if (win && !win.isDestroyed()) {
                        win.webContents.send('master-shortcut', 'webrtc-policy-changed', opt.policy);
                    }
                }
            }))
        },
        { type: 'separator' },
        {
            label: 'Open User Scripts Directory',
            click: () => {
                const sDir = path.join(CONFIG_DIR, 'scripts');
                if (!fs.existsSync(sDir)) fs.mkdirSync(sDir, { recursive: true });
                shell.openPath(sDir);
            }
        },
        {
            label: 'Open User Styles Directory',
            click: () => {
                const stDir = path.join(CONFIG_DIR, 'styles');
                if (!fs.existsSync(stDir)) fs.mkdirSync(stDir, { recursive: true });
                shell.openPath(stDir);
            }
        },
        {
            label: 'Open Full Preferences Overlay',
            accelerator: 'Ctrl+H',
            click: () => {
                const win = resolveWindow(options);
                if (win && !win.isDestroyed()) {
                    win.webContents.send('master-shortcut', 'toggle-help');
                }
            }
        },
        {
            label: 'Restart Browser Now',
            click: () => restartApp()
        }
    ];
}

function openSettingsMenu(targetWindow) {
    const win = targetWindow || getMainWindowFn();
    if (!win || win.isDestroyed()) return;
    const cfg = loadBrowserConfig();
    const menu = Menu.buildFromTemplate(buildSettingsSubmenu(cfg, { getMainWindow: () => win }));
    menu.popup({ window: win, x: 14, y: 14 });
}

function buildWebviewContextMenu(params, webContents, options = {}) {
    const resolveWindowLocal = () => {
        if (options && typeof options.getMainWindow === 'function') {
            return options.getMainWindow();
        }
        return getMainWindowFn();
    };

    const menu = new Menu();

    const openShareModal = (url) => {
        const win = resolveWindowLocal();
        if (win && win.webContents) {
            win.webContents.send('master-shortcut', 'open-transient-share', url);
        }
    };

    const openLinkTab = (url) => {
        const win = resolveWindowLocal();
        if (security.isSafeTabUrl(url) && win && win.webContents) {
            win.webContents.send('master-shortcut', 'spawn-tab-with-url', url);
        }
    };

    const openLinkInSplit = (url) => {
        const win = resolveWindowLocal();
        if (security.isSafeTabUrl(url) && win && win.webContents) {
            win.webContents.send('master-shortcut', 'open-link-in-split', url);
        }
    };

    const saveSelectionToNotes = (selectionText, sourceUrl, pageTitle) => {
        const win = resolveWindowLocal();
        if (win && win.webContents) {
            win.webContents.send('master-shortcut', 'save-selection-to-notes', {
                text: selectionText,
                url: sourceUrl,
                title: pageTitle
            });
        }
    };

    const targetUrl = params.linkURL || params.srcURL || params.pageURL || webContents.getURL();
    const targetText = params.selectionText ? params.selectionText.trim() : webContents.getTitle();
    
    const encodedUrl = encodeURIComponent(targetUrl || '');
    const encodedText = encodeURIComponent(targetText || '');

    if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
        params.dictionarySuggestions.forEach(suggestion => {
            menu.append(new MenuItem({
                label: suggestion,
                click: () => webContents.replaceMisspelling(suggestion)
            }));
        });
        menu.append(new MenuItem({ type: 'separator' }));
    }

    if (params.selectionText && params.selectionText.trim() !== '') {
        const selectedText = params.selectionText.trim();
        const pageTitle = webContents.getTitle() || 'Web clipping';
        const currentUrl = params.pageURL || webContents.getURL() || '';

        menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
        menu.append(new MenuItem({
            label: 'Save to Notes',
            click: () => {
                saveSelectionToNotes(selectedText, currentUrl, pageTitle);
            }
        }));
    }
    
    if (params.linkURL && params.linkURL.trim() !== '') {
        menu.append(new MenuItem({
            label: 'Open Link in New Tab',
            click: () => openLinkTab(params.linkURL)
        }));
        menu.append(new MenuItem({
            label: 'Open Link in Split View',
            click: () => openLinkInSplit(params.linkURL)
        }));
        menu.append(new MenuItem({
            label: 'Copy Link Address',
            click: () => {
                clipboard.writeText(params.linkURL);
            }
        }));
    }

    if (params.isEditable) {
        menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
        menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
        menu.append(new MenuItem({ label: 'Select All', role: 'selectall' }));
    }

    if (params.mediaType === 'image') {
        menu.append(new MenuItem({
            label: 'Save Image As...',
            click: () => {
                const win = resolveWindowLocal();
                if (win && win.webContents) {
                    win.webContents.downloadURL(params.srcURL);
                }
            }
        }));
        menu.append(new MenuItem({
            label: 'Copy Image Address',
            click: () => { 
                clipboard.writeText(params.srcURL); 
            }
        }));
    }

    if (menu.items.length === 0) {
        menu.append(new MenuItem({ label: 'Back', click: () => { webContents.send('master-shortcut', 'go-back-signal'); } }));
        menu.append(new MenuItem({ label: 'Forward', click: () => { webContents.send('master-shortcut', 'go-forward-signal'); } }));
        menu.append(new MenuItem({ label: 'Reload', click: () => { webContents.reload(); } }));
    }

    if (menu.items.length > 0) {
        menu.append(new MenuItem({ type: 'separator' }));
    }

    const shareSubmenu = new Menu();
    shareSubmenu.append(new MenuItem({
        label: 'Share to WhatsApp',
        click: () => openShareModal(`https://web.whatsapp.com/send?text=${encodedText}%20${encodedUrl}`)
    }));
    shareSubmenu.append(new MenuItem({
        label: 'Share to X (Twitter)',
        click: () => openShareModal(`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`)
    }));
    shareSubmenu.append(new MenuItem({
        label: 'Share to Telegram',
        click: () => openShareModal(`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`)
    }));
    shareSubmenu.append(new MenuItem({
        label: 'Share to Reddit',
        click: () => openShareModal(`https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`)
    }));

    shareSubmenu.append(new MenuItem({
        label: 'Share via Email',
        click: () => {
            const cfg = loadBrowserConfig();
            const handler = cfg.email_handler || 'system';

            const pageTitle = webContents.getTitle() || 'Shared link';
            const currentUrl = params.pageURL || webContents.getURL() || '';
            const selectedSnippet = params.selectionText ? params.selectionText.trim() : '';
            const imageSrc = params.srcURL || '';

            let emailSubject = pageTitle;
            let emailBody = '';

            if (selectedSnippet) {
                emailSubject = `Snippet from: ${pageTitle}`;
                emailBody = `${selectedSnippet}\n\nSource: ${currentUrl}`;
                clipboard.writeText(selectedSnippet);
            } else if (imageSrc) {
                emailSubject = `Image from: ${pageTitle}`;
                emailBody = `${imageSrc}\n\nPage: ${currentUrl}`;
            } else {
                emailSubject = pageTitle;
                emailBody = currentUrl;
            }

            const encSubject = encodeURIComponent(emailSubject);
            const encBody = encodeURIComponent(emailBody);

            if (handler === 'system') {
                const mailto = `mailto:?subject=${encSubject}&body=${encBody}`;
                shell.openExternal(mailto).catch(() => {
                    const fallbackUrl = buildEmailComposeUrl('https://mail.google.com/mail/?view=cm&fs=1&to=%t&su=%s&body=%b', {
                        to: '',
                        subject: emailSubject,
                        body: emailBody
                    });
                    openShareModal(fallbackUrl);
                });
            } else {
                const composeUrl = buildEmailComposeUrl(handler, {
                    to: '',
                    subject: emailSubject,
                    body: emailBody
                });
                if (composeUrl) {
                    openShareModal(composeUrl);
                }
            }
        }
    }));

    shareSubmenu.append(new MenuItem({ type: 'separator' }));
    shareSubmenu.append(new MenuItem({
        label: 'Copy Markdown Link',
        click: () => {
            const md = `[${targetText || targetUrl}](${targetUrl})`;
            clipboard.writeText(md);
        }
    }));

    menu.append(new MenuItem({
        label: 'Share...',
        submenu: shareSubmenu
    }));

    return menu;
}

function showWebviewContextMenu(contextEvent, params, webContents, options = {}) {
    if (contextEvent && typeof contextEvent.preventDefault === 'function') {
        contextEvent.preventDefault();
    }
    const win = resolveWindow(options);
    const menu = buildWebviewContextMenu(params, webContents, { getMainWindow: () => win });
    if (win && !win.isDestroyed()) {
        menu.popup({ window: win });
    }
}

module.exports = {
    buildSettingsSubmenu,
    openSettingsMenu,
    buildWebviewContextMenu,
    showWebviewContextMenu,
    setMainWindowGetter
};
