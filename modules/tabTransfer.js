// modules/tabTransfer.js
// Safe tab state migration between workspaces preserving container partition boundaries

export function transferTab(state, source, index, target, requestedIndex) {
    const workspaces = state.sessionState.workspaces;
    if (
        source === target ||
        !Object.hasOwn(workspaces, source) ||
        !Object.hasOwn(workspaces, target) ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= workspaces[source].length
    ) {
        return null;
    }

    const sourceCount = workspaces[source].length;
    const targetCount = workspaces[target].length;

    const fields = [
        ['activeViewsCache', null],
        ['activeTitlesCache', '', 'tab_titles'],
        ['tabSleepStates', null, 'tab_sleep_states'],
        ['tabActivityTimestamps', 0],
        ['tabMediaAudible', false],
        ['tabAudioMuted', false],
        ['tabPinned', false, 'tab_pinned'],
        ['tabFavicons', null, 'tab_favicons'],
        ['tabDarkReaderStates', false, 'tab_dark_reader']
    ];

    for (const [field, , persisted] of fields) {
        state[field] ||= (persisted && state.sessionState[persisted]) || {};
        if (persisted) {
            state.sessionState[persisted] = state[field];
        }
    }

    const pinned = !!state.tabPinned[source]?.[index];
    const pinnedCount = workspaces[target].filter((_, i) => state.tabPinned[target]?.[i]).length;
    const proposed = Number.isInteger(requestedIndex)
        ? Math.max(0, Math.min(targetCount, requestedIndex))
        : targetCount;
    const destination = pinned ? Math.min(proposed, pinnedCount) : Math.max(proposed, pinnedCount);

    const [url] = workspaces[source].splice(index, 1);
    workspaces[target].splice(destination, 0, url);

    for (const [field, fallback] of fields) {
        const table = state[field];
        table[source] ||= [];
        table[target] ||= [];
        while (table[source].length < sourceCount) table[source].push(fallback);
        while (table[target].length < targetCount) table[target].push(fallback);

        const [value] = table[source].splice(index, 1);
        if (field === 'activeViewsCache' && value) {
            // Live webviews must release focus, halt network streams, and unmount cleanly
            if (value.ownerDocument?.activeElement === value) {
                if (typeof value.blur === 'function') value.blur();
            }
            if (value.__miseAbortController) {
                try { value.__miseAbortController.abort(); } catch (e) {}
                value.__miseAbortController = null;
            }
            if (typeof value.setAudioMuted === 'function') {
                try { value.setAudioMuted(true); } catch (e) {}
            }
            if (typeof value.stop === 'function') {
                try { value.stop(); } catch (e) {}
            }
            try { value.src = 'about:blank'; } catch (e) {}
            if (typeof value.remove === 'function') {
                value.remove();
            }
        }
        table[target].splice(destination, 0, field === 'activeViewsCache' ? null : value);
    }

    if (state.tabHistory?.[source]) {
        state.tabHistory[source] = state.tabHistory[source]
            .filter(i => i !== index)
            .map(i => (i > index ? i - 1 : i));
    }
    if (state.tabHistory?.[target]) {
        state.tabHistory[target] = state.tabHistory[target]
            .map(i => (i >= destination ? i + 1 : i));
    }

    if (state.sessionState?.active_tabs) {
        const sourceActive = state.sessionState.active_tabs[source];
        if (typeof sourceActive === 'number') {
            if (sourceActive > index) {
                state.sessionState.active_tabs[source] = sourceActive - 1;
            } else if (sourceActive === index) {
                state.sessionState.active_tabs[source] = Math.max(0, Math.min(sourceActive, workspaces[source].length - 1));
            }
        }
        const targetActive = state.sessionState.active_tabs[target];
        if (typeof targetActive === 'number' && targetActive >= destination) {
            state.sessionState.active_tabs[target] = targetActive + 1;
        }
    }

    const sourceSplit = state.splitStates?.[source];
    if (sourceSplit) {
        if (sourceSplit.primaryIdx === index || sourceSplit.secondaryIdx === index) {
            delete state.splitStates[source];
        } else {
            for (const pane of ['primaryIdx', 'secondaryIdx']) {
                if (sourceSplit[pane] > index) sourceSplit[pane] -= 1;
            }
        }
    }

    const targetSplit = state.splitStates?.[target];
    if (targetSplit) {
        for (const pane of ['primaryIdx', 'secondaryIdx']) {
            if (targetSplit[pane] >= destination) targetSplit[pane]++;
        }
    }

    return destination;
}
