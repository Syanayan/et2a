import test from 'node:test';
import assert from 'node:assert/strict';
import { syncHolidaysUsecase } from '../src/application/usecases/syncHolidays.js';

test('dryRun does not persist and returns notification and dashboard status', async () => {
  let savedConfig = null;
  let auditEntry = null;

  const project = {
    config: {
      projectId: 'alpha',
      calendar: {
        holidaySources: [{ kind: 'company', type: 'file', path: '/tmp/company.json' }],
        holidays: ['2026-01-01'],
      },
    },
  };

  const result = await syncHolidaysUsecase({
    project,
    dryRun: true,
    syncHolidays: async () => ({
      success: true,
      fallbackUsed: false,
      holidays: ['2026-01-01', '2026-01-02'],
      warningState: null,
      errors: [],
    }),
    saveProjectConfig: async (config) => {
      savedConfig = config;
    },
    appendAuditLog: async ({ entry }) => {
      auditEntry = entry;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(savedConfig, null);
  assert.deepEqual(result.project.config.calendar.holidays, ['2026-01-01']);
  assert.deepEqual(result.result.holidays, ['2026-01-01', '2026-01-02']);
  assert.equal(result.notification.level, 'info');
  assert.equal(result.dashboardState.warningState, null);
  assert.equal(auditEntry.result, 'success');
  assert.equal(auditEntry.dryRun, true);
});

test('apply mode persists synced holidays into project config', async () => {
  let savedConfig = null;

  const project = {
    config: {
      projectId: 'alpha',
      calendar: {
        holidaySources: [{ kind: 'company', type: 'api', endpoint: 'https://example.com' }],
        holidays: ['2026-03-10'],
      },
    },
  };

  const result = await syncHolidaysUsecase({
    project,
    dryRun: false,
    syncHolidays: async () => ({
      success: true,
      fallbackUsed: false,
      holidays: ['2026-03-11', '2026-03-12'],
      warningState: null,
      errors: [],
    }),
    saveProjectConfig: async (config) => {
      savedConfig = config;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(savedConfig.calendar.holidays, ['2026-03-11', '2026-03-12']);
  assert.deepEqual(result.project.config.calendar.holidays, ['2026-03-11', '2026-03-12']);
  assert.equal(result.notification.message, 'Holiday sync completed');
});
