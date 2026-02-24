import test from 'node:test';
import assert from 'node:assert/strict';

import {
  debounce,
  levenshteinDistance,
  normalizeString,
  normalizeTokens
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
