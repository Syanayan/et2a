import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWorkingDays } from '../src/domain/workingDayCalculator.js';

test('土日を除外する', () => {
  const result = calculateWorkingDays('2026-05-08', '2026-05-12', {
    personalHolidays: [],
    companyHolidays: []
  });

  assert.deepEqual(result.workingDays, ['2026-05-08', '2026-05-11', '2026-05-12']);
});

test('重複休暇は1日として扱う', () => {
  const result = calculateWorkingDays('2026-05-11', '2026-05-13', {
    personalHolidays: ['2026-05-12'],
    companyHolidays: ['2026-05-12']
  });

  assert.deepEqual(result.workingDays, ['2026-05-11', '2026-05-13']);
  assert.equal(result.excludedDates.length, 1);
});

test('start=end 境界ケース', () => {
  const result = calculateWorkingDays('2026-05-12', '2026-05-12', {
    personalHolidays: [],
    companyHolidays: []
  });

  assert.deepEqual(result.workingDays, ['2026-05-12']);
});
