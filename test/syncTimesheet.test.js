import test from 'node:test';
import assert from 'node:assert/strict';
import { syncTimesheetUsecase } from '../src/application/usecases/syncTimesheet.js';

const baseProject = {
  config: {
    projectId: 'alpha',
    schemaVersion: '1.0.0',
    schedule: { startDate: '2026-05-01', endDate: '2026-06-30' },
    effort: { total: 100, buffer: 10, actual: 0, budgetMode: 'inclusive' },
    members: [],
    calendar: { holidays: [], holidaySources: [] },
  },
};

test('CSV を読み込んで合計が effort.actual に設定される', async () => {
  const csvContent = 'Alice,8.0\nBob,6.5\nCarol,7.0\n';
  const saved = [];

  const result = await syncTimesheetUsecase({
    project: baseProject,
    readFile: async () => csvContent,
    saveProjectConfig: async (config) => { saved.push(config); },
  });

  assert.ok(result.ok);
  assert.equal(result.project.config.effort.actual, 21.5);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].effort.actual, 21.5);
});

test('JSON を読み込んで合計が effort.actual に設定される', async () => {
  const jsonContent = JSON.stringify([
    { name: 'Alice', hours: 8.0 },
    { name: 'Bob',   hours: 6.5 },
  ]);
  const saved = [];

  const result = await syncTimesheetUsecase({
    project: baseProject,
    sourceType: 'json',
    readFile: async () => jsonContent,
    saveProjectConfig: async (config) => { saved.push(config); },
  });

  assert.ok(result.ok);
  assert.equal(result.project.config.effort.actual, 14.5);
});

test('timesheetSource 未設定時は ok:false で警告通知を返す', async () => {
  const result = await syncTimesheetUsecase({
    project: baseProject,
    readFile: async () => '',
    saveProjectConfig: async () => {},
    sourceType: null,
    sourcePath: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.notification.level, 'warn');
});

test('ファイル読み込みエラー時は ok:false でエラー通知を返す', async () => {
  const result = await syncTimesheetUsecase({
    project: baseProject,
    readFile: async () => { throw new Error('file not found'); },
    saveProjectConfig: async () => {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.notification.level, 'error');
});

test('空のCSVは actual を 0 に設定する', async () => {
  const result = await syncTimesheetUsecase({
    project: baseProject,
    readFile: async () => '',
    saveProjectConfig: async () => {},
  });

  assert.ok(result.ok);
  assert.equal(result.project.config.effort.actual, 0);
});

test('3列CSV を解析して monthlyBreakdown が生成される', async () => {
  const csvContent = 'Alice,2026-04,40.0\nAlice,2026-05,20.0\nBob,2026-04,32.0\n';
  const result = await syncTimesheetUsecase({
    project: baseProject,
    readFile: async () => csvContent,
    saveProjectConfig: async () => {},
  });

  assert.ok(result.ok);
  assert.equal(result.project.config.effort.actual, 92.0);
  assert.deepEqual(result.monthlyBreakdown.members, ['Alice', 'Bob']);
  assert.deepEqual(result.monthlyBreakdown.months, ['2026-04', '2026-05']);
  assert.deepEqual(result.monthlyBreakdown.data, {
    '2026-04': { Alice: 40.0, Bob: 32.0 },
    '2026-05': { Alice: 20.0 },
  });
});

test('ネストJSON を解析して monthlyBreakdown が生成される', async () => {
  const jsonContent = JSON.stringify([
    { name: 'Alice', months: { '2026-04': 40.0, '2026-05': 20.0 } },
    { name: 'Bob',   months: { '2026-04': 32.0 } },
  ]);
  const result = await syncTimesheetUsecase({
    project: baseProject,
    sourceType: 'json',
    readFile: async () => jsonContent,
    saveProjectConfig: async () => {},
  });

  assert.ok(result.ok);
  assert.equal(result.project.config.effort.actual, 92.0);
  assert.deepEqual(result.monthlyBreakdown.members, ['Alice', 'Bob']);
  assert.deepEqual(result.monthlyBreakdown.months, ['2026-04', '2026-05']);
  assert.deepEqual(result.monthlyBreakdown.data, {
    '2026-04': { Alice: 40.0, Bob: 32.0 },
    '2026-05': { Alice: 20.0 },
  });
});
