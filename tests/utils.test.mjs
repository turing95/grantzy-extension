import test from 'node:test';
import assert from 'node:assert/strict';

import {
  debounce,
  levenshteinDistance,
  normalizeString,
  normalizeTokens,
  normalizeUrlForMatching,
  findMatchingCaptures,
} from '../src/utils.js';

test('normalizeString normalizes spacing/casing separators', () => {
  assert.equal(normalizeString('  ACME___Group- SRL.  '), 'acme group srl');
});

test('normalizeTokens returns normalized token list', () => {
  assert.deepEqual(normalizeTokens(' Company_Name  Primary-Email '), ['company', 'name', 'primary', 'email']);
});

test('levenshteinDistance computes edit distance', () => {
  assert.equal(levenshteinDistance('grant', 'giant'), 1);
  assert.equal(levenshteinDistance('', 'abc'), 3);
});

test('debounce collapses rapid calls and keeps latest args', async () => {
  let calls = 0;
  let lastValue = '';
  const fn = debounce(value => {
    calls += 1;
    lastValue = value;
  }, 20);

  fn('first');
  fn('second');
  fn('final');

  await new Promise(resolve => setTimeout(resolve, 50));

  assert.equal(calls, 1);
  assert.equal(lastValue, 'final');
});

// --- normalizeUrlForMatching --------------------------------------------------

test('normalizeUrlForMatching strips per-instance UUIDs (Smart&Start pattern)', () => {
  // Real Smart&Start URL pattern with proper 8-4-4-4-12 hex UUIDs.
  const a = 'https://x.invitalia.it/domanda/eae9a1d5-b6ee-4502-842b-b2ff3c3514c4/compagine-sociale/4474eb79-4357-41cb-a433-e9825cd9e495/tipo-socio/52b74343-959a-4721-b699-56aed250febd/persona-fisica';
  const b = 'https://x.invitalia.it/domanda/01234567-89ab-cdef-0123-456789abcdef/compagine-sociale/abcdef12-3456-7890-abcd-ef0123456789/tipo-socio/0000aaaa-1111-bbbb-2222-cccccccccccc/persona-fisica';
  // Both should normalize to the same template
  assert.equal(normalizeUrlForMatching(a), normalizeUrlForMatching(b));
  assert.equal(
    normalizeUrlForMatching(a),
    'https://x.invitalia.it/domanda/*/compagine-sociale/*/tipo-socio/*/persona-fisica'
  );
});

test('normalizeUrlForMatching strips long numeric IDs and trailing slash', () => {
  assert.equal(
    normalizeUrlForMatching('https://x.example/portal/12345678/step/'),
    'https://x.example/portal/*/step'
  );
  // Short numeric stays
  assert.equal(
    normalizeUrlForMatching('https://x.example/v2/step3'),
    'https://x.example/v2/step3'
  );
});

test('normalizeUrlForMatching strips query string and fragment', () => {
  assert.equal(
    normalizeUrlForMatching('https://x.example/a/b?token=xyz&q=1#frag'),
    'https://x.example/a/b'
  );
});

test('normalizeUrlForMatching falls back gracefully on invalid input', () => {
  assert.equal(normalizeUrlForMatching(''), '');
  assert.equal(normalizeUrlForMatching(null), '');
  assert.equal(normalizeUrlForMatching('not-a-url'), 'not-a-url');
});

// --- findMatchingCaptures ----------------------------------------------------

test('findMatchingCaptures returns empty when no captures match', () => {
  const captures = [
    { url: 'https://x.example/page-a' },
    { url: 'https://x.example/page-b' },
  ];
  assert.deepEqual(findMatchingCaptures('https://x.example/page-c', captures), []);
});

test('findMatchingCaptures matches two distinct UUIDs to the same template', () => {
  const captures = [
    {
      url: 'https://x.invitalia.it/domanda/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/compagine-sociale/00001111-2222-3333-4444-555555555555/tipo-socio',
      operator_context: 'tipo socio open',
      ts: '2026-04-28T10:00:00Z',
    },
    { url: 'https://x.invitalia.it/different/path' },
  ];
  // Different UUIDs in current URL — must still match capture #1.
  const matches = findMatchingCaptures(
    'https://x.invitalia.it/domanda/9876fedc-aaaa-bbbb-cccc-ffffffffffff/compagine-sociale/77778888-9999-aaaa-bbbb-cccccccccccc/tipo-socio',
    captures,
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].index, 1);
  assert.equal(matches[0].operator_context, 'tipo socio open');
});

test('findMatchingCaptures returns multiple matches when same template captured twice', () => {
  const captures = [
    { url: 'https://x.example/portal/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/step', operator_context: 'first attempt' },
    { url: 'https://x.example/portal/12345678-9999-0000-1111-222222222222/step', operator_context: 'retry' },
    { url: 'https://x.example/other' },
  ];
  const matches = findMatchingCaptures('https://x.example/portal/ffffffff-aaaa-bbbb-cccc-dddddddddddd/step', captures);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].index, 1);
  assert.equal(matches[1].index, 2);
});

test('findMatchingCaptures preserves explicit `index` from capture meta', () => {
  // /state/ endpoint pre-numbers captures; we must trust that 1-based index.
  const captures = [
    { index: 7, url: 'https://x.example/page-a' },
  ];
  const matches = findMatchingCaptures('https://x.example/page-a', captures);
  assert.equal(matches[0].index, 7);
});

test('findMatchingCaptures handles missing currentUrl', () => {
  assert.deepEqual(findMatchingCaptures('', [{ url: 'https://x' }]), []);
  assert.deepEqual(findMatchingCaptures(null, [{ url: 'https://x' }]), []);
});
