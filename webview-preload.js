const { ipcRenderer } = require('electron');

window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    
    const linkElement = e.target.closest('a');
    
    // Construct structural attributes regarding the cursor collision spot coordinates
    const params = {
        selectionText: window.getSelection().toString(),
        isEditable: e.target.matches('input, textarea, [contenteditable="true"]'),
        mediaType: e.target.tagName.toLowerCase() === 'img' ? 'image' : 'none',
        srcURL: e.target.src || '',
        linkURL: linkElement ? linkElement.href : ''
    };
    
    ipcRenderer.send('bubble-webview-key', 'handle-context-menu-data');
    // Send structural properties straight down the channel line
    ipcRenderer.send('show-context-menu', params);
});

window.addEventListener('keydown', (e) => {
    if (e.ctrlKey) {
        const key = e.key.toLowerCase();
        
        if (key === 'm') {
            ipcRenderer.send('bubble-webview-key', 'focus-sidebar');
        } else if (key === 'b') {
            ipcRenderer.send('bubble-webview-key', 'focus-webview');
        } else if (key === 'f') {
            ipcRenderer.send('bubble-webview-key', 'trigger-hints');
        } else if (key === 't') {
            ipcRenderer.send('bubble-webview-key', 'spawn-tab');
        } else if (key === 'l') {
            ipcRenderer.send('bubble-webview-key', 'toggle-address');
        } else if (key === 'd') {
            ipcRenderer.send('bubble-webview-key', 'remove-tab');
        } else if (key === 'p') {
            ipcRenderer.send('bubble-webview-key', 'toggle-palette');
        } else if (key === 'h') {
            ipcRenderer.send('bubble-webview-key', 'toggle-help');
        }
    }
});
