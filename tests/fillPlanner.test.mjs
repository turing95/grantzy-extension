import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFillPlan,
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

test('buildFillPlan maps best matching grantzy field for input field', () => {
  const plan = buildFillPlan({
    formFields: [
      {
        fieldId: 'field_1',
        signature: 'sig_1',
        tag: 'input',
        inputType: 'text',
        label: 'Company Legal Name',
        name: 'company_name',
        idAttr: 'company-name',
        placeholder: 'Type legal name',
        pathHint: '#company-name',
        widgetKind: 'native-input'
      }
    ],
    grantzyFields: [
      { key: 'company legal name', value: 'ACME SRL' },
      { key: 'contact email', value: 'hello@example.com' }
    ]
  });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].grantzyKey, 'company legal name');
  assert.equal(plan[0].grantzyValue, 'ACME SRL');
  assert.notEqual(plan[0].status, 'skipped');
});

test('buildFillPlan carries dropdown option mapping when select options match', () => {
  const plan = buildFillPlan({
    formFields: [
      {
        fieldId: 'field_2',
        signature: 'sig_2',
        tag: 'select',
        inputType: '',
        label: 'Country',
        name: 'country',
        idAttr: 'country',
        placeholder: '',
        pathHint: '#country',
        widgetKind: 'native-select',
        options: [
          { text: 'Italy', value: 'it' },
          { text: 'France', value: 'fr' }
        ]
      }
    ],
    grantzyFields: [
      { key: 'country', value: 'Italy' }
    ]
  });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].grantzyKey, 'country');
  assert.equal(plan[0].dropdownOption.text, 'Italy');
  assert.notEqual(plan[0].status, 'skipped');
});
