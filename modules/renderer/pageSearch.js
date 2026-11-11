import { getActiveWebview, focusActiveWebview } from '../utils.js';
import { mountOverlaySync } from '../templateLoader.js';

export let findActive = false;
let lastSearchQuery = '';
let matchCaseOverride = null;

export function isMatchCaseActive(query = '') {
    if (matchCaseOverride !== null) return matchCaseOverride;
    return /[A-Z]/.test(query || '');
}

export function updateCaseButtonUI(query = '') {
    const caseBtn = document.getElementById('FindCaseBtn');
    if (!caseBtn) return;
    const active = isMatchCaseActive(query);
    caseBtn.classList.toggle('active', active);
}

export function toggleMatchCase() {
    const input = document.getElementById('FindInput');
    const query = (input ? input.value : '') || lastSearchQuery;
    const currentlyActive = isMatchCaseActive(query);
    matchCaseOverride = !currentlyActive;
    updateCaseButtonUI(query);

    if (query && query.trim().length > 0) {
        const activeWv = getActiveWebview();
        if (activeWv) {
            activeWv.findInPage(query, { matchCase: matchCaseOverride });
        }
    }
}

export function formatMatchCount(activeOrdinal = 0, totalMatches = 0, hasQuery = true) {
    if (!hasQuery) return '';
    if (totalMatches === 0) return '0 matches';
    if (totalMatches === 1) return '1 of 1 match';
    const current = activeOrdinal > 0 ? activeOrdinal : 1;
    return `${current} of ${totalMatches} matches`;
}

export function updateFindMatchCount(activeOrdinal = 0, totalMatches = 0) {
    const countEl = document.getElementById('FindMatchCount');
    if (!countEl) return;
    const input = document.getElementById('FindInput');
    const hasQuery = Boolean(input && input.value.trim().length > 0);
    const text = formatMatchCount(activeOrdinal, totalMatches, hasQuery);
    countEl.textContent = text;
    if (hasQuery && totalMatches === 0) {
        countEl.classList.add('no-matches');
    } else {
        countEl.classList.remove('no-matches');
    }
}

export function findInPageNext() {
    navigateFindMatch(true);
}

export function findInPagePrevious() {
    navigateFindMatch(false);
}

function ensureFindOverlayMounted() {
    let overlay = document.getElementById('FindBarOverlay');
    if (!overlay && typeof mountOverlaySync === 'function') {
        overlay = mountOverlaySync('FindBarOverlay', 'find-bar', '#webview-container');
        if (overlay) setupPageSearchListeners();
    }
    return overlay;
}

function navigateFindMatch(forward = true) {
    const activeWv = getActiveWebview();
    if (!activeWv) return;

    const overlay = ensureFindOverlayMounted();
    const input = document.getElementById('FindInput');
    const query = (input ? input.value : '') || lastSearchQuery;
    if (!query || query.trim().length === 0) return;

    lastSearchQuery = query;
    if (input && input.value !== query) {
        input.value = query;
    }

    if (overlay && overlay.style.display !== 'flex') {
        overlay.style.display = 'flex';
        findActive = true;
    }

    const matchCase = isMatchCaseActive(query);
    updateCaseButtonUI(query);
    activeWv.findInPage(query, { forward, findNext: true, matchCase });
}

export function toggleInPageSearch(forceState) {
    const overlay = ensureFindOverlayMounted();
    const input = document.getElementById('FindInput');
    const count = document.getElementById('FindMatchCount');

    if (forceState === undefined && findActive && overlay && overlay.style.display === 'flex' && document.activeElement !== input) {
        if (input) {
            input.focus();
            input.select();
        }
        return;
    }

    findActive = typeof forceState === 'boolean' ? forceState : !findActive;

    if (findActive) {
        if (overlay) overlay.style.display = 'flex';
        if (input) {
            if (lastSearchQuery && !input.value) {
                input.value = lastSearchQuery;
            }
            setTimeout(() => {
                input.focus();
                input.select();
            }, 20);
            updateCaseButtonUI(input.value);
            if (input.value.trim().length > 0) {
                const activeWv = getActiveWebview();
                const matchCase = isMatchCaseActive(input.value);
                if (activeWv) activeWv.findInPage(input.value, { matchCase });
            }
        }
    } else {
        if (overlay) overlay.style.display = 'none';
        matchCaseOverride = null;
        updateCaseButtonUI('');
        const activeWv = getActiveWebview();
        if (activeWv) {
            activeWv.stopFindInPage('clearSelection');
        }
        if (count) {
            count.textContent = '';
            count.classList.remove('no-matches');
        }
        focusActiveWebview();
    }
}

