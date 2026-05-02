import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isDropdownField,
  resolveOptionMatch
} from '../src/fillPlanner.js';

test('isDropdownField recognizes select and combobox-like widgets', () => {
  assert.equal(isDropdownField({ tag: 'select', widgetKind: 'native-select' }), true);
  assert.equal(isDropdownField({ tag: 'div', widgetKind: 'custom-combobox' }), true);
  assert.equal(isDropdownField({ tag: 'input', widgetKind: 'native-input' }), false);
});

test('resolveOptionMatch returns high confidence for matching option', () => {
  const result = resolveOptionMatch(
    {
      options: [
        { text: 'Italy', value: 'it' },
        { text: 'France', value: 'fr' }
      ]
    },
    'Italy'
  );

  assert.equal(result.option.text, 'Italy');
  assert.ok(result.confidence >= 0.9);
});

test('resolveOptionMatch returns no_options when field has no options', () => {
  const result = resolveOptionMatch({ options: [] }, 'anything');
  assert.equal(result.option, null);
  assert.equal(result.reason, 'no_options');
});
