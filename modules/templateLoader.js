// modules/templateLoader.js
// Safe on-demand template loader and mounting orchestrator for interface overlays
// Designed for fast cold-boot performance and DOM memory optimisation

/**
 * Whitelist of registered overlay templates to prevent directory traversal.
 */
export const REGISTERED_TEMPLATES = Object.freeze({
    'command-palette': 'templates/command-palette.html',
    'preferences': 'templates/preferences.html',
    'dashboard': 'templates/dashboard.html',
    'bookmarks': 'templates/bookmarks.html',
    'diagnostics': 'templates/diagnostics.html',
    'history': 'templates/history.html',
    'notes': 'templates/notes.html',
    'share-modal': 'templates/share-modal.html',
    'peek-modal': 'templates/peek-modal.html',
    'find-bar': 'templates/find-bar.html'
});

/**
 * In-memory cache storing loaded template HTML markup strings.
 */
const templateCache = new Map();

/**
 * Registry tracking initialisation status per overlay to ensure one-time listener binding.
 */
const initialisedOverlays = new Set();

/**
 * Checks whether an overlay element is currently present in the active document.
 * @param {string} overlayId Element ID to query
 * @returns {boolean} True if present in the DOM
 */
export function isOverlayMounted(overlayId) {
    if (typeof document === 'undefined') return false;
    return !!document.getElementById(overlayId);
}

/**
 * Loads template HTML markup asynchronously with memory caching and path validation.
 * @param {string} templateKey Key identifier matching REGISTERED_TEMPLATES
 * @returns {Promise<string|null>} Template HTML markup string or null on failure
 */
export async function loadTemplate(templateKey) {
    if (!templateKey) return null;

    if (templateCache.has(templateKey)) {
        return templateCache.get(templateKey);
    }

    const relativePath = REGISTERED_TEMPLATES[templateKey];
    if (!relativePath) {
        console.warn(`[TemplateLoader] Unrecognised template key: ${templateKey}`);
        return null;
    }

    try {
        const response = await fetch(relativePath);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} loading ${relativePath}`);
        }
        const markup = await response.text();
        templateCache.set(templateKey, markup);
        return markup;
    } catch (err) {
        console.error(`[TemplateLoader] Failed to load template (${templateKey}):`, err);
        return null;
    }
}

/**
 * Mounts an overlay template into the specified container element.
 * Idempotent: returns existing element immediately if already mounted.
 * @param {string} overlayId Expected DOM ID of the root overlay element
 * @param {string} templateKey Key identifier matching REGISTERED_TEMPLATES
 * @param {string} targetSelector Target container selector (e.g. #webview-container or body)
 * @returns {Promise<HTMLElement|null>} Mounted DOM element or null on error
 */
export async function mountOverlayTemplate(overlayId, templateKey, targetSelector = '#webview-container') {
    if (typeof document === 'undefined') return null;

    const existing = document.getElementById(overlayId);
    if (existing) {
        return existing;
    }

    const markup = await loadTemplate(templateKey);
    if (!markup) return null;

    // Standard HTML template element for safe inert parsing
    const templateEl = document.createElement('template');
    templateEl.innerHTML = markup.trim();

    const overlayElement = templateEl.content.firstElementChild;
    if (!overlayElement) {
        console.error(`[TemplateLoader] Template (${templateKey}) contained no root element`);
        return null;
    }

    const container = document.querySelector(targetSelector) || document.body;
    container.appendChild(overlayElement);

    return overlayElement;
}

/**
 * Mounts an overlay template synchronously if its markup is already cached in memory.
 * @param {string} overlayId Expected DOM ID of the root overlay element
 * @param {string} templateKey Key identifier matching REGISTERED_TEMPLATES
 * @param {string} targetSelector Target container selector
 * @returns {HTMLElement|null} Mounted DOM element or null
 */
export function mountOverlaySync(overlayId, templateKey, targetSelector = '#webview-container') {
    if (typeof document === 'undefined') return null;

    const existing = document.getElementById(overlayId);
    if (existing) {
        return existing;
    }

    const markup = templateCache.get(templateKey);
    if (!markup) return null;

    const templateEl = document.createElement('template');
    templateEl.innerHTML = markup.trim();

    const overlayElement = templateEl.content.firstElementChild;
    if (!overlayElement) return null;

    const container = document.querySelector(targetSelector) || document.body;
    container.appendChild(overlayElement);
    return overlayElement;
}

/**
 * Ensures an overlay is mounted and executes a one-time initialisation callback.
 * @param {string} overlayId Expected DOM ID of the root overlay element
 * @param {string} templateKey Key identifier matching REGISTERED_TEMPLATES
 * @param {string} targetSelector Target container selector
 * @param {Function} [initCallback] Optional setup function executed once upon initial mounting
 * @returns {Promise<HTMLElement|null>} Mounted DOM element or null
 */
export async function ensureOverlayMounted(overlayId, templateKey, targetSelector = '#webview-container', initCallback = null) {
    const element = await mountOverlayTemplate(overlayId, templateKey, targetSelector);
    if (!element) return null;

    if (initCallback && typeof initCallback === 'function' && !initialisedOverlays.has(overlayId)) {
        try {
            initCallback(element);
        } catch (setupErr) {
            console.error(`[TemplateLoader] Error initialising overlay ${overlayId}:`, setupErr);
        }
        initialisedOverlays.add(overlayId);
    }

    return element;
}

/**
 * Warms the template memory cache during browser idle time to ensure instant interaction.
 * @param {Array<string>} [keys] Optional list of keys to preload; defaults to all registered templates
 */
export function preloadTemplates(keys = null) {
    if (typeof window === 'undefined') return;

    const targetKeys = Array.isArray(keys) ? keys : Object.keys(REGISTERED_TEMPLATES);
    const executePreload = async () => {
        for (const key of targetKeys) {
            if (!templateCache.has(key)) {
                await loadTemplate(key);
            }
        }
    };

    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => { executePreload().catch(() => {}); });
    } else {
        setTimeout(() => { executePreload().catch(() => {}); }, 150);
    }
}

/**
 * Clears cached template strings and initialisation sets (useful for test harnesses).
 */
export function resetTemplateCache() {
    templateCache.clear();
    initialisedOverlays.clear();
}