export function setupPageSearchListeners() {
    const overlay = document.getElementById('FindBarOverlay');
    const findInput = document.getElementById('FindInput');
    const caseBtn = document.getElementById('FindCaseBtn');
    const prevBtn = document.getElementById('FindPrevBtn');
    const nextBtn = document.getElementById('FindNextBtn');
    const closeBtn = document.getElementById('FindCloseBtn');

    if (!overlay || overlay.dataset.listenersAttached) return;
    overlay.dataset.listenersAttached = 'true';
    if (findInput) findInput.dataset.listenersAttached = 'true';

    const focusableControls = [findInput, caseBtn, prevBtn, nextBtn, closeBtn].filter(Boolean);

    // Circular keyboard tab trap within Find Bar overlay
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            const first = focusableControls[0];
            const last = focusableControls[focusableControls.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                    if (typeof first.select === 'function') first.select();
                }
            }
        }
    });

    if (findInput) {
        findInput.addEventListener('input', (e) => {
            const text = e.target.value;
            const activeWv = getActiveWebview();
            if (!activeWv) return;

            lastSearchQuery = text;
            const matchCase = isMatchCaseActive(text);
            updateCaseButtonUI(text);

            if (text.length > 0) {
                activeWv.findInPage(text, { matchCase });
            } else {
                activeWv.stopFindInPage('clearSelection');
                const count = document.getElementById('FindMatchCount');
                if (count) {
                    count.textContent = '';
                    count.classList.remove('no-matches');
                }
            }
        });

        findInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                toggleInPageSearch(false);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    findInPagePrevious();
                } else {
                    findInPageNext();
                }
                focusActiveWebview();
            }
        });
    }

    if (caseBtn) {
        caseBtn.addEventListener('click', () => {
            toggleMatchCase();
            focusActiveWebview();
        });
        caseBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleMatchCase();
                focusActiveWebview();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                focusActiveWebview();
            } else if (e.key === 'n') {
                e.preventDefault();
                findInPageNext();
                focusActiveWebview();
            } else if (e.key === 'N') {
                e.preventDefault();
                findInPagePrevious();
                focusActiveWebview();
            }
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            findInPagePrevious();
            focusActiveWebview();
        });
        prevBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                findInPagePrevious();
                focusActiveWebview();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                focusActiveWebview();
            } else if (e.key === 'n') {
                e.preventDefault();
                findInPageNext();
                focusActiveWebview();
            } else if (e.key === 'N') {
                e.preventDefault();
                findInPagePrevious();
                focusActiveWebview();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            findInPageNext();
            focusActiveWebview();
        });
        nextBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                findInPageNext();
                focusActiveWebview();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                focusActiveWebview();
            } else if (e.key === 'n') {
                e.preventDefault();
                findInPageNext();
                focusActiveWebview();
            } else if (e.key === 'N') {
                e.preventDefault();
                findInPagePrevious();
                focusActiveWebview();
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => toggleInPageSearch(false));
        closeBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
                e.preventDefault();
                toggleInPageSearch(false);
            }
        });
    }
}

if (typeof window !== 'undefined') {
    window.toggleInPageSearch = toggleInPageSearch;
    window.findInPageNext = findInPageNext;
    window.findInPagePrevious = findInPagePrevious;
    window.updateFindMatchCount = updateFindMatchCount;
    window.formatMatchCount = formatMatchCount;
    window.isMatchCaseActive = isMatchCaseActive;
    window.toggleMatchCase = toggleMatchCase;
}
