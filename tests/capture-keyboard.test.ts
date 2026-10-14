// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCaptureKeyDown } from '../lib/capture-keyboard';

function key(overrides = {}) {
  let prevented = false;
  const event = {
    key: 'Enter',
    shiftKey: false,
    repeat: false,
    nativeEvent: { isComposing: false, keyCode: 13 },
    preventDefault: () => { prevented = true; },
    ...overrides,
  };
  return { event, prevented: () => prevented };
}

void test('Enter submits capture once and does not insert a newline', () => {
  const input = key();
  let submissions = 0;
  handleCaptureKeyDown(input.event, () => { submissions++; });
  assert.equal(submissions, 1);
  assert.equal(input.prevented(), true);
});

void test('Shift+Enter preserves normal multiline input', () => {
  const input = key({ shiftKey: true });
  handleCaptureKeyDown(input.event, () => assert.fail('Unexpected submission'));
  assert.equal(input.prevented(), false);
});

void test('IME confirmation is not treated as capture submission', () => {
  for (const nativeEvent of [
    { isComposing: true, keyCode: 13 },
    { isComposing: false, keyCode: 229 },
  ]) {
    const input = key({ nativeEvent });
    handleCaptureKeyDown(input.event, () => assert.fail('Unexpected submission'));
    assert.equal(input.prevented(), false);
  }
});

void test('holding Enter neither resubmits capture nor adds newlines', () => {
  const input = key({ repeat: true });
  handleCaptureKeyDown(input.event, () => assert.fail('Unexpected submission'));
  assert.equal(input.prevented(), true);
});

void test('other keys keep their normal behavior', () => {
  for (const value of ['Escape', 'Tab', 'a']) {
    const input = key({ key: value });
    handleCaptureKeyDown(input.event, () => assert.fail('Unexpected submission'));
    assert.equal(input.prevented(), false);
  }
});
