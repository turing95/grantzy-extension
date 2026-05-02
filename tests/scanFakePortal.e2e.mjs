/**
 * End-to-end test: extension's content script scanning a fake portal HTML.
 *
 * Loads the fake Infocamere ReStart-style page from
 * `tests/fixtures/fake-infocamere-restart.html`, injects the real
 * `formFiller.content.js` (with a tiny chrome-runtime stub so the
 * listener registration doesn't throw), then calls discoverFields()
 * via the test-only `window.__grantzyInternals` surface.
 *
 * Asserts that the captured field shape includes the new v2.2.0
 * attributes (autocomplete, pattern, inputMode, ariaDescribedBy)
 * which the backend metadata extractor consumes at scan/commit time.
 *
 * Run:  node tests/scanFakePortal.e2e.mjs
 *       (or)  npm run test:fake-portal
 *
 * Requires: playwright (already a devDependency).
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import test from 'node:test';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, 'fixtures', 'fake-infocamere-restart.html');
const CONTENT_SCRIPT = path.resolve(__dirname, '..', 'src', 'formFiller.content.js');

// Tiny chrome stub so `chrome.runtime.onMessage.addListener(...)` at the
// bottom of the IIFE doesn't throw when injected outside a real extension.
const CHROME_STUB = `
window.chrome = window.chrome || {
    runtime: { onMessage: { addListener: () => {} } },
    storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
};
`;

async function captureFromFakePortal() {
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto('file://' + FIXTURE);
        await page.evaluate(CHROME_STUB);
        const scriptSource = fs.readFileSync(CONTENT_SCRIPT, 'utf8');
        await page.addScriptTag({ content: scriptSource });
        // Internals surface is set synchronously by the IIFE.
        return await page.evaluate(() => {
            const internals = window.__grantzyInternals;
            if (!internals) throw new Error('__grantzyInternals not exposed');
            const fields = internals.discoverFields();
            const fingerprint = internals.buildFingerprint(fields);
            return { fields, fingerprint };
        });
    } finally {
        await browser.close();
    }
}

let captured;

test('extension discovers all expected leaves on the fake portal', async () => {
    captured = await captureFromFakePortal();
    const labels = captured.fields.map(f => f.label);
    const expected = [
        'Denominazione', 'Codice fiscale', 'Partita IVA', 'Forma giuridica',
        'Data di costituzione', 'Indirizzo (via, piazza)', 'Numero civico',
        'CAP', 'Comune', 'Provincia', 'Nazione', 'Email aziendale', 'PEC',
        'Telefono', 'Sito web', 'IBAN', 'Codice destinatario SDI',
        'Nome', 'Cognome', 'Codice fiscale', 'Data di nascita',
        'Note libere', 'Numero pratica interno',
    ];
    for (const label of expected) {
        assert.ok(labels.includes(label), `missing leaf with label="${label}". Got: ${labels.join(', ')}`);
    }
});

test('every field carries the v2.2.0 metadata attributes', () => {
    for (const field of captured.fields) {
        assert.ok('autocomplete' in field, `field ${field.label} missing autocomplete key`);
        assert.ok('pattern' in field, `field ${field.label} missing pattern key`);
        assert.ok('inputMode' in field, `field ${field.label} missing inputMode key`);
        assert.ok('ariaDescribedBy' in field, `field ${field.label} missing ariaDescribedBy key`);
    }
});

test('autocomplete attr captured where author set it', () => {
    const byLabel = (label) => captured.fields.find(f => f.label === label);
    assert.equal(byLabel('Indirizzo (via, piazza)').autocomplete, 'street-address');
    assert.equal(byLabel('CAP').autocomplete, 'postal-code');
    assert.equal(byLabel('Comune').autocomplete, 'address-level2');
    assert.equal(byLabel('Nazione').autocomplete, 'country-name');
    assert.equal(byLabel('Email aziendale').autocomplete, 'email');
    assert.equal(byLabel('Telefono').autocomplete, 'tel');
    assert.equal(byLabel('Sito web').autocomplete, 'url');
    assert.equal(byLabel('Nome').autocomplete, 'given-name');
    assert.equal(byLabel('Cognome').autocomplete, 'family-name');
    assert.equal(byLabel('Data di nascita').autocomplete, 'bday');
});

test('pattern attr captured for fields that have one', () => {
    const byLabel = (label) => captured.fields.find(f => f.label === label);
    assert.equal(byLabel('Codice fiscale').pattern,
                 '^[A-Z]{6}\\d{2}[A-Z]\\d{2}[A-Z]\\d{3}[A-Z]$');
    assert.equal(byLabel('Partita IVA').pattern, '^\\d{11}$');
    assert.equal(byLabel('CAP').pattern, '^\\d{5}$');
    assert.equal(byLabel('Codice destinatario SDI').pattern, '^[A-Z0-9]{6,7}$');
    // Fields without pattern attr default to "".
    assert.equal(byLabel('Denominazione').pattern, '');
});

test('inputmode captured', () => {
    const byLabel = (label) => captured.fields.find(f => f.label === label);
    assert.equal(byLabel('Partita IVA').inputMode, 'numeric');
    assert.equal(byLabel('CAP').inputMode, 'numeric');
    assert.equal(byLabel('Denominazione').inputMode, '');
});

test('aria-describedby resolves to help text', () => {
    const cf = captured.fields.find(f => f.idAttr === 'cf');
    assert.equal(cf.ariaDescribedBy, 'Inserisci il codice fiscale di 16 caratteri.');
    // Fields without aria-describedby default to "".
    assert.equal(captured.fields.find(f => f.label === 'Denominazione').ariaDescribedBy, '');
});

test('options array captured for selects', () => {
    const byLabel = (label) => captured.fields.find(f => f.label === label);
    const forma = byLabel('Forma giuridica');
    assert.equal(forma.options.length, 3);
    assert.equal(forma.options[0].text, 'S.r.l.');
    assert.equal(forma.options[0].value, 'SRL');
});

test('fingerprint is deterministic and non-empty', () => {
    assert.ok(typeof captured.fingerprint === 'string');
    assert.ok(captured.fingerprint.length > 0);
});
