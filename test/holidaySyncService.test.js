import test from 'node:test';
import assert from 'node:assert/strict';
import { syncHolidays } from '../src/infrastructure/holidaySyncService.js';

test('returns merged and sorted holidays when all sources succeed', async () => {
  const sources = [
    { kind: 'company', type: 'file', path: '/tmp/company.json' },
    { kind: 'member', type: 'csv', path: '/tmp/member.csv' },
  ];

  const result = await syncHolidays({
    sources,
    currentHolidays: ['2026-01-02'],
    loaders: {
      file: async () => ['2026-01-01', '2026-01-03'],
      csv: async () => ['2026-01-03', '2026-01-04'],
      api: async () => [],
    },
    sleep: async () => {},
  });

  assert.equal(result.success, true);
  assert.equal(result.fallbackUsed, false);
  assert.deepEqual(result.holidays, ['2026-01-01', '2026-01-03', '2026-01-04']);
  assert.equal(result.warningState, null);
});

test('retries with exponential backoff delays 1000ms, 2000ms, 4000ms', async () => {
  const delays = [];
  let attempts = 0;

  const result = await syncHolidays({
    sources: [{ kind: 'company', type: 'api', endpoint: 'https://example.com' }],
    currentHolidays: [],
    loaders: {
      file: async () => [],
      csv: async () => [],
      api: async () => {
        attempts += 1;
        if (attempts < 4) {
          throw new Error('temporary failure');
        }
        return ['2026-02-11'];
      },
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.fallbackUsed, false);
  assert.deepEqual(result.holidays, ['2026-02-11']);
  assert.deepEqual(delays, [1000, 2000, 4000]);
  assert.equal(attempts, 4);
});

test('falls back to current holidays when all retries fail', async () => {
  const result = await syncHolidays({
    sources: [{ kind: 'company', type: 'api', endpoint: 'https://example.com' }],
    currentHolidays: ['2026-03-20'],
    loaders: {
      file: async () => [],
      csv: async () => [],
      api: async () => {
        throw new Error('down');
      },
    },
    sleep: async () => {},
  });

  assert.equal(result.success, false);
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(result.holidays, ['2026-03-20']);
  assert.equal(result.warningState, 'holiday_sync_fallback');
  assert.equal(result.errors.length, 4);
});
