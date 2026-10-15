// tests/theming.test.js
// Automated verification for theme palettes, mode-aware accent presets, and dynamic chrome colouring

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running Mise theming and accent colour regression tests...');

// 1. Verify DEFAULT_THEME_COLORS in main.js and modules/theme.js
{
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    const themeSource = fs.readFileSync(path.join(__dirname, '../modules/theme.js'), 'utf8');

    // Extract DEFAULT_THEME_COLORS from main.js
    const mainMatch = mainSource.match(/const DEFAULT_THEME_COLORS = ({[\s\S]*?\n};)/);
    assert(mainMatch, 'DEFAULT_THEME_COLORS must be defined in main.js');
    const mainDefaults = new Function(`return ${mainMatch[1]}`)();

    // Extract DEFAULT_THEME_COLORS from modules/theme.js
    const themeMatch = themeSource.match(/export const DEFAULT_THEME_COLORS = ({[\s\S]*?\n};)/);
    assert(themeMatch, 'DEFAULT_THEME_COLORS must be exported from modules/theme.js');
    const themeDefaults = new Function(`return ${themeMatch[1]}`)();

    assert.deepEqual(mainDefaults, themeDefaults, 'DEFAULT_THEME_COLORS in main.js and theme.js must match');
    assert.equal(mainDefaults.dark.accent, '#7aa2f7', 'Dark theme default accent must be Tokyo Blue (#7aa2f7)');
    assert.equal(mainDefaults.light.accent, '#6d3b09', 'Light theme default accent must be Amber Chestnut brown (#6d3b09)');
    assert.equal(mainDefaults.light.bg_main, '#e5e5e5', 'Light theme bg_main must be #e5e5e5');
    assert.equal(mainDefaults.light.bg_sidebar, '#d4d4d4', 'Light theme bg_sidebar must be #d4d4d4');

    console.log('✓ DEFAULT_THEME_COLORS synchronised between main process and theme module');
}

