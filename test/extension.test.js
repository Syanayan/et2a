import test from 'node:test';
import assert from 'node:assert/strict';
import { activate } from '../src/extension.js';

test('extension entrypoint activates', () => {
  const result = activate();
  assert.equal(result.status, 'activated');
  assert.equal(typeof result.updateDashboard, 'function');
  assert.equal(typeof result.notifyDashboardError, 'function');
});
