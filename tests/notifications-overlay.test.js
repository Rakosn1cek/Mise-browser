// tests/notifications-overlay.test.js
// Automated verification for Milestone 2: Notifications & Activity Overlay

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise Notifications & Activity Overlay regression tests...');

(async () => {
    // 1. Template Verification
    {
        const tplPath = path.join(__dirname, '../templates/notifications.html');
        assert(fs.existsSync(tplPath), 'templates/notifications.html must exist on disk');
        const content = fs.readFileSync(tplPath, 'utf8');

        assert(content.includes('id="NotificationsOverlay"'), 'Template must define root #NotificationsOverlay');
        assert(content.includes('id="NotificationsFeed"'), 'Template must include #NotificationsFeed');
        assert(content.includes('id="NotificationsEmptyState"'), 'Template must include #NotificationsEmptyState');
        assert(content.includes('id="ClearNotificationsBtn"'), 'Template must include #ClearNotificationsBtn');
        assert(content.includes('id="CloseNotificationsBtn"'), 'Template must include #CloseNotificationsBtn');
        assert(content.includes('data-filter="all"'), 'Template must include All filter chip');
        assert(content.includes('data-filter="downloads"'), 'Template must include Downloads filter chip');
        assert(content.includes('data-filter="system"'), 'Template must include System filter chip');
        assert(content.includes('data-filter="web"'), 'Template must include Web filter chip');
        assert(content.includes('class="notifications-footer"'), 'Template must include footer shortcut legends');

        const loaderPath = path.join(__dirname, '../modules/templateLoader.js');
        const loaderSource = fs.readFileSync(loaderPath, 'utf8');
        assert(
            loaderSource.includes("'notifications': 'templates/notifications.html'"),
            'modules/templateLoader.js must register notifications template in REGISTERED_TEMPLATES'
        );

        console.log('✓ Modular template structure and templateLoader registration verified');
    }

    // 2. Styling and Theme Aggregation Verification
    {
        const cssPath = path.join(__dirname, '../styles/overlays/notifications.css');
        assert(fs.existsSync(cssPath), 'styles/overlays/notifications.css must exist on disk');
        const cssContent = fs.readFileSync(cssPath, 'utf8');

        assert(cssContent.includes('#NotificationsOverlay'), 'CSS must define #NotificationsOverlay selector');
        assert(cssContent.includes('.notifications-card'), 'CSS must define .notifications-card');
        assert(cssContent.includes('.notifications-filter-chip'), 'CSS must define .notifications-filter-chip');
        assert(cssContent.includes('.notifications-filter-chip:focus'), 'CSS must define focus state for filter chips');
        assert(
            cssContent.includes('.notifications-filter-chip:focus,') && cssContent.includes('outline: none;'),
            'Filter chips must enforce outline: none on focus'
        );
        assert(cssContent.includes('.notification-item'), 'CSS must define .notification-item');
        assert(cssContent.includes('body.light-mode'), 'CSS must define light mode overrides');

        const overlaysAggregator = fs.readFileSync(path.join(__dirname, '../styles/overlays.css'), 'utf8');
        assert(
            overlaysAggregator.includes("@import './overlays/notifications.css';"),
            'styles/overlays.css must import ./overlays/notifications.css'
        );

        console.log('✓ Tokyo Night styling, light mode rules, and overlay aggregation verified');
    }

    // 3. Keybindings and Command Palette Verification
    {
        const keybinds = require('../keybinds.js');
        const defaults = keybinds.DEFAULT_KEYBINDS;
        assert.equal(defaults['toggle-notifications'], 'Ctrl+Shift+N', 'Default keybind for toggle-notifications must be Ctrl+Shift+N');

        const metadata = keybinds.getActionMetadata();
        assert(metadata['toggle-notifications'], 'toggle-notifications must be registered in ACTION_METADATA');
        assert.equal(typeof metadata['toggle-notifications'].label, 'string');

        // Strict Alt modifier guard
        Object.entries(defaults).forEach(([act, bind]) => {
            const list = Array.isArray(bind) ? bind : [bind];
            list.forEach((b) => {
                assert(!b.toLowerCase().includes('alt'), `Action "${act}" binding "${b}" must not use Alt modifier`);
            });
        });

        const paletteSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/commandPalette.js'), 'utf8');
        assert(paletteSource.includes("id: 'toggle-notifications'"), 'Command Palette must define toggle-notifications');
        assert(paletteSource.includes("shortcut: 'Ctrl+Shift+N'"), 'Command Palette must show Ctrl+Shift+N shortcut');
        assert(!paletteSource.includes("shortcut: ['Ctrl+Shift+N', 'Ctrl+Tab']"), 'focus-nav-buttons in Command Palette must not retain Ctrl+Shift+N chord');

        const prefSource = fs.readFileSync(path.join(__dirname, '../templates/preferences.html'), 'utf8');
        assert(
            prefSource.includes('data-action="toggle-notifications"'),
            'templates/preferences.html [Help & Shortcut Reference] must include data-action="toggle-notifications"'
        );
        assert(
            prefSource.includes('<kbd class="shortcut-badge">Ctrl + Shift + N</kbd></span></div>'),
            'templates/preferences.html must display Ctrl + Shift + N for notifications'
        );
        assert(
            prefSource.includes('data-action="focus-nav-buttons"><span class="shortcut-desc">Focus Navigation Buttons</span><span class="shortcut-key"><kbd class="shortcut-badge">Ctrl + Tab</kbd></span></div>'),
            'templates/preferences.html must reflect updated focus-nav-buttons shortcut Ctrl + Tab'
        );
        assert(
            prefSource.includes('<span class="shortcut-desc">Toggle Notifications & Activity</span><span class="shortcut-key"><kbd class="shortcut-badge">Bell Icon</kbd></span>'),
            'templates/preferences.html must include sidebar bell shortcut row'
        );

        console.log('✓ Keybinding registry, Command Palette, and Preferences [Help & Shortcut Reference] verified');
    }

    // 4. Activity Buffer Ingestion, Circular Capping, and Filtering
    {
        // Setup minimal mock browser environment for module loading
        class MockElement {
            constructor(id = '', tagName = 'div') {
                this.id = id;
                this.tagName = tagName.toUpperCase();
                this.style = {};
                this.classList = {
                    classes: new Set(),
                    add: (c) => this.classList.classes.add(c),
                    remove: (c) => this.classList.classes.delete(c),
                    contains: (c) => this.classList.classes.has(c),
                    toggle: (c, force) => {
                        if (force === undefined) {
                            if (this.classList.classes.has(c)) this.classList.classes.delete(c);
                            else this.classList.classes.add(c);
                        } else if (force) {
                            this.classList.classes.add(c);
                        } else {
                            this.classList.classes.delete(c);
                        }
                    }
                };
                this.children = [];
                this.innerHTML = '';
                this.value = '';
                this._listeners = {};
            }
            addEventListener(event, fn) {
                if (!this._listeners[event]) this._listeners[event] = [];
                this._listeners[event].push(fn);
            }
            removeEventListener(event, fn) {
                if (!this._listeners[event]) return;
                this._listeners[event] = this._listeners[event].filter((cb) => cb !== fn);
            }
            focus() {
                global.document.activeElement = this;
            }
            scrollIntoView() {}
            setAttribute(k, v) { this[k] = v; }
            getAttribute(k) { return this[k] || null; }
            appendChild(child) { this.children.push(child); }
            querySelectorAll() { return []; }
            querySelector() { return null; }
            dispatchEvent(event) {
                const handlers = this._listeners[event.type] || [];
                handlers.forEach((fn) => fn(event));
            }
        }

        const chips = [
            new MockElement('chip-all', 'button'),
            new MockElement('chip-downloads', 'button'),
            new MockElement('chip-system', 'button'),
            new MockElement('chip-web', 'button')
        ];
        chips[0].dataset = { filter: 'all' };
        chips[0].classList.add('notifications-filter-chip');
        chips[0].classList.add('active');
        chips[1].dataset = { filter: 'downloads' };
        chips[1].classList.add('notifications-filter-chip');
        chips[2].dataset = { filter: 'system' };
        chips[2].classList.add('notifications-filter-chip');
        chips[3].dataset = { filter: 'web' };
        chips[3].classList.add('notifications-filter-chip');

        const overlayMock = new MockElement('NotificationsOverlay');
        overlayMock.querySelectorAll = (sel) => {
            if (sel.includes('.notifications-filter-chip')) {
                return chips;
            }
            if (sel.includes('button')) {
                return [
                    elements['ClearNotificationsBtn'],
                    elements['CloseNotificationsBtn'],
                    ...chips
                ];
            }
            return [];
        };
        overlayMock.querySelector = (sel) => {
            if (sel.includes('.notifications-filter-chip')) {
                for (const c of chips) {
                    if (sel.includes(`[data-filter="${c.dataset.filter}"]`)) return c;
                }
                return chips[0];
            }
            if (sel.includes('.notifications-filter-strip')) {
                return new MockElement('strip', 'div');
            }
            return null;
        };

        const elements = {
            'NotificationsOverlay': overlayMock,
            'NotificationsFeed': new MockElement('NotificationsFeed'),
            'NotificationsEmptyState': new MockElement('NotificationsEmptyState'),
            'NotificationsCountBadge': new MockElement('NotificationsCountBadge', 'span'),
            'ClearNotificationsBtn': new MockElement('ClearNotificationsBtn', 'button'),
            'CloseNotificationsBtn': new MockElement('CloseNotificationsBtn', 'button'),
            'noti-toggle-btn': new MockElement('noti-toggle-btn', 'button'),
            'webview-container': new MockElement('webview-container'),
            'TabList': new MockElement('TabList')
        };

        global.document = {
            readyState: 'complete',
            activeElement: null,
            getElementById: (id) => elements[id] || null,
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: (tag) => new MockElement('', tag),
            addEventListener: () => {},
            removeEventListener: () => {}
        };

        global.window = {
            addEventListener: () => {},
            removeEventListener: () => {},
            miseAPI: {
                openDownload: () => {},
                openExternal: () => {}
            }
        };

        const notiModule = await import('../modules/overlays/notifications.js');

        notiModule.resetNotificationState();

        // Test normalisation and ingestion
        const item1 = notiModule.addNotificationItem({
            category: 'downloads',
            title: 'Sample File.zip',
            message: 'Download complete',
            details: '14.2 MB'
        });
        assert.equal(item1.category, 'downloads');
        assert.equal(item1.title, 'Sample File.zip');
        assert.equal(item1.unread, true);

        // Test bounded circular buffer capping at 50
        for (let i = 0; i < 65; i++) {
            notiModule.addNotificationItem({
                category: i % 2 === 0 ? 'downloads' : 'system',
                title: `Event ${i}`,
                message: `Message details for ${i}`
            });
        }

        const allFeed = notiModule.getNotificationFeed('all');
        assert.equal(allFeed.length, 50, 'Activity feed buffer must be strictly capped at 50 items');
        assert.equal(allFeed[0].title, 'Event 64', 'Most recent event must reside at head of feed');

        // Test category filtering
        const downloadFeed = notiModule.getNotificationFeed('downloads');
        const systemFeed = notiModule.getNotificationFeed('system');
        assert(downloadFeed.length > 0, 'Downloads feed must contain ingested items');
        assert(systemFeed.length > 0, 'System feed must contain ingested items');
        downloadFeed.forEach((item) => assert.equal(item.category, 'downloads'));
        systemFeed.forEach((item) => assert.equal(item.category, 'system'));

        // Test item in-place updating (e.g. for progressive download lifecycle)
        notiModule.addNotificationItem({
            id: 'dl-progress-test',
            category: 'downloads',
            title: 'Kernel.iso',
            message: 'Downloading...',
            state: 'progress'
        });
        const initialCount = notiModule.getNotificationFeed('all').length;
        notiModule.addNotificationItem({
            id: 'dl-progress-test',
            category: 'downloads',
            title: 'Kernel.iso',
            message: 'Finished',
            state: 'completed'
        });
        const afterCount = notiModule.getNotificationFeed('all').length;
        assert.equal(initialCount, afterCount, 'Same ID must update in-place without adding duplicate entries');
        const updatedItem = notiModule.getNotificationFeed('all').find((n) => n.id === 'dl-progress-test');
        assert.equal(updatedItem.state, 'completed');

        // Test dismissal
        const dismissed = notiModule.dismissNotificationItem('dl-progress-test');
        assert.equal(dismissed, true, 'Target item must be cleanly dismissed');
        const afterDismiss = notiModule.getNotificationFeed('all').find((n) => n.id === 'dl-progress-test');
        assert.equal(afterDismiss, undefined, 'Dismissed item must no longer exist in feed');

        // Test category clear
        notiModule.setNotificationFilter('downloads');
        notiModule.clearNotifications('downloads');
        const remainingDownloads = notiModule.getNotificationFeed('downloads');
        assert.equal(remainingDownloads.length, 0, 'All downloads must be purged in active view');
        const remainingSystem = notiModule.getNotificationFeed('system');
        assert(remainingSystem.length > 0, 'System notifications must remain untouched when clearing downloads');

        // Test global clear
        notiModule.clearNotifications('all');
        assert.equal(notiModule.getNotificationFeed('all').length, 0, 'Global clear must empty buffer');

        console.log('✓ Bounded circular buffer (50 items), in-place updates, category filtering, and purges verified');
    }

    // 5. Keyboard Navigation, Selection, and Action Dispatch
    {
        const notiModule = await import('../modules/overlays/notifications.js');
        notiModule.resetNotificationState();

        let actionInvoked = false;
        notiModule.addNotificationItem({
            id: 'action-test-1',
            category: 'system',
            title: 'Action Item 1',
            message: 'Press Enter to execute',
            action: () => { actionInvoked = true; }
        });
        notiModule.addNotificationItem({
            id: 'action-test-2',
            category: 'system',
            title: 'Action Item 2',
            message: 'Item 2'
        });

        // Test selection index bounds and clamping
        assert.equal(notiModule.getSelectedIndex(), 0);
        notiModule.setSelectedIndex(1);
        assert.equal(notiModule.getSelectedIndex(), 1);
        notiModule.setSelectedIndex(100);
        assert.equal(notiModule.getSelectedIndex(), 1, 'Index must clamp to list boundary');

        // Test action triggering
        notiModule.setSelectedIndex(1); // Points to Action Item 1 (since it was added first and item 2 was unshifted)
        notiModule.triggerSelectedAction();
        assert.equal(actionInvoked, true, 'Primary action of selected notification must be executed');

        // Test item dismissal via keyboard helper
        notiModule.setSelectedIndex(0);
        const itemBefore = notiModule.getNotificationFeed('all')[0];
        notiModule.dismissSelectedNotification();
        const itemAfter = notiModule.getNotificationFeed('all')[0];
        assert.notEqual(itemBefore.id, itemAfter ? itemAfter.id : null, 'Highlighted item must be dismissed');

        // Test category filter cycling logic
        assert.equal(notiModule.getNotificationFilter(), 'all');
        notiModule.cycleNotificationFilter(1);
        assert.equal(notiModule.getNotificationFilter(), 'downloads');
        notiModule.cycleNotificationFilter(1);
        assert.equal(notiModule.getNotificationFilter(), 'system');
        notiModule.cycleNotificationFilter(1);
        assert.equal(notiModule.getNotificationFilter(), 'web');
        notiModule.cycleNotificationFilter(1);
        assert.equal(notiModule.getNotificationFilter(), 'all', 'Cycle forward must wrap back to head');
        notiModule.cycleNotificationFilter(-1);
        assert.equal(notiModule.getNotificationFilter(), 'web', 'Cycle backward must wrap to tail');

        // Test overlay keyboard event routing for category navigation
        const overlay = document.getElementById('NotificationsOverlay');
        notiModule.setupNotificationsListeners(overlay);

        // ArrowRight / ArrowLeft
        overlay.dispatchEvent({ type: 'keydown', key: 'ArrowRight', preventDefault: () => {}, stopPropagation: () => {} });
        assert.equal(notiModule.getNotificationFilter(), 'all', 'ArrowRight from web must wrap to all');
        overlay.dispatchEvent({ type: 'keydown', key: 'ArrowLeft', preventDefault: () => {}, stopPropagation: () => {} });
        assert.equal(notiModule.getNotificationFilter(), 'web', 'ArrowLeft from all must wrap to web');

        // Vim h / l
        overlay.dispatchEvent({ type: 'keydown', key: 'l', preventDefault: () => {}, stopPropagation: () => {} });
        assert.equal(notiModule.getNotificationFilter(), 'all', 'Vim l must cycle to next filter');
        overlay.dispatchEvent({ type: 'keydown', key: 'h', preventDefault: () => {}, stopPropagation: () => {} });
        assert.equal(notiModule.getNotificationFilter(), 'web', 'Vim h must cycle to previous filter');

        // Direct number keys: 1=all, 2=downloads, 3=system, 4=web
        overlay.dispatchEvent({ type: 'keydown', key: '2', preventDefault: () => {}, stopPropagation: () => {} });
        assert.equal(notiModule.getNotificationFilter(), 'downloads', 'Key 2 must switch directly to downloads');
        overlay.dispatchEvent({ type: 'keydown', key: '3', preventDefault: () => {}, stopPropagation: () => {} });
        assert.equal(notiModule.getNotificationFilter(), 'system', 'Key 3 must switch directly to system');
        overlay.dispatchEvent({ type: 'keydown', key: '4', preventDefault: () => {}, stopPropagation: () => {} });
        assert.equal(notiModule.getNotificationFilter(), 'web', 'Key 4 must switch directly to web');
        overlay.dispatchEvent({ type: 'keydown', key: '1', preventDefault: () => {}, stopPropagation: () => {} });
        assert.equal(notiModule.getNotificationFilter(), 'all', 'Key 1 must switch directly to all');

        console.log('✓ Keyboard cursor navigation, category filter cycling, and action dispatch verified');
    }

    // 6. XSS Sanitisation and Text Escaping
    {
        const notiModule = await import('../modules/overlays/notifications.js');
        notiModule.resetNotificationState();

        const xssPayload = '<img src=x onerror=alert(1)>Malicious Script';
        notiModule.addNotificationItem({
            category: 'web',
            title: xssPayload,
            message: xssPayload,
            details: xssPayload
        });

        let renderedMarkup = '';
        const mockFeed = {
            style: {},
            innerHTML: '',
            querySelectorAll: () => []
        };
        elementsHook: {
            const feedEl = document.getElementById('NotificationsFeed');
            if (feedEl) {
                feedEl.style.display = 'flex';
            }
        }

        notiModule.renderNotificationsUI();
        const feedElem = document.getElementById('NotificationsFeed');
        renderedMarkup = feedElem.innerHTML;

        assert(!renderedMarkup.includes('<img src=x'), 'Rendered markup must not contain unescaped HTML elements');
        assert(renderedMarkup.includes('&lt;img src=x'), 'HTML injection attempts must be safely escaped');

        console.log('✓ Strict HTML escaping and XSS injection prevention verified');
    }

    // 7. Overlay Lifecycle, Modal Isolation, and Webview Focus Restoration
    {
        const notiModule = await import('../modules/overlays/notifications.js');
        const { state } = await import('../modules/state.js');

        notiModule.openNotificationsOverlay();
        assert.equal(state.notificationsActive, true, 'Opening overlay must set state.notificationsActive to true');
        const overlay = document.getElementById('NotificationsOverlay');
        assert.equal(overlay.style.display, 'flex', 'Opening overlay must set display to flex');

        notiModule.closeNotificationsOverlay();
        assert.equal(state.notificationsActive, false, 'Closing overlay must set state.notificationsActive to false');
        assert.equal(overlay.style.display, 'none', 'Closing overlay must hide element');

        console.log('✓ Overlay lifecycle, state synchronisation, and clean dismissal verified');
    }

    // 8. Line Budget Verification
    {
        const rendererFile = path.join(__dirname, '../renderer.js');
        const mainFile = path.join(__dirname, '../main.js');
        const indexFile = path.join(__dirname, '../index.html');

        const rendererLines = fs.readFileSync(rendererFile, 'utf8').split('\n').length;
        const mainLines = fs.readFileSync(mainFile, 'utf8').split('\n').length;
        const indexLines = fs.readFileSync(indexFile, 'utf8').split('\n').length;

        assert(rendererLines <= 250, `renderer.js must remain <= 250 lines (currently ${rendererLines})`);
        assert(mainLines <= 550, `main.js must remain <= 550 lines (currently ${mainLines})`);
        assert(indexLines <= 260, `index.html must remain uncluttered (currently ${indexLines})`);

        console.log(`✓ Strict line budgets verified (renderer.js: ${rendererLines}/250, main.js: ${mainLines}/550, index.html: ${indexLines}/260)`);
    }

    console.log('All Mise Notifications & Activity Overlay regression tests passed successfully!');
})();
