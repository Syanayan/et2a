import test from 'node:test';
import assert from 'node:assert/strict';
import { updateActualEffort } from '../src/application/usecases/updateActualEffort.js';

function baseProject() {
  return {
    config: {
      projectId: 'p001',
      schedule: { startDate: '2026-05-01', endDate: '2026-05-31' },
      effort: { total: 100, buffer: 20, actual: 40, budgetMode: 'inclusive' },
      members: [{ name: 'Alice', dailyEffort: 1.0 }],
    },
  };
}

test('recalculates forecast after updating actual effort and persists config', async () => {
  const project = baseProject();
  let savedConfig = null;
  const auditEntries = [];

  const result = await updateActualEffort({
    project,
    nextActual: 50,
    elapsedWorkingDays: 10,
    totalWorkingDays: 20,
    today: '2026-05-20',
    remainingWorkingDays: ['2026-05-21', '2026-05-22', '2026-05-23'],
    saveProjectConfig: async (config) => {
      savedConfig = config;
    },
    appendAuditLog: async ({ entry }) => {
      auditEntries.push(entry);
    },
  });

  assert.equal(savedConfig.effort.actual, 50);
  assert.equal(result.forecast.status, 'ok');
  assert.equal(result.forecast.predictedTotalEffort, 100);
  assert.equal(result.alert.level, 'normal');
  assert.equal(auditEntries.at(-1).result, 'success');
});

test('does not save and returns validation_error when updated config is invalid', async () => {
  const project = baseProject();
  project.config.members[0].dailyEffort = 9;

  let saveCalled = false;
  const auditEntries = [];
  const result = await updateActualEffort({
    project,
    nextActual: 50,
    elapsedWorkingDays: 10,
    totalWorkingDays: 20,
    today: '2026-05-20',
    remainingWorkingDays: [],
    saveProjectConfig: async () => {
      saveCalled = true;
    },
    appendAuditLog: async ({ entry }) => {
      auditEntries.push(entry);
    },
  });

  assert.equal(saveCalled, false);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'validation_error');
  assert.equal(auditEntries.at(-1).result, 'validation_error');
});
