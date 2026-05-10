import test from 'node:test';
import assert from 'node:assert/strict';
import { activate } from '../src/extension.js';

test('extension entrypoint activates', () => {
  assert.deepEqual(activate(), { status: 'activated' });
});
