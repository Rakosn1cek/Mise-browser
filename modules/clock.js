// modules/clock.js
// Live clock and date controller for status bar and sidebar widgets

import { state } from './state.js';

let clockTimer = null;
let currentClockMode = 'datetime'; // 'datetime' | 'time' | 'seconds'
let isClockEnabled = true;

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export function getClockData(date = new Date()) {
    const dayIndex = date.getDay();
    const dayNum = date.getDate();
    const monthIndex = date.getMonth();
    const year = date.getFullYear();

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    const shortDate = `${DAYS_SHORT[dayIndex]} ${dayNum} ${MONTHS_SHORT[monthIndex]}`;
    const fullDate = `${DAYS_LONG[dayIndex]}, ${dayNum} ${MONTHS_LONG[monthIndex]} ${year}`;
    const shortTime = `${hours}:${minutes}`;
    const fullTime = `${hours}:${minutes}:${seconds}`;

    return {
        shortDate,
        shortTime,
        fullTime,
        tooltip: `${fullDate}, ${fullTime} (Click to switch format)`
    };
}

export function updateClockUI() {
    const data = getClockData();

    // Status bar clock elements
    const statusClockEl = document.getElementById('StatusBarClock');
    const statusDateEl = document.getElementById('StatusBarClockDate');
    const statusTimeEl = document.getElementById('StatusBarClockTime');

    if (statusClockEl) {
        statusClockEl.title = data.tooltip;
        if (statusDateEl) {
            statusDateEl.textContent = (currentClockMode === 'time') ? '' : data.shortDate;
            statusDateEl.style.display = (currentClockMode === 'time') ? 'none' : 'inline-block';
        }
        if (statusTimeEl) {
            statusTimeEl.textContent = (currentClockMode === 'seconds') ? data.fullTime : data.shortTime;
        }
    }

    // Sidebar clock elements
    const sidebarClockEl = document.getElementById('SidebarClock');
    const sidebarDateEl = document.getElementById('SidebarClockDate');
    const sidebarTimeEl = document.getElementById('SidebarClockTime');

    if (sidebarClockEl) {
        sidebarClockEl.title = data.tooltip;
        if (sidebarDateEl) {
            sidebarDateEl.textContent = (currentClockMode === 'time') ? '' : data.shortDate;
            sidebarDateEl.style.display = (currentClockMode === 'time') ? 'none' : 'inline-block';
        }
        if (sidebarTimeEl) {
            sidebarTimeEl.textContent = (currentClockMode === 'seconds') ? data.fullTime : data.shortTime;
        }
    }
}

export function cycleClockFormat() {
    if (currentClockMode === 'datetime') {
        currentClockMode = 'time';
    } else if (currentClockMode === 'time') {
        currentClockMode = 'seconds';
    } else {
        currentClockMode = 'datetime';
    }

    if (window.miseAPI && typeof window.miseAPI.updateBrowserSettings === 'function') {
        window.miseAPI.updateBrowserSettings({ clock_format: currentClockMode }).catch(() => {});
    }

    updateClockUI();
    return currentClockMode;
}

export function setClockVisibility(visible) {
    isClockEnabled = !!visible;
    const statusClockEl = document.getElementById('StatusBarClock');
    const sidebarClockEl = document.getElementById('SidebarClock');

    if (statusClockEl) {
        statusClockEl.style.display = isClockEnabled ? 'inline-flex' : 'none';
    }
    if (sidebarClockEl) {
        sidebarClockEl.style.display = isClockEnabled ? 'flex' : 'none';
    }

    const toggleInput = document.getElementById('setting-clock-toggle');
    if (toggleInput) {
        toggleInput.checked = isClockEnabled;
    }

    if (window.miseAPI && typeof window.miseAPI.updateBrowserSettings === 'function') {
        window.miseAPI.updateBrowserSettings({ show_clock: isClockEnabled }).catch(() => {});
    }

    return isClockEnabled;
}

export function toggleClock(force) {
    if (typeof force === 'boolean') {
        return setClockVisibility(force);
    }
    return setClockVisibility(!isClockEnabled);
}

export function initClock() {
    const statusClockEl = document.getElementById('StatusBarClock');
    const sidebarClockEl = document.getElementById('SidebarClock');

    if (statusClockEl) {
        statusClockEl.addEventListener('click', () => {
            cycleClockFormat();
        });
    }

    if (sidebarClockEl) {
        sidebarClockEl.addEventListener('click', () => {
            cycleClockFormat();
        });
    }

    // Load persisted settings
    if (window.miseAPI && typeof window.miseAPI.getBrowserSettings === 'function') {
        window.miseAPI.getBrowserSettings().then((cfg) => {
            if (cfg) {
                if (typeof cfg.show_clock === 'boolean') {
                    setClockVisibility(cfg.show_clock);
                }
                if (cfg.clock_format && ['datetime', 'time', 'seconds'].includes(cfg.clock_format)) {
                    currentClockMode = cfg.clock_format;
                }
            }
            updateClockUI();
        }).catch(() => {});
    }

    updateClockUI();

    // Start tick aligned to the nearest second
    if (clockTimer) clearInterval(clockTimer);
    const delay = 1000 - (Date.now() % 1000);
    setTimeout(() => {
        updateClockUI();
        clockTimer = setInterval(updateClockUI, 1000);
    }, delay);
}
