import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectConfig } from '../src/infrastructure/configValidator.js';

test('accepts valid config', () => {
  const result = validateProjectConfig({
    projectId: 'p_001-abc',
    schedule: { startDate: '2026-05-01', endDate: '2026-05-31' },
    effort: { total: 100, buffer: 20, actual: 10 },
    members: [{ name: 'Alice', dailyEffort: 1.0 }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, null);
});

test('returns validation_error for invalid projectId pattern', () => {
  const result = validateProjectConfig({
    projectId: 'x'.repeat(65),
    schedule: { startDate: '2026-05-01', endDate: '2026-05-31' },
    effort: { total: 100, buffer: 20, actual: 10 },
    members: [{ name: 'Alice', dailyEffort: 1.0 }],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'validation_error',
      message: 'projectId must match [a-zA-Z0-9_-]{1,64}',
      field: 'projectId',
    },
  });
});

test('returns validation_error for malformed date format', () => {
  const result = validateProjectConfig({
    projectId: 'p001',
    schedule: { startDate: '2026-5-01', endDate: '2026-05-31' },
    effort: { total: 100, buffer: 20, actual: 10 },
    members: [{ name: 'Alice', dailyEffort: 1.0 }],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'validation_error',
      message: 'schedule.startDate must be YYYY-MM-DD',
      field: 'schedule.startDate',
    },
  });
});

test('returns validation_error when startDate is after endDate', () => {
  const result = validateProjectConfig({
    projectId: 'p001',
    schedule: { startDate: '2026-06-01', endDate: '2026-05-31' },
    effort: { total: 100, buffer: 20, actual: 10 },
    members: [{ name: 'Alice', dailyEffort: 1.0 }],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'validation_error',
      message: 'schedule.startDate must be less than or equal to schedule.endDate',
      field: 'schedule',
    },
  });
});

test('returns validation_error for negative effort fields', () => {
  const result = validateProjectConfig({
    projectId: 'p001',
    schedule: { startDate: '2026-05-01', endDate: '2026-05-31' },
    effort: { total: -1, buffer: 20, actual: 10 },
    members: [{ name: 'Alice', dailyEffort: 1.0 }],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'validation_error',
      message: 'effort.total must be greater than or equal to 0',
      field: 'effort.total',
    },
  });
});

test('returns validation_error when member dailyEffort is out of range', () => {
  const result = validateProjectConfig({
    projectId: 'p001',
    schedule: { startDate: '2026-05-01', endDate: '2026-05-31' },
    effort: { total: 100, buffer: 20, actual: 10 },
    members: [{ name: 'Alice', dailyEffort: 2.0 }],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'validation_error',
      message: 'members[0].dailyEffort must be between 0.1 and 1.5',
      field: 'members[0].dailyEffort',
    },
  });
});
