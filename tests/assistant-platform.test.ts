// Created by Cory McCabe
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantPlatform } from '../lib/assistant-instructions';

void test('instructions and launch routing recognize iPhone, desktop-style iPadOS, Mac, and other browsers', () => {
  assert.equal(assistantPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)', 5), 'ios');
  assert.equal(assistantPlatform('Mozilla/5.0 (iPad; CPU OS 27_0 like Mac OS X)', 5), 'ios');
  assert.equal(assistantPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 5), 'ios');
  assert.equal(assistantPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 0), 'macos');
  assert.equal(assistantPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0), 'web');
});
