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
                        ]
                    }
                ],
                flatFields: [
                    { key: 'Nome azienda', value: 'Acme S.r.l.', value_type: 'text' },
                    { key: 'Partita IVA', value: '12345678901', value_type: 'text' },
                    { key: 'Email', value: 'info@acme.it', value_type: 'text' },
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

await context.close();

// Cleanup test profile
fs.rmSync(userDataDir, { recursive: true, force: true });

console.log('\nDone! Check screenshots in .test-screenshots/');
