// tests/clock.test.js
// Automated verification for clock DOM dirty-checking, throttling, and visibility toggles

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('Running Mise clock throttling and DOM dirty-checking regression tests...');

let now = new Date(2026, 9, 14, 10, 20, 30).getTime();
let labelWrites = 0;
const elements = {};
for (const prefix of ['StatusBar', 'Sidebar']) {
    elements[`${prefix}Clock`] = { style: {} };
    for (const suffix of ['Date', 'Time']) {
        let text = '';
        elements[`${prefix}Clock${suffix}`] = {
            style: {},
            get textContent() { return text; },
            set textContent(value) { text = value; labelWrites += 1; }
        };
    }
}

const context = {
    Date: class extends Date { constructor() { super(now); } },
    document: { getElementById: id => elements[id] },
    window: {},
    setTimeout() {},
    setInterval() {},
    clearInterval() {}
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../modules/clock.js'), 'utf8').replace(/export /g, ''), context);

// 1. Initial render writes text nodes
context.updateClockUI();
const initialWrites = labelWrites;
assert.ok(initialWrites > 0, 'Initial render must populate clock labels');

// 2. A 1-second tick without minute change must not touch DOM text nodes
now += 1000;
context.updateClockUI();
assert.equal(labelWrites, initialWrites, 'A seconds tick must not replace unchanged minute and date text nodes');
assert.match(elements.StatusBarClock.title, /10:20:31/, 'Tooltip updates with accurate second precision');

// 3. Advancing by 1 minute triggers exactly 2 text updates (status bar time and sidebar time)
now += 60000;
context.updateClockUI();
assert.equal(labelWrites, initialWrites + 2, 'A new minute updates both visible times without touching unchanged dates');

// 4. Format cycling to time-only hides date elements
context.cycleClockFormat();
assert.equal(elements.SidebarClockDate.style.display, 'none');

// 5. Format cycling to seconds mode enables 1-second interval label updates
context.cycleClockFormat();
const secondsWrites = labelWrites;
now += 1000;
context.updateClockUI();
assert.equal(labelWrites, secondsWrites + 2, 'Seconds format updates labels every second');

// 6. When clock is disabled, updates are suppressed entirely
context.setClockVisibility(false);
const hiddenWrites = labelWrites;
now += 120000;
context.updateClockUI();
assert.equal(labelWrites, hiddenWrites, 'Disabled clock must not perform DOM updates on hidden labels');

// 7. Re-enabling the clock forces an immediate UI update
context.setClockVisibility(true);
assert.match(elements.SidebarClockTime.textContent, /^10:23:/, 'Re-enabling the clock updates visible labels immediately');

console.log('✓ Clock ticks preserve unchanged labels, formats, and disabled-clock behaviour');
console.log('All clock throttling regression tests passed successfully!');
