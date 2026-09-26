import { state } from './state.js';
import { escapeHtml, focusActiveWebview, getActiveWebview } from './utils.js';
import { renderWorkspaceUI, switchTabFocus, spawnTabWithUrl, spawnNewBlankTab, handleTabRemoval, wakeTab } from './webview.js';
import { formatSearchUrl } from './overlays/searchEngine.js';

export function displayAddressOverlay() {
    const addressBar = document.getElementById('WideAddressBar');
    if (addressBar.style.display === 'block') {
        addressBar.style.display = 'none';
        hideSuggestions();
    } else {
        const currentWS = state.sessionState.current_workspace;
        const activeListItem = document.querySelector('#TabList li.selected');
        if (activeListItem) {
            const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
            if (state.sessionState.workspaces[currentWS] && state.sessionState.workspaces[currentWS][currentIdx]) {
                addressBar.value = state.sessionState.workspaces[currentWS][currentIdx];
            }
        }
        
        addressBar.style.display = 'block';
        
        requestAnimationFrame(() => {
            addressBar.focus();
            addressBar.select();
        });
    }
}

export async function handleNavigation(input) {
    if (!input) return;
    
    const trimmedInput = input.trim();

    if (trimmedInput.toLowerCase().startsWith('ws:') || trimmedInput.toLowerCase().startsWith('ws ')) {
        const targetWs = trimmedInput.replace(/^ws[:\s]+/i, '').trim();
        const availableWorkspaces = Object.keys(state.sessionState.workspaces);
        const matchedWs = availableWorkspaces.find(ws => ws.toLowerCase() === targetWs.toLowerCase());

        if (matchedWs) {
            state.sessionState.current_workspace = matchedWs;
            window.miseAPI.saveSession(state.sessionState);
            renderWorkspaceUI(0);
        } else {
            alert(`Workspace "${targetWs}" does not exist.`);
        }

        hideSuggestions();
        document.getElementById('WideAddressBar').style.display = 'none';
        return;
    }

    const parts = trimmedInput.split(' ');
    const alias = parts[0].toLowerCase();
    const query = parts.slice(1).join(' ');

    const aliases = {
        'g': 'https://www.google.com/search?q=',
        'yt': 'https://www.youtube.com/results?search_query=',
        'a': 'https://wiki.archlinux.org/index.php?search=',
        'gh': 'https://github.com/search?q=',
        'ddg': 'https://duckduckgo.com/?q=',
        'pkg': 'https://archlinux.org/packages/?q=',
        'so': 'https://stackoverflow.com/search?q=',
        'r': 'https://www.reddit.com/search/?q=',
        'sp': 'https://www.startpage.com/sp/search?query=',
        'b': 'https://search.brave.com/search?q=',
        'k': 'https://kagi.com/search?q='
    };

    let targetUrl;

    if (aliases[alias] && query) {
        targetUrl = aliases[alias] + encodeURIComponent(query);
    } else {
        targetUrl = trimmedInput;
        if (!trimmedInput.startsWith('http://') && !trimmedInput.startsWith('https://')) {
            if (trimmedInput.includes('.') && !trimmedInput.includes(' ')) {
                targetUrl = `https://${trimmedInput}`;
            } else {
                let searchTemplate = 'https://duckduckgo.com/?q=%s';
                if (window.miseAPI && typeof window.miseAPI.getBrowserSettings === 'function') {
                    try {
                        const cfg = await window.miseAPI.getBrowserSettings();
                        if (cfg && cfg.search_engine) {
                            searchTemplate = cfg.search_engine;
                        }
                    } catch (e) {}
                }
                targetUrl = formatSearchUrl(trimmedInput, searchTemplate);
            }
        }
    }

    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;

    const currentIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);

    state.sessionState.workspaces[currentWS][currentIdx] = targetUrl;
    window.miseAPI.saveSession(state.sessionState);

    if (state.activeViewsCache[currentWS] && state.activeViewsCache[currentWS][currentIdx]) {
        state.activeViewsCache[currentWS][currentIdx].setAttribute('src', targetUrl);
    } else {
        wakeTab(currentWS, currentIdx);
    }

    hideSuggestions();
    document.getElementById('WideAddressBar').style.display = 'none';
}

