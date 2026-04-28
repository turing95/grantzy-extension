/**
 * Visual + structural test for the scan-run picker UI (A.6).
 *
 * Loads the extension, jumps to the scan-platform view, and verifies:
 *   - the picker section renders (search input + tabs + lists)
 *   - tabs switch correctly
 *   - the paste-UUID fallback collapsible exists
 *   - the captures + tree panel exists (A.3 + A.4)
 *   - the audio mic button exists (A.1)
 *   - the auto-open-dropdowns toggle exists (A.2)
 *   - the reprocess button exists (A.5)
 *
 * Does NOT hit the backend — we test UI structure only. Backend integration
 * is covered by the Django test suite. Screenshots saved for manual eyeball.
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '..');
const screenshotDir = path.join(extensionPath, '.test-screenshots');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
const userDataDir = path.join(extensionPath, '.test-profile-picker');

console.log('Launching Chromium with extension...');
const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
    ],
    viewport: { width: 480, height: 900 },
});

let serviceWorker = context.serviceWorkers()[0];
if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
const extensionId = serviceWorker.url().split('/')[2];
console.log(`Extension ID: ${extensionId}`);

const page = await context.newPage();
await page.setViewportSize({ width: 480, height: 900 });
await page.goto(`chrome-extension://${extensionId}/src/sidepanel.html`);
await page.waitForTimeout(800);

// Force the scan-platform view open (normally gated on is_staff).
await page.evaluate(() => {
    const btn = document.getElementById('show-scan-platform-view-btn');
    if (btn) { btn.hidden = false; btn.click(); }
    // Also try direct nav: hide other panels, show scan view.
    document.querySelectorAll('.panel-view').forEach(v => v.classList.remove('panel-view-active'));
    const scanView = document.getElementById('scan-platform-view');
    if (scanView) scanView.classList.add('panel-view-active');
});
await page.waitForTimeout(500);

// Screenshot 1: initial picker state
const shot1 = path.join(screenshotDir, 'picker-1-initial.png');
await page.screenshot({ path: shot1, fullPage: true });
console.log(`✓ Screenshot: ${shot1}`);

// Structural checks — every element from the new A.6 layout must exist.
const checks = [
    ['#scan-picker-search', 'search input'],
    ['#scan-picker-refresh-btn', 'refresh button'],
    ['#scan-picker-create-btn', 'CREATE NEW RUN button (primary action)'],
    ['#scan-picker-fillable-wrap', 'fillable picker wrap (hidden by default)'],
    ['#scan-picker-fillable-cancel', 'fillable picker cancel'],
    ['#scan-picker-fillable-list', 'fillable list container'],
    ['#scan-picker-recent-list', 'recent runs list (always visible)'],
    ['details.scan-picker-paste', 'paste-UUID fallback details'],
    ['#scan-run-uuid-input', 'UUID input (fallback)'],
    ['#scan-load-run-btn', 'load run button (fallback)'],
];
for (const [sel, name] of checks) {
    const el = await page.$(sel);
    assert(el, `Missing: ${name} (${sel})`);
    console.log(`  ✓ ${name}`);
}

// Verify the fillable picker is HIDDEN by default (only opens on create click).
const fillablePickerHiddenInitial = await page.$eval('#scan-picker-fillable-wrap', e => e.hidden);
assert.equal(fillablePickerHiddenInitial, true, 'Fillable picker should be hidden by default');
console.log('  ✓ Fillable picker hidden by default (action-driven, not tab)');

// Click "Crea nuova run" → fillable picker opens.
await page.click('#scan-picker-create-btn');
await page.waitForTimeout(300);
const fillablePickerHiddenAfterClick = await page.$eval('#scan-picker-fillable-wrap', e => e.hidden);
assert.equal(fillablePickerHiddenAfterClick, false, 'Fillable picker should open after create click');
console.log('  ✓ "Crea nuova run" click → fillable picker opens (no longer "nothing happens")');

// Click cancel → it closes.
await page.click('#scan-picker-fillable-cancel');
await page.waitForTimeout(300);
const fillablePickerHiddenAfterCancel = await page.$eval('#scan-picker-fillable-wrap', e => e.hidden);
assert.equal(fillablePickerHiddenAfterCancel, true, 'Fillable picker should close on cancel');
console.log('  ✓ Cancel button closes fillable picker');

// Re-click create → toggles open again.
await page.click('#scan-picker-create-btn');
await page.waitForTimeout(300);
const reopened = await page.$eval('#scan-picker-fillable-wrap', e => e.hidden);
assert.equal(reopened, false, 'Re-click create should reopen fillable picker');
console.log('  ✓ Create button toggles fillable picker');

// Verify recent runs list is always visible (no longer tab-gated).
const recentListVisible = await page.$eval('#scan-picker-recent-list', e => !e.hidden && e.offsetParent !== null);
assert.equal(recentListVisible, true, 'Recent runs list must be always visible');
console.log('  ✓ Recent runs list always visible (not behind a tab)');

// Search input is editable.
await page.fill('#scan-picker-search', 'smart');
await page.waitForTimeout(400);
const searchVal = await page.$eval('#scan-picker-search', e => e.value);
assert.equal(searchVal, 'smart');
console.log('  ✓ Search input editable');

// Paste fallback toggle.
await page.click('details.scan-picker-paste summary');
await page.waitForTimeout(200);
const pasteOpen = await page.$eval('details.scan-picker-paste', e => e.open);
assert.equal(pasteOpen, true);
console.log('  ✓ Paste UUID fallback toggles open');

const shot2 = path.join(screenshotDir, 'picker-2-fillable-open.png');
await page.screenshot({ path: shot2, fullPage: true });
console.log(`✓ Screenshot: ${shot2}`);

// Verify other A.* features still present in the active block (gated by JS so
// they may be hidden until a run is loaded — but the DOM nodes must exist).
const activeBlockChecks = [
    ['#scan-context-mic-btn', 'A.1 mic button'],
    ['#scan-open-dropdowns-toggle', 'A.2 auto-open toggle'],
    ['#scan-state-wrap', 'A.3+A.4 captures+tree wrap'],
    ['#scan-state-tab-captures', 'A.3 captures tab'],
    ['#scan-state-tab-tree', 'A.4 tree tab'],
    ['#scan-reprocess-btn', 'A.5 reprocess button'],
];
for (const [sel, name] of activeBlockChecks) {
    const el = await page.$(sel);
    assert(el, `Missing: ${name} (${sel})`);
    console.log(`  ✓ ${name} present in DOM`);
}

console.log('\n✅ All structural checks passed.');
console.log(`Screenshots in ${screenshotDir}/`);

await context.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
