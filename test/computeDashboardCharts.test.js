import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWeeklyEffort, computeBurndown } from '../src/application/computeDashboardCharts.js';

const project = {
  config: {
    schedule: { startDate: '2026-05-01', endDate: '2026-05-31' },
    effort: { total: 100, buffer: 10, actual: 0, budgetMode: 'inclusive' },
    calendar: { holidays: [] },
  },
};

// --- computeWeeklyEffort ---

test('computeWeeklyEffort returns 5 entries for Mon-Fri of the given week', () => {
  const history = [];
  const result = computeWeeklyEffort(history, project, '2026-05-19', 20);
  assert.equal(result.length, 5);
  assert.deepEqual(result.map((r) => r.day), ['月', '火', '水', '木', '金']);
});

test('computeWeeklyEffort returns correct Mon-Fri dates for a Tuesday', () => {
  const history = [];
  const result = computeWeeklyEffort(history, project, '2026-05-19', 20);
  assert.equal(result[0].date, '2026-05-18'); // 月
  assert.equal(result[1].date, '2026-05-19'); // 火
  assert.equal(result[4].date, '2026-05-22'); // 金
});

test('computeWeeklyEffort sets planned as total/totalWorkingDays per day', () => {
  const history = [];
  const result = computeWeeklyEffort(history, project, '2026-05-19', 20);
  assert.equal(result[0].planned, 5); // 100 / 20
});

test('computeWeeklyEffort derives actual from cumulative history deltas', () => {
  const history = [
    { date: '2026-05-18', actual: 5 },
    { date: '2026-05-19', actual: 12 },
  ];
  const result = computeWeeklyEffort(history, project, '2026-05-19', 20);
  assert.equal(result[0].actual, 5);  // 月: 5 - 0
  assert.equal(result[1].actual, 7);  // 火: 12 - 5
  assert.equal(result[2].actual, 0);  // 水: no entry
});

test('computeWeeklyEffort returns 0 actual for days not in history', () => {
  const history = [];
  const result = computeWeeklyEffort(history, project, '2026-05-19', 20);
  assert.ok(result.every((r) => r.actual === 0));
});

// --- computeBurndown (月次バーンダウン) ---

const bdProject = {
  config: {
    schedule: { startDate: '2026-04-01', endDate: '2026-06-30' },
    effort: { total: 200, buffer: 20, actual: 0, budgetMode: 'inclusive' },
    calendar: { holidays: [] },
  },
};

test('computeBurndown returns one entry per month from startDate to endDate', () => {
  const result = computeBurndown(null, bdProject);
  assert.equal(result.length, 3);
  assert.equal(result[0].month, '2026-04');
  assert.equal(result[1].month, '2026-05');
  assert.equal(result[2].month, '2026-06');
});

test('computeBurndown ideal line decreases linearly from total to 0', () => {
  const result = computeBurndown(null, bdProject);
  assert.equal(result[0].ideal, 200);
  assert.equal(result[result.length - 1].ideal, 0);
});

test('computeBurndown remaining is null when no monthly data', () => {
  const result = computeBurndown(null, bdProject);
  assert.ok(result.every((r) => r.remaining === null));
});

test('computeBurndown remaining decreases as cumulative effort increases', () => {
  const monthly = {
    members: ['Alice', 'Bob'],
    months: ['2026-04', '2026-05'],
    data: {
      '2026-04': { Alice: 40, Bob: 32 },  // 累計 72
      '2026-05': { Alice: 20 },            // 累計 92
    },
  };
  const result = computeBurndown(monthly, bdProject);
  assert.equal(result.find((r) => r.month === '2026-04').remaining, 128); // 200-72
  assert.equal(result.find((r) => r.month === '2026-05').remaining, 108); // 200-92
  assert.equal(result.find((r) => r.month === '2026-06').remaining, null); // データなし
});

test('computeBurndown predicted extends linearly from last actual to 0 at end', () => {
  const monthly = {
    members: ['Alice'],
    months: ['2026-04'],
    data: { '2026-04': { Alice: 80 } }, // 累計80, 残120
  };
  const result = computeBurndown(monthly, bdProject);
  assert.equal(result[0].predicted, 120); // 最終実績点
  assert.equal(result[result.length - 1].predicted, 0); // 終了日に0
});

test('computeBurndown predicted ends at total-effort.predicted when set', () => {
  const proj = {
    config: {
      ...bdProject.config,
      effort: { ...bdProject.config.effort, predicted: 160 },
    },
  };
  const monthly = {
    members: ['Alice'],
    months: ['2026-04'],
    data: { '2026-04': { Alice: 40 } }, // 残160
  };
  const result = computeBurndown(monthly, proj);
  // 終了日: predicted = total - effort.predicted = 200 - 160 = 40
  assert.equal(result[result.length - 1].predicted, 40);
});

test('computeBurndown returns empty array when project has no schedule', () => {
  const result = computeBurndown(null, { config: { effort: { total: 100 } } });
  assert.deepEqual(result, []);
});