export function setupAddressBarAutocomplete() {
    const addressBar = document.getElementById('WideAddressBar');
    const suggestionsList = document.getElementById('AddressSuggestions');

    if (!addressBar || !suggestionsList) return;

    addressBar.addEventListener('input', async (e) => {
        const query = e.target.value.trim();
        if (!query) {
            hideSuggestions();
            return;
        }

        if (query.toLowerCase().startsWith('ws ')) {
            const wsQuery = query.slice(3).toLowerCase();
            const matchingWorkspaces = Object.keys(state.sessionState.workspaces)
                .filter(ws => ws.toLowerCase().includes(wsQuery))
                .map(ws => ({ title: `Switch to Workspace: ${ws}`, value: `ws:${ws}`, type: 'Workspace' }));

            renderSuggestions(matchingWorkspaces);
            return;
        }

        const matches = [];

        Object.keys(state.sessionState.workspaces).forEach(wsName => {
            state.sessionState.workspaces[wsName].forEach((url, idx) => {
                const title = (state.activeTitlesCache[wsName] && state.activeTitlesCache[wsName][idx]) || url;
                if (title.toLowerCase().includes(query.toLowerCase()) || url.toLowerCase().includes(query.toLowerCase())) {
                    matches.push({ title: `${title} (${wsName})`, value: url, type: 'Tab' });
                }
            });
        });

        if (window.miseAPI && typeof window.miseAPI.searchHistory === 'function') {
            try {
                const historyMatches = await window.miseAPI.searchHistory(query);
                historyMatches.slice(0, 5).forEach(item => {
                    matches.push({ title: item.title, value: item.url, type: 'History' });
                });
            } catch (err) {}
        }

        state.bookmarks.forEach(bm => {
            if (bm.title.toLowerCase().includes(query.toLowerCase()) || bm.url.toLowerCase().includes(query.toLowerCase())) {
                matches.push({ title: bm.title, value: bm.url, type: 'Bookmark' });
            }
        });

        renderSuggestions(matches);
    });

    addressBar.addEventListener('keydown', (e) => {
        if (suggestionsList.style.display === 'none') return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (state.addressSuggestions.length > 0) {
                state.addressSelectionIdx = (state.addressSelectionIdx + 1) % state.addressSuggestions.length;
                updateSuggestionHighlight();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (state.addressSuggestions.length > 0) {
                state.addressSelectionIdx = (state.addressSelectionIdx - 1 + state.addressSuggestions.length) % state.addressSuggestions.length;
                updateSuggestionHighlight();
            }
        } else if (e.key === 'Tab') {
            e.preventDefault();
            if (state.addressSelectionIdx >= 0 && state.addressSuggestions[state.addressSelectionIdx]) {
                addressBar.value = state.addressSuggestions[state.addressSelectionIdx].value;
            }
        }
    });
}

export function renderSuggestions(items) {
    const suggestionsList = document.getElementById('AddressSuggestions');
    suggestionsList.innerHTML = '';
    state.addressSuggestions = items;
    state.addressSelectionIdx = -1;

    if (items.length === 0) {
        hideSuggestions();
        return;
    }

    items.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'suggestion-item';
        li.innerHTML = `<span>${escapeHtml(item.title)}</span><span class="suggestion-type">${item.type}</span>`;
        
        li.addEventListener('click', () => {
            selectSuggestion(item);
        });

        suggestionsList.appendChild(li);
    });

    suggestionsList.style.display = 'block';
}

export function updateSuggestionHighlight() {
    const items = document.querySelectorAll('#AddressSuggestions .suggestion-item');
    items.forEach((item, idx) => {
        if (idx === state.addressSelectionIdx) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
            if (state.addressSuggestions[idx]) {
                document.getElementById('WideAddressBar').value = state.addressSuggestions[idx].value;
            }
        } else {
            item.classList.remove('selected');
        }
    });
}

export function selectSuggestion(item) {
    if (item.value.startsWith('ws:')) {
        const targetWs = item.value.split('ws:')[1];
        state.sessionState.current_workspace = targetWs;
        window.miseAPI.saveSession(state.sessionState);
        renderWorkspaceUI(0);
    } else {
        handleNavigation(item.value);
    }
    hideSuggestions();
}

export function hideSuggestions() {
    const suggestionsList = document.getElementById('AddressSuggestions');
    if (suggestionsList) suggestionsList.style.display = 'none';
    state.addressSuggestions = [];
    state.addressSelectionIdx = -1;
}
