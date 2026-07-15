const { ipcRenderer } = require('electron');

// ==========================================
// PRE-EXISTING WEBVIEW KEYBOARD BUBBLING
// ==========================================
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
