/**
 * Visual smoke test for the extension side panel.
 * Launches Chromium with the extension loaded, navigates to the sidepanel page,
 * and takes a screenshot.
 *
 * Usage: npx playwright test-sidepanel.mjs
 *   or:  node scripts/test-sidepanel.mjs
 *
 * Requires: npx playwright install chromium (one-time)
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '..');
const screenshotDir = path.join(extensionPath, '.test-screenshots');

if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

const userDataDir = path.join(extensionPath, '.test-profile');

console.log('Launching Chromium with extension loaded...');
const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
    ],
});

// Get the extension ID from the service worker
let extensionId;
let serviceWorker;

// Wait for the service worker to be available
serviceWorker = context.serviceWorkers()[0];
if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
}
extensionId = serviceWorker.url().split('/')[2];
console.log(`Extension ID: ${extensionId}`);

// Seed chrome.storage.local with fake selected application data
// to simulate the "opened from space page" scenario
const page = await context.newPage();

await page.goto(`chrome-extension://${extensionId}/src/sidepanel.html`);
console.log('Navigated to sidepanel');

// Seed storage with test data to simulate preloaded space
await page.evaluate(() => {
    return new Promise(resolve => {
        chrome.storage.local.set({
            selectedApplication: {
                uuid: 'test-uuid-1234',
                title: 'Test Application',
                companyName: 'Test Company',
                updatedAt: new Date().toISOString()
            },
            selectedApplicationData: {
                fields: [
                    {
                        key: 'Sezione Test',
                        value: [
                            { key: 'Nome azienda', value: 'Acme S.r.l.' },
                            { key: 'Partita IVA', value: '12345678901' },
                            { key: 'Email', value: 'info@acme.it' },
                            {
                                key: 'Bilancio',
                                value: [
                                    { uuid: 'f1', name: 'bilancio_2024.pdf', size: 1048576, content_type: 'application/pdf', is_signed: false },
                                    { uuid: 'f2', name: 'bilancio_2024_firmato.p7m', size: 1100000, content_type: 'application/pkcs7-mime', is_signed: true },
                                ],
                                value_type: 'file'
                            },
                            {
                                key: 'Visura camerale',
                                value: [
                                    { uuid: 'f3', name: 'visura.pdf', size: 524288, content_type: 'application/pdf', is_signed: false },
                                ],
                                value_type: 'file'
                            },
                        ]
                    }
                ],
                flatFields: [
                    { key: 'Nome azienda', value: 'Acme S.r.l.', value_type: 'text' },
                    { key: 'Partita IVA', value: '12345678901', value_type: 'text' },
                    { key: 'Email', value: 'info@acme.it', value_type: 'text' },
                    {
                        key: 'Bilancio',
                        value: [
                            { uuid: 'f1', name: 'bilancio_2024.pdf', size: 1048576, content_type: 'application/pdf', is_signed: false },
                            { uuid: 'f2', name: 'bilancio_2024_firmato.p7m', size: 1100000, content_type: 'application/pkcs7-mime', is_signed: true },
                        ],
                        value_type: 'file'
                    },
                    {
                        key: 'Visura camerale',
                        value: [
                            { uuid: 'f3', name: 'visura.pdf', size: 524288, content_type: 'application/pdf', is_signed: false },
                        ],
                        value_type: 'file'
                    },
                ],
                updatedAt: new Date().toISOString()
            }
        }, resolve);
    });
});
console.log('Seeded storage with test data');

// Reload to pick up the seeded data
await page.reload();
await page.waitForTimeout(1500);

// Screenshot: should show fields, not spaces list
const screenshotPath = path.join(screenshotDir, 'sidepanel-with-data.png');
await page.screenshot({ path: screenshotPath, fullPage: true });
console.log(`Screenshot saved: ${screenshotPath}`);

// Test file field rendering: type "bilancio" in the search box
const searchInput = page.locator('input[placeholder="Cerca pratiche..."]');
await searchInput.fill('bilancio');
await page.waitForTimeout(1000);

const fileScreenshotPath = path.join(screenshotDir, 'sidepanel-file-results.png');
await page.screenshot({ path: fileScreenshotPath, fullPage: true });
console.log(`Screenshot saved: ${fileScreenshotPath}`);

// Clear search and search for "visura" to see unsigned-only field
await searchInput.fill('visura');
await page.waitForTimeout(1000);

const unsignedScreenshotPath = path.join(screenshotDir, 'sidepanel-unsigned-file.png');
await page.screenshot({ path: unsignedScreenshotPath, fullPage: true });
console.log(`Screenshot saved: ${unsignedScreenshotPath}`);

// Test refresh button: visible and clickable when data is loaded
const searchInputForRefresh = page.locator('#app-search-input');
await searchInputForRefresh.fill('');
await page.waitForTimeout(300);

const refreshBtn = page.locator('#refresh-data-btn');
const isRefreshVisible = await refreshBtn.isVisible();
console.log(`Refresh button visible with data: ${isRefreshVisible}`);

// Click refresh — will trigger API call that fails (no auth), capture the spinning state
await refreshBtn.click();
await page.waitForTimeout(200);

const refreshSpinningPath = path.join(screenshotDir, 'sidepanel-refresh-spinning.png');
await page.screenshot({ path: refreshSpinningPath, fullPage: true });
console.log(`Screenshot saved: ${refreshSpinningPath}`);

// Wait for the refresh to complete (will error out due to no API)
await page.waitForTimeout(3000);

const refreshDonePath = path.join(screenshotDir, 'sidepanel-refresh-done.png');
await page.screenshot({ path: refreshDonePath, fullPage: true });
console.log(`Screenshot saved: ${refreshDonePath}`);

// Also test the empty state (no selected application)
await page.evaluate(() => {
    return new Promise(resolve => {
        chrome.storage.local.remove(['selectedApplication', 'selectedApplicationData', 'grantzyPreloadingSpace'], resolve);
    });
});
await page.reload();
await page.waitForTimeout(1500);

const emptyScreenshotPath = path.join(screenshotDir, 'sidepanel-empty.png');
await page.screenshot({ path: emptyScreenshotPath, fullPage: true });
console.log(`Screenshot saved: ${emptyScreenshotPath}`);

// ----- Platform Scan Mode (staff-only) visual smoke -----
// In real life the section is gated server-side via session.user.is_staff.
// For the smoke test we just unhide the button and switch view, so the
// rendered layout (load block, intro copy, inputs) can be screenshotted.
await page.evaluate(() => {
    return new Promise(resolve => {
        chrome.storage.local.remove(['grantzyPlatformScanRunV1'], () => resolve());
    });
});
await page.reload();
await page.waitForTimeout(1000);
await page.evaluate(() => {
    const btn = document.getElementById('show-scan-platform-view-btn');
    if (btn) {
        btn.hidden = false;
        btn.click();
    }
});
await page.waitForTimeout(500);
const scanPlatformScreenshotPath = path.join(screenshotDir, 'sidepanel-scan-platform.png');
await page.screenshot({ path: scanPlatformScreenshotPath, fullPage: true });
console.log(`Screenshot saved: ${scanPlatformScreenshotPath}`);

await context.close();

// Cleanup test profile
fs.rmSync(userDataDir, { recursive: true, force: true });

console.log('\nDone! Check screenshots in .test-screenshots/');
