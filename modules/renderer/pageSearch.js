import { getActiveWebview, focusActiveWebview } from '../utils.js';

export let findActive = false;

export function toggleInPageSearch() {
    const overlay = document.getElementById('FindBarOverlay');
    const input = document.getElementById('FindInput');
    const count = document.getElementById('FindMatchCount');

    findActive = !findActive;

    if (findActive) {
        if (overlay) overlay.style.display = 'flex';
        if (input) {
            input.value = '';
            setTimeout(() => {
                input.focus();
                input.select();
            }, 20);
        }
        if (count) count.textContent = '';
    } else {
        if (overlay) overlay.style.display = 'none';
        const activeWv = getActiveWebview();
        if (activeWv) {
            activeWv.stopFindInPage('clearSelection');
        }
        focusActiveWebview();
    }
}

export function setupPageSearchListeners() {
    const findInput = document.getElementById('FindInput');
    if (!findInput) return;

    findInput.addEventListener('input', (e) => {
        const text = e.target.value;
        const activeWv = getActiveWebview();
        if (!activeWv) return;

        if (text.length > 0) {
            activeWv.findInPage(text);
        } else {
            activeWv.stopFindInPage('clearSelection');
            const count = document.getElementById('FindMatchCount');
            if (count) count.textContent = '';
        }
    });

    findInput.addEventListener('keydown', (e) => {
        const activeWv = getActiveWebview();
        const isCtrl = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();

        if (e.key === 'Escape' || (isCtrl && key === 's')) {
            e.preventDefault();
            toggleInPageSearch();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (!activeWv) return;
            activeWv.findInPage(findInput.value, { forward: !e.shiftKey, findNext: true });
        }
    });
}
