// Workspace visual identity sanitisation, palette definitions, and badge styling

export const TOKYO_NIGHT_PALETTE = [
    { name: 'Tokyo Blue', hex: '#7aa2f7' },
    { name: 'Cyan', hex: '#7dcfff' },
    { name: 'Emerald', hex: '#9ece6a' },
    { name: 'Amber', hex: '#ff9e64' },
    { name: 'Lavender', hex: '#bb9af7' },
    { name: 'Rose', hex: '#f7768e' },
    { name: 'Teal', hex: '#2ac3de' },
    { name: 'Warm Yellow', hex: '#e0af68' },
    { name: 'Silver', hex: '#a9b1d6' }
];

export const DEFAULT_ACCENT_COLOR = '#7aa2f7';
export const PRIVATE_ACCENT_COLOR = '#f7768e';

// Validate hex colour string rejecting CSS injection and script payloads
export function validateAccentColor(colorStr) {
    if (!colorStr || typeof colorStr !== 'string') return DEFAULT_ACCENT_COLOR;
    const trimmed = colorStr.trim();
    const hexRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
    if (!hexRegex.test(trimmed)) return DEFAULT_ACCENT_COLOR;
    return trimmed.toLowerCase();
}

// Fallback abbreviation generator for workspaces lacking a custom glyph
export function getFallbackGlyph(wsName) {
    if (!wsName || typeof wsName !== 'string') return '1';
    const match = wsName.match(/(\d+)$/);
    if (match) {
        const num = match[1];
        const prefix = wsName.trim()[0].toUpperCase();
        return num.length <= 2 ? (wsName.length <= 3 ? wsName : `${prefix}${num}`) : num.slice(0, 2);
    }
    return wsName.slice(0, 2).toUpperCase();
}

// Sanitise glyph input, strip control chars and bidirectional overrides, enforce single grapheme cluster
export function sanitizeGlyph(glyphStr, fallbackWsName = '') {
    if (!glyphStr || typeof glyphStr !== 'string') {
        return getFallbackGlyph(fallbackWsName);
    }
    
    // Normalise Unicode and strip control codes plus bidirectional override sequences
    const cleaned = glyphStr
        .normalize('NFC')
        .replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
        .trim();

    if (!cleaned) {
        return getFallbackGlyph(fallbackWsName);
    }

    // Extract strictly one visual grapheme cluster using Intl.Segmenter
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
        const iterator = segmenter.segment(cleaned)[Symbol.iterator]();
        const first = iterator.next();
        if (first && !first.done && first.value && first.value.segment) {
            return first.value.segment;
        }
    }

    // Fallback: array segmentation for basic emoji and surrogate pair preservation
    const chars = Array.from(cleaned);
    return chars.length > 0 ? chars[0] : getFallbackGlyph(fallbackWsName);
}

// Resolve full visual identity for a given workspace name
export function resolveWorkspaceVisual(wsName, sessionState) {
    const isPrivate = !wsName || wsName === 'Private' || String(wsName).trim().toLowerCase() === 'private';
    if (isPrivate) {
        return {
            color: PRIVATE_ACCENT_COLOR,
            glyph: 'PR'
        };
    }

    const visuals = sessionState && sessionState.workspace_visuals;
    const entry = visuals && typeof visuals === 'object' ? visuals[wsName] : null;

    if (entry && typeof entry === 'object') {
        const color = validateAccentColor(entry.color);
        const glyph = sanitizeGlyph(entry.glyph, wsName);
        return { color, glyph };
    }

    return {
        color: DEFAULT_ACCENT_COLOR,
        glyph: getFallbackGlyph(wsName)
    };
}

// Safely apply visual identity to the DOM badge element
export function applyWorkspaceVisuals(wsName, badgeEl, isPrivate = false, sessionState = null) {
    if (!badgeEl) return;
    const visual = resolveWorkspaceVisual(wsName, sessionState);

    // XSS guard: strictly use textContent
    badgeEl.textContent = isPrivate ? 'PR' : visual.glyph;

    if (isPrivate) {
        badgeEl.style.borderColor = PRIVATE_ACCENT_COLOR;
        badgeEl.style.color = PRIVATE_ACCENT_COLOR;
        badgeEl.style.backgroundColor = 'color-mix(in srgb, #f7768e 18%, #16161e)';
        return;
    }

    badgeEl.style.borderColor = visual.color;
    badgeEl.style.color = visual.color;
    badgeEl.style.backgroundColor = `color-mix(in srgb, ${visual.color} 18%, #16161e)`;
}
