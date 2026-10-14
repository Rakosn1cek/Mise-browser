// tests/tab-transfer.test.js
// Verification for atomic tab metadata cleanup, shared array deduplication, and container-safe tab transfers

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('Running Mise tab transfer and metadata regression tests...');

// 1. Verify removeTabMetadata splices shared array references exactly once
{
    const webviewSource = fs.readFileSync(path.join(__dirname, '../modules/webview.js'), 'utf8');
    const startIdx = webviewSource.indexOf('function removeTabMetadata');
    const endIdx = webviewSource.indexOf('export function handleTabRemoval');
    assert(startIdx !== -1 && endIdx !== -1, 'removeTabMetadata function must exist in webview.js');

    const fnSource = webviewSource.slice(startIdx, endIdx);

    const sharedSleep = ['sleeping-tab-1', 'sleeping-tab-2', null];
    const sharedPinned = [false, true, false];
    const sharedTitles = ['Title A', 'Title B', 'Title C'];

    const mockState = {
        tabSleepStates: { Work: sharedSleep },
        tabPinned: { Work: sharedPinned },
        activeTitlesCache: { Work: sharedTitles },
        sessionState: {
            tab_sleep_states: { Work: sharedSleep },
            tab_pinned: { Work: sharedPinned },
            tab_titles: { Work: sharedTitles }
        }
    };

    vm.runInNewContext(fnSource + '; removeTabMetadata("Work", 1);', { state: mockState });

    assert.equal(sharedSleep.length, 2, 'Shared sleep array must only have one element spliced');
    assert.deepEqual(sharedSleep, ['sleeping-tab-1', null]);

    assert.equal(sharedPinned.length, 2, 'Shared pinned array must only have one element spliced');
    assert.deepEqual(sharedPinned, [false, false]);

    assert.equal(sharedTitles.length, 2, 'Shared titles array must only have one element spliced');
    assert.deepEqual(sharedTitles, ['Title A', 'Title C']);

    console.log('✓ Shared tab metadata arrays are deduplicated and spliced exactly once');
}

// 2. Verify transferTab moves tab across workspaces and enforces container isolation
{
    const transferSource = fs.readFileSync(path.join(__dirname, '../modules/tabTransfer.js'), 'utf8');
    const fnSource = transferSource.replace('export function transferTab', 'function transferTab');

    let webviewRemoved = false;
    let webviewBlurred = false;
    const mockWebview = {
        ownerDocument: {},
        blur: () => { webviewBlurred = true; },
        remove: () => { webviewRemoved = true; }
    };
    mockWebview.ownerDocument.activeElement = mockWebview;

    const mockState = {
        sessionState: {
            workspaces: {
                Personal: ['https://example.org/tab1', 'https://example.org/tab2'],
                Work: ['https://corp.local/dashboard']
            },
            tab_titles: {
                Personal: ['Personal Tab 1', 'Personal Tab 2'],
                Work: ['Work Dashboard']
            },
            tab_sleep_states: {
                Personal: [null, { title: 'Personal Tab 2', scrollY: 120 }],
                Work: [null]
            },
            tab_pinned: {
                Personal: [false, true],
                Work: [false]
            }
        },
        activeViewsCache: {
            Personal: [mockWebview, null],
            Work: [null]
        },
        activeTitlesCache: {
            Personal: ['Personal Tab 1', 'Personal Tab 2'],
            Work: ['Work Dashboard']
        },
        tabSleepStates: {
            Personal: [null, { title: 'Personal Tab 2', scrollY: 120 }],
            Work: [null]
        },
        tabActivityTimestamps: {
            Personal: [1000, 2000],
            Work: [3000]
        },
        tabMediaAudible: {
            Personal: [true, false],
            Work: [false]
        },
        tabAudioMuted: {
            Personal: [false, true],
            Work: [false]
        },
        tabPinned: {
            Personal: [false, true],
            Work: [false]
        },
        tabFavicons: {
            Personal: ['icon1.png', 'icon2.png'],
            Work: ['icon3.png']
        },
        tabDarkReaderStates: {
            Personal: [true, false],
            Work: [false]
        },
        tabHistory: {
            Personal: [0, 1],
            Work: [0]
        },
        splitStates: {
            Personal: { primaryIdx: 0, secondaryIdx: 1 }
        }
    };

    const context = {
        state: mockState
    };
    vm.runInNewContext(fnSource + '; result = transferTab(state, "Personal", 0, "Work", 1);', context);

    assert.equal(context.result, 1, 'Target tab destination index must be 1');
    assert.equal(mockState.sessionState.workspaces.Personal.length, 1);
    assert.equal(mockState.sessionState.workspaces.Work.length, 2);
    assert.equal(mockState.sessionState.workspaces.Work[1], 'https://example.org/tab1');

    assert.equal(webviewBlurred, true, 'Live guest webview must release focus on transfer');
    assert.equal(webviewRemoved, true, 'Live guest webview must be destroyed to prevent container leakage');
    assert.equal(mockState.activeViewsCache.Work[1], null, 'Destination view must be null so partition recreates guest on demand');

    assert.equal(mockState.tabMediaAudible.Work[1], true);
    assert.equal(mockState.tabFavicons.Work[1], 'icon1.png');
    assert.equal(mockState.tabDarkReaderStates.Work[1], true);

    console.log('✓ transferTab coordinates metadata migration and preserves container isolation');
}

console.log('All tab transfer and metadata regression tests passed successfully!');