// 2. Verify ACCENT_PRESETS diversity and dark earth tones for light theme
{
    const themeSource = fs.readFileSync(path.join(__dirname, '../modules/theme.js'), 'utf8');
    const presetMatch = themeSource.match(/export const ACCENT_PRESETS = ({[\s\S]*?\n};)/);
    assert(presetMatch, 'ACCENT_PRESETS must be exported from modules/theme.js');

    const presets = new Function(`return ${presetMatch[1]}`)();
    assert(Array.isArray(presets.dark) && presets.dark.length >= 8, 'Dark presets array must have at least 8 entries');
    assert(Array.isArray(presets.light) && presets.light.length >= 8, 'Light presets array must have at least 8 entries');

    // Verify dark palette contains distinct hues
    const darkColors = presets.dark.map(p => p.color.toLowerCase());
    assert(darkColors.includes('#7aa2f7'), 'Dark presets must include Tokyo Blue (#7aa2f7)');
    assert(darkColors.includes('#9ece6a'), 'Dark presets must include Emerald Green (#9ece6a)');
    assert(darkColors.includes('#e0af68'), 'Dark presets must include Amber Gold (#e0af68)');
    assert(darkColors.includes('#c48b71'), 'Dark presets must include Roasted Mocha (#c48b71)');
    assert(darkColors.includes('#e07a5f'), 'Dark presets must include Warm Terracotta (#e07a5f)');

    // Verify light palette prominently features darker earth tones and browns
    const lightColors = presets.light.map(p => p.color.toLowerCase());
    assert(lightColors.includes('#6d3b09'), 'Light presets must include Amber Chestnut (#6d3b09)');
    assert(lightColors.includes('#7b3f28'), 'Light presets must include Warm Chestnut (#7b3f28)');
    assert(lightColors.includes('#5c3d2e'), 'Light presets must include Espresso Brown (#5c3d2e)');
    assert(lightColors.includes('#a64b2a'), 'Light presets must include Terracotta Rust (#a64b2a)');
    assert(lightColors.includes('#854d0e'), 'Light presets must include Warm Bronze (#854d0e)');
    assert(lightColors.includes('#2d6a4f'), 'Light presets must include Forest Green (#2d6a4f)');
    assert(lightColors.includes('#801a2a'), 'Light presets must include Wine Burgundy (#801a2a)');

    // Ensure all presets have valid hex and descriptive labels
    for (const mode of ['dark', 'light']) {
        for (const item of presets[mode]) {
            assert(/^#[0-9a-fA-F]{6}$/.test(item.color), `Preset ${item.name} must have valid 6-char hex code`);
            assert(typeof item.name === 'string' && item.name.length > 0, 'Preset must have a descriptive label');
        }
    }

    console.log('✓ Curated preset palettes provide rich colour diversity and dark earth tones for light mode');
}

// 3. Verify renderAccentSwatches generates mode-aware DOM buttons
{
    const themeSource = fs.readFileSync(path.join(__dirname, '../modules/theme.js'), 'utf8');
    assert(themeSource.includes('export function renderAccentSwatches('), 'renderAccentSwatches must be exported');

    let containerHtml = '';
    const mockContainer = {
        get innerHTML() { return containerHtml; },
        set innerHTML(val) { containerHtml = val; }
    };

    const mockDocument = {
        getElementById: id => (id === 'accent-preset-swatches' ? mockContainer : null),
        body: { classList: { contains: () => false } }
    };

    // Extract function and run in test harness
    const renderFnStart = themeSource.indexOf('export function renderAccentSwatches(');
    const renderFnEnd = themeSource.indexOf('\nexport function applyThemeVisuals(');
    assert(renderFnStart !== -1 && renderFnEnd !== -1, 'renderAccentSwatches block must exist');

    const fnCode = themeSource.slice(renderFnStart, renderFnEnd).replace('export function renderAccentSwatches', 'function renderAccentSwatches');
    const presetsMatch = themeSource.match(/export const ACCENT_PRESETS = ({[\s\S]*?\n};)/);
    const presetsCode = `const ACCENT_PRESETS = ${presetsMatch[1]};`;

    const runner = new Function('document', 'getCurrentThemeMode', 'getActiveThemeColors', 'cachedThemeConfig', `
        ${presetsCode}
        ${fnCode}
        return renderAccentSwatches;
    `);

    const renderFn = runner(
        mockDocument,
        () => 'light',
        () => ({ accent: '#6d3b09' }),
        null
    );

    // Test light mode rendering
    renderFn('light', '#6d3b09');
    assert(containerHtml.includes('data-color="#6d3b09"'), 'Light mode swatches must render Amber Chestnut');
    assert(containerHtml.includes('class="swatch-btn active"'), 'Active swatch must have active class');
    assert(containerHtml.includes('data-color="#7b3f28"'), 'Light mode swatches must render Warm Chestnut');
    assert(containerHtml.includes('title="Espresso Brown"'), 'Light mode swatches must render Espresso Brown');

    // Test dark mode rendering
    renderFn('dark', '#7aa2f7');
    assert(containerHtml.includes('data-color="#7aa2f7"'), 'Dark mode swatches must render Tokyo Blue');
    assert(containerHtml.includes('data-color="#9ece6a"'), 'Dark mode swatches must render Emerald Green');
    assert(containerHtml.includes('data-color="#c48b71"'), 'Dark mode swatches must render Roasted Mocha');

    console.log('✓ renderAccentSwatches dynamically constructs mode-tailored swatch buttons');
}

// 4. Verify style.css dynamic color-mix and absence of hardcoded blue leakage
{
    const css = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');

    // Selected variable uses color-mix
    assert.match(css, /--selected:\s*color-mix\(in srgb,\s*var\(--accent\)\s*26%,\s*var\(--bg-sidebar\)\);/, 'Root --selected must derive from accent and sidebar using color-mix');
    assert.match(css, /body\.light-mode\s*\{[\s\S]*?--selected:\s*color-mix\(in srgb,\s*var\(--accent\)\s*20%,\s*var\(--bg-sidebar\)\);/, 'Light mode --selected must derive from accent and sidebar using color-mix');

    // Verify absence of legacy hardcoded blue colors in interactive states
    assert(!css.includes('rgba(122, 162, 247'), 'style.css must not contain hardcoded rgba(122, 162, 247');
    assert(!css.includes('rgba(54, 74, 133'), 'style.css must not contain hardcoded rgba(54, 74, 133');
    assert(!css.includes('#2b59c3'), 'style.css must not contain hardcoded #2b59c3');
    assert(!css.includes('#364a85'), 'style.css must not contain hardcoded #364a85');
    assert(!css.includes('#b8cbf2'), 'style.css must not contain hardcoded #b8cbf2');

    // Verify key interactive controls use color-mix with var(--accent)
    assert.match(css, /#TabList\s+li:hover\s*\{[^}]*background-color:\s*color-mix\(in srgb,\s*var\(--accent\)\s*15%,\s*transparent\);/, 'Tab hover must use color-mix with accent');
    assert.match(css, /#TabList\s+li:focus:not\(\.selected\)\s*\{[^}]*background-color:\s*color-mix\(in srgb,\s*var\(--accent\)\s*16%,\s*transparent\);/, 'Tab non-selected focus must use color-mix with accent');
    assert.match(css, /\.settings-tab-btn\.active[^}]*background-color:\s*color-mix\(in srgb,\s*var\(--accent\)\s*15%,\s*transparent\);/, 'Active settings tab button must use color-mix with accent');
    assert.match(css, /\.status-badge-mode\.mode-normal\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--accent\)\s*15%,\s*transparent\);/, 'Normal mode badge must use color-mix with accent');
    assert.match(css, /body\.light-mode\s+\.status-badge-mode\.mode-normal\s*\{[^}]*color:\s*var\(--accent\);/, 'Light mode normal badge must use var(--accent)');

    console.log('✓ style.css eliminated hardcoded blue values and applies dynamic color-mix highlights');
}

console.log('All theming and accent colour regression tests passed successfully!');
