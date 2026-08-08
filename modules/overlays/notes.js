import { state } from '../state.js';
import { escapeHtml, focusActiveWebview } from '../utils.js';

let notesSaveTimeout = null;

// Simple inline markdown parser helper
export function parseMarkdownToHtml(text) {
    if (!text) return '';
    
    let html = escapeHtml(text);

    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');

    html = html.replace(/^\&gt\; (.*$)/gim, '<blockquote>$1</blockquote>');
    html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');
    html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');

    html = html.replace(/\n/g, '<br>');

    return html;
}

export function renderNotesView() {
    const textarea = document.getElementById('NotesTextArea');
    const mdView = document.getElementById('NotesMarkdownView');
    const editBtn = document.getElementById('ToggleEditNotesBtn');

    if (!textarea || !mdView) return;

    if (state.isEditingNotes) {
        textarea.style.display = 'block';
        mdView.style.display = 'none';
        if (editBtn) editBtn.textContent = 'Preview';
        setTimeout(() => textarea.focus(), 50);
    } else {
        mdView.innerHTML = parseMarkdownToHtml(textarea.value);
        textarea.style.display = 'none';
        mdView.style.display = 'block';
        if (editBtn) editBtn.textContent = 'Edit';
    }
}

export function toggleNotesOverlay() {
    const overlay = document.getElementById('NotesOverlay');
    const textarea = document.getElementById('NotesTextArea');

    if (!overlay || !textarea) return;

    state.notesActive = !state.notesActive;

    if (state.notesActive) {
        if (state.paletteActive && typeof window.toggleCommandPaletteView === 'function') {
            window.toggleCommandPaletteView();
        }
        if (state.helpActive && typeof window.toggleHelpMenuWindow === 'function') {
            window.toggleHelpMenuWindow();
        }
        if (state.dashboardActive && typeof window.toggleDashboardView === 'function') {
            window.toggleDashboardView();
        }
        if (state.historyActive && typeof window.toggleHistoryOverlay === 'function') {
            window.toggleHistoryOverlay();
        }

        if (window.miseAPI && typeof window.miseAPI.readNotes === 'function') {
            window.miseAPI.readNotes().then((content) => {
                textarea.value = content || '';
                state.isEditingNotes = false;
                renderNotesView();
                overlay.style.display = 'flex';
            }).catch((err) => {
                console.error("Failed to load notes:", err);
                overlay.style.display = 'flex';
            });
        } else {
            overlay.style.display = 'flex';
        }
    } else {
        if (window.miseAPI && typeof window.miseAPI.saveNotes === 'function') {
            window.miseAPI.saveNotes(textarea.value);
        }
        overlay.style.display = 'none';
        focusActiveWebview();
    }
}

export function setupNotesListeners() {
    const textarea = document.getElementById('NotesTextArea');
    const closeBtn = document.getElementById('CloseNotesBtn');
    const editBtn = document.getElementById('ToggleEditNotesBtn');

    if (editBtn) {
        editBtn.addEventListener('click', () => {
            state.isEditingNotes = !state.isEditingNotes;
            renderNotesView();
        });
    }

    if (textarea) {
        textarea.addEventListener('input', (e) => {
            clearTimeout(notesSaveTimeout);
            notesSaveTimeout = setTimeout(() => {
                if (window.miseAPI && typeof window.miseAPI.saveNotes === 'function') {
                    window.miseAPI.saveNotes(e.target.value);
                }
            }, 300);
        });

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                toggleNotesOverlay();
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', toggleNotesOverlay);
    }
}
