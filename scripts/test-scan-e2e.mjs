/**
 * REAL Chrome end-to-end test of the Platform Scan Mode.
 *
 * Launches Chromium with the extension loaded, seeds the bearer token,
 * opens the side panel, switches to Scan Mode, loads a scan run, opens
 * a public form page (httpbin) in a tab, clicks "Cattura", and verifies
 * the backend received the capture (via /info/ delta).
 *
 * Requires:
 *   - Backend running on http://localhost:8002
 *   - A valid bearer token (passed via SCAN_TEST_TOKEN env var)
 *   - A RUNNING GrantPlatformScanRun (passed via SCAN_TEST_RUN_UUID env var)
 *
 * Usage:
 *   SCAN_TEST_TOKEN=grx_... SCAN_TEST_RUN_UUID=... \
 *     node scripts/test-scan-e2e.mjs
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '..');
const screenshotDir = path.join(extensionPath, '.test-screenshots');
const userDataDir = path.join(extensionPath, '.test-profile-scan');

const TOKEN = process.env.SCAN_TEST_TOKEN;
const RUN_UUID = process.env.SCAN_TEST_RUN_UUID;
const BACKEND = process.env.SCAN_TEST_BACKEND || 'http://localhost:8002';
const FORM_URL = process.env.SCAN_TEST_FORM_URL || 'https://httpbin.org/forms/post';

if (!TOKEN || !RUN_UUID) {
    console.error('SCAN_TEST_TOKEN and SCAN_TEST_RUN_UUID required');
    process.exit(2);
}

if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

console.log(`[e2e] backend=${BACKEND} run=${RUN_UUID} form=${FORM_URL}`);

async function fetchInfo() {
    const r = await fetch(`${BACKEND}/api/setup/platform-scan/${RUN_UUID}/info/`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (!r.ok) throw new Error(`info ${r.status}: ${await r.text()}`);
    return r.json();
}

async function main() {
    const before = await fetchInfo();
    console.log(`[e2e] BEFORE: status=${before.status} captures=${before.captures_count} fields=${before.fields_count}`);
    if (before.status !== 'running') {
        console.error(`[e2e] run is not running (status=${before.status}). Aborting.`);
        process.exit(1);
    }

    console.log('[e2e] Launching Chromium with extension loaded...');
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
        ],
    });

    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
        serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    const extensionId = serviceWorker.url().split('/')[2];
    console.log(`[e2e] Extension ID: ${extensionId}`);

    // Open the side panel page directly (acts as our control surface)
    const sidePanel = await context.newPage();
    await sidePanel.goto(`chrome-extension://${extensionId}/src/sidepanel.html`);
    console.log('[e2e] Side panel opened');

    // Seed the bearer token in chrome.storage.local so the extension talks to our backend
    await sidePanel.evaluate(({ token }) => {
        return new Promise(resolve => {
            chrome.storage.local.set({
                grantzyExtensionApiToken: token,
                grantzyExtensionCredentialsMode: 'include',
            }, () => resolve());
        });
    }, { token: TOKEN });
    await sidePanel.reload();
    await sidePanel.waitForTimeout(1500);
    console.log('[e2e] Token seeded, side panel reloaded');

    // We rely on the manifest's `activeTab` permission to allow
    // captureVisibleTab + executeScript on whatever tab the user activates.
    // chrome.permissions.request() cannot be triggered from page.evaluate()
    // because Playwright lacks a real user-gesture; for the test we depend
    // on activeTab semantics granted via the side panel click.

    // Force-show the Scan Mode section (gating depends on session is_staff which
    // we cannot easily fake here — just unhide programmatically).
    await sidePanel.evaluate(() => {
        const btn = document.getElementById('show-scan-platform-view-btn');
        if (btn) {
            btn.hidden = false;
            btn.click();
        }
    });
    await sidePanel.waitForTimeout(500);
    console.log('[e2e] Switched to Scan piattaforma view');

    // Paste the run UUID and click "Carica run"
    await sidePanel.fill('#scan-run-uuid-input', RUN_UUID);
    await sidePanel.click('#scan-load-run-btn');
    // Wait for either success or error
    await sidePanel.waitForFunction(() => {
        const status = document.getElementById('scan-load-status');
        return status && status.textContent && status.textContent.length > 5;
    }, { timeout: 20000 });
    const loadStatus = await sidePanel.textContent('#scan-load-status');
    console.log(`[e2e] Load run status: ${loadStatus}`);
    if (!loadStatus.toLowerCase().includes('caric')) {
        throw new Error(`Failed to load run: ${loadStatus}`);
    }

    // Open the target form in a new tab so it becomes the active tab
    console.log('[e2e] Opening form tab...');
    const formTab = await context.newPage();
    await formTab.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
    await formTab.waitForTimeout(1500);
    // Bring it to the foreground (active tab) before triggering capture
    await formTab.bringToFront();
    await formTab.waitForTimeout(500);

    // The form tab MUST stay frontmost so chrome.tabs.captureVisibleTab and
    // chrome.tabs.query({active:true}) target it. We dispatch the click on
    // the side panel button programmatically (evaluate doesn't bring it to
    // foreground unlike sidePanel.click()).
    await formTab.bringToFront();
    await formTab.waitForTimeout(300);
    await sidePanel.evaluate(() => {
        document.getElementById('scan-capture-btn').click();
    });
    console.log('[e2e] Dispatched Capture click on side panel; waiting for backend response...');

    // Wait for status to settle (success or error)
    await sidePanel.waitForFunction(() => {
        const s = document.getElementById('scan-capture-status');
        if (!s || !s.textContent) return false;
        const txt = s.textContent.toLowerCase();
        return txt.includes('campi') || txt.includes('riuscita') || txt.includes('errore') || txt.includes('failed');
    }, { timeout: 90000 });

    const captureStatus = await sidePanel.textContent('#scan-capture-status');
    console.log(`[e2e] Capture status: ${captureStatus}`);

    const screenshotPath = path.join(screenshotDir, 'sidepanel-scan-e2e-after.png');
    await sidePanel.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[e2e] Screenshot saved: ${screenshotPath}`);

    const after = await fetchInfo();
    console.log(`[e2e] AFTER:  status=${after.status} captures=${after.captures_count} fields=${after.fields_count}`);

    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });

    if (after.captures_count > before.captures_count && after.fields_count >= before.fields_count) {
        console.log('[e2e] ✅ SUCCESS: backend received the capture');
        process.exit(0);
    } else {
        console.error('[e2e] ❌ FAIL: capture did not propagate to backend');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('[e2e] crashed:', err);
    process.exit(1);
});
