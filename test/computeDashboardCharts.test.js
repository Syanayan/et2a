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

// --- computeBurndown ---

test('computeBurndown returns one entry per history record', () => {
  const history = [
    { date: '2026-05-01', actual: 5 },
    { date: '2026-05-02', actual: 10 },
    { date: '2026-05-05', actual: 18 },
  ];
  const result = computeBurndown(history, project);
  assert.equal(result.length, 3);
});

test('computeBurndown includes actual and predicted fields', () => {
  const history = [{ date: '2026-05-01', actual: 5 }];
  const result = computeBurndown(history, project);
  assert.ok('actual' in result[0]);
  assert.ok('predicted' in result[0]);
  assert.ok('date' in result[0]);
});

test('computeBurndown entries are sorted by date', () => {
  const history = [
    { date: '2026-05-05', actual: 18 },
    { date: '2026-05-01', actual: 5 },
  ];
  const result = computeBurndown(history, project);
  assert.equal(result[0].date, '2026-05-01');
  assert.equal(result[1].date, '2026-05-05');
});

test('computeBurndown returns empty array for empty history', () => {
  const result = computeBurndown([], project);
  assert.deepEqual(result, []);
});
