// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// --- PRELOAD PRIVATE API EXPOSURE ---
contextBridge.exposeInMainWorld('miseAPI', {
    getSession: () => ipcRenderer.invoke('get-session'),
    saveSession: (sessionData) => ipcRenderer.invoke('save-session', sessionData),
    getWebviewPreloadPath: () => ipcRenderer.sendSync('get-webview-preload-path'),
    readHinterCode: () => ipcRenderer.invoke('read-hinter-code'),
    showContextMenu: (params) => ipcRenderer.send('show-context-menu', params),
    clearDomainCookies: (data) => ipcRenderer.invoke('clear-domain-cookies', data),
    clearActiveCache: (isPrivate) => ipcRenderer.invoke('clear-active-cache', isPrivate),
    executeTerminalCommand: (commandStr) => ipcRenderer.send('execute-terminal-command', commandStr),
    searchHistory: (query) => ipcRenderer.invoke('search-history', query),
    purgeHistory: () => ipcRenderer.invoke('purge-history'),
    setNativeTheme: (mode) => ipcRenderer.send('set-native-theme', mode),
    readNotes: () => ipcRenderer.invoke('read-notes'),
    saveNotes: (content) => ipcRenderer.invoke('save-notes', content),
    onMasterShortcut: (callback) => {
        ipcRenderer.on('master-shortcut', (event, action, ...args) => callback(action, ...args));
    }
});
