// modules/webview/audioManager.js
// Audio detection, tab muting, global media controls, and indicator badges

import { state } from '../state.js';
import { setTargetUrl } from '../statusBar.js';

export function toggleGlobalMediaPlayback() {
    Object.values(state.activeViewsCache).forEach(workspaceViews => {
        workspaceViews.forEach(wv => {
            if (wv && typeof wv.executeJavaScript === 'function') {
                wv.executeJavaScript(`
                    (function() {
                        try {
                            const mediaElements = Array.from(document.querySelectorAll('video, audio'));
                            if (mediaElements.length === 0) return false;
                            
                            const hasPlaying = mediaElements.some(m => !m.paused && !m.ended && m.readyState > 2);
                            
                            mediaElements.forEach(m => {
                                if (hasPlaying) {
                                    m.pause();
                                } else {
                                    m.play().catch(() => {});
                                }
                            });
                            return true;
                        } catch (e) { return false; }
                    })();
                `, false).catch(() => {});
            }
        });
    });
    if (typeof setTargetUrl === 'function') {
        setTargetUrl('Toggled global media playback', 2000);
    }
}

export function toggleTabAudioMute(workspaceId, tabIdx) {
    const ws = workspaceId || state.sessionState.current_workspace;
    const views = state.activeViewsCache[ws];
    if (!views || !views[tabIdx]) return;

    const wv = views[tabIdx];
    if (!wv || typeof wv.setAudioMuted !== 'function') return;

    if (!state.tabAudioMuted[ws]) state.tabAudioMuted[ws] = [];
    const currentlyMuted = typeof wv.isAudioMuted === 'function' ? wv.isAudioMuted() : !!state.tabAudioMuted[ws][tabIdx];
    const newMutedState = !currentlyMuted;

    wv.setAudioMuted(newMutedState);
    state.tabAudioMuted[ws][tabIdx] = newMutedState;

    const isAudible = state.tabMediaAudible[ws]?.[tabIdx] || false;
    updateTabMediaIndicator(ws, tabIdx, isAudible, newMutedState);

    const title = state.activeTitlesCache[ws]?.[tabIdx] || 'Tab';
    const statusMsg = newMutedState ? `Muted audio: ${title}` : `Unmuted audio: ${title}`;
    if (typeof setTargetUrl === 'function') {
        setTargetUrl(statusMsg, 2500);
    }
}

export function toggleActiveTabAudioMute() {
    const currentWS = state.sessionState.current_workspace;
    const activeListItem = document.querySelector('#TabList li.selected');
    if (!activeListItem) return;
    const tabIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(activeListItem);
    if (tabIdx >= 0) {
        toggleTabAudioMute(currentWS, tabIdx);
    }
}

export function toggleGlobalAudioMute() {
    let anyUnmuted = false;
    Object.entries(state.activeViewsCache).forEach(([wsName, views]) => {
        views.forEach((wv) => {
            if (wv && typeof wv.isAudioMuted === 'function') {
                if (!wv.isAudioMuted()) {
                    anyUnmuted = true;
                }
            }
        });
    });

    const targetMuted = anyUnmuted;

    Object.entries(state.activeViewsCache).forEach(([wsName, views]) => {
        if (!state.tabAudioMuted[wsName]) state.tabAudioMuted[wsName] = [];
        views.forEach((wv, idx) => {
            if (wv && typeof wv.setAudioMuted === 'function') {
                wv.setAudioMuted(targetMuted);
                state.tabAudioMuted[wsName][idx] = targetMuted;
                const isAudible = state.tabMediaAudible[wsName]?.[idx] || false;
                updateTabMediaIndicator(wsName, idx, isAudible, targetMuted);
            }
        });
    });

    const statusMsg = targetMuted ? 'Muted audio globally across all tabs' : 'Unmuted audio globally across all tabs';
    if (typeof setTargetUrl === 'function') {
        setTargetUrl(statusMsg, 2500);
    }
}

export function updateTabMediaIndicator(workspaceId, tabIdx, isAudible, isMutedOverride) {
    if (state.sessionState.current_workspace !== workspaceId) return;

    const tabList = document.querySelectorAll('#TabList li');
    const targetLi = tabList[tabIdx];
    if (!targetLi) return;

    let mediaBadge = targetLi.querySelector('.tab-media-badge');
    const isMuted = isMutedOverride !== undefined ? isMutedOverride : !!state.tabAudioMuted[workspaceId]?.[tabIdx];

    if (isAudible || isMuted) {
        if (!mediaBadge) {
            mediaBadge = document.createElement('span');
            mediaBadge.className = 'tab-media-badge' + (isMuted ? ' is-muted' : '');
            const shieldBtn = targetLi.querySelector('.tab-shield-btn');
            if (shieldBtn) {
                targetLi.insertBefore(mediaBadge, shieldBtn);
            } else {
                targetLi.appendChild(mediaBadge);
            }
        } else {
            mediaBadge.className = 'tab-media-badge' + (isMuted ? ' is-muted' : '');
        }

        mediaBadge.title = isMuted ? 'Tab audio muted (click to unmute)' : 'Tab playing audio (click to mute)';
        mediaBadge.innerHTML = isMuted ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';

        if (!mediaBadge.__muteListenerAttached) {
            mediaBadge.__muteListenerAttached = true;
            mediaBadge.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentWS = state.sessionState.current_workspace;
                const liveIdx = Array.from(document.querySelectorAll('#TabList li')).indexOf(targetLi);
                if (liveIdx >= 0) {
                    toggleTabAudioMute(currentWS, liveIdx);
                }
            });
        }
    } else {
        if (mediaBadge) {
            mediaBadge.remove();
        }
    }
}
