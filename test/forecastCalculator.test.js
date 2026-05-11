import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateForecast } from '../src/domain/forecastCalculator.js';

test('通常ケース: exclusive で予測値を算出する', () => {
  const result = calculateForecast({
    actual: 30,
    elapsedWorkingDays: 10,
    totalWorkingDays: 20,
    total: 50,
    buffer: 10,
    budgetMode: 'exclusive',
    today: '2026-05-10',
    remainingWorkingDays: ['2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15']
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.averageVelocity, 3);
  assert.equal(result.predictedTotalEffort, 60);
  assert.equal(result.remainingEffort, 30);
  assert.equal(result.exceededEffort, 0);
  assert.equal(result.depletionDate, null);
});

test('actual=0 の場合は insufficient_data', () => {
  const result = calculateForecast({
    actual: 0,
    elapsedWorkingDays: 10,
    totalWorkingDays: 20,
    total: 50,
    buffer: 10,
    budgetMode: 'exclusive',
    today: '2026-05-10',
    remainingWorkingDays: []
  });

  assert.equal(result.status, 'insufficient_data');
});

test('期間終了済みの場合は period_closed', () => {
  const result = calculateForecast({
    actual: 10,
    elapsedWorkingDays: 5,
    totalWorkingDays: 20,
    total: 50,
    buffer: 10,
    budgetMode: 'inclusive',
    today: '2026-05-10',
    endDate: '2026-05-01',
    remainingWorkingDays: []
  });

  assert.equal(result.status, 'period_closed');
});

test('予算超過時は exceededEffort と depletionDate=today', () => {
  const result = calculateForecast({
    actual: 70,
    elapsedWorkingDays: 10,
    totalWorkingDays: 20,
    total: 50,
    buffer: 10,
    budgetMode: 'exclusive',
    today: '2026-05-10',
    remainingWorkingDays: ['2026-05-11']
  });

  assert.equal(result.remainingEffort, -10);
  assert.equal(result.exceededEffort, 10);
  assert.equal(result.depletionDate, '2026-05-10');
});

test('枯渇予測をバッファ除外/込みの2系統で返す', () => {
  const result = calculateForecast({
    actual: 20,
    elapsedWorkingDays: 10,
    totalWorkingDays: 30,
    total: 30,
    buffer: 10,
    budgetMode: 'inclusive',
    today: '2026-05-10',
    remainingWorkingDays: [
      '2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15',
      '2026-05-18', '2026-05-19', '2026-05-20', '2026-05-21', '2026-05-22'
    ]
  });

  assert.equal(result.depletionDateWithoutBuffer, '2026-05-15');
  assert.equal(result.depletionDateWithBuffer, '2026-05-22');
  assert.equal(result.depletionDate, '2026-05-15');
});
