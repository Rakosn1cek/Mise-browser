export const DEFAULT_SEARCH_ENGINES = {
    duckduckgo: 'https://duckduckgo.com/?q=%s',
    google: 'https://www.google.com/search?q=%s',
    startpage: 'https://www.startpage.com/sp/search?query=%s',
    brave: 'https://search.brave.com/search?q=%s',
    kagi: 'https://kagi.com/search?q=%s'
};

export async function initSearchEnginePreference() {
    const select = document.getElementById('SearchEngineSelect');
    if (!select) return;

    try {
        const cfg = await window.miseAPI.getBrowserSettings();
        if (cfg && cfg.search_engine) {
            select.value = cfg.search_engine;
        }
    } catch (err) {
        select.value = DEFAULT_SEARCH_ENGINES.duckduckgo;
    }

    select.addEventListener('change', async (e) => {
        try {
            const currentCfg = await window.miseAPI.getBrowserSettings();
            currentCfg.search_engine = e.target.value;
            // Persist quietly to disk without triggering app.relaunch
            await window.miseAPI.updateBrowserSettings(currentCfg);
        } catch (err) {
            console.error('Failed to update search engine preference:', err);
        }
    });
}

export function formatSearchUrl(query, template) {
    const engineTemplate = template || DEFAULT_SEARCH_ENGINES.duckduckgo;
    return engineTemplate.replace('%s', encodeURIComponent(query));
}
