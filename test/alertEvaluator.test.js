import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlert } from '../src/domain/alertEvaluator.js';

test('exclusive: 正常→注意→警告の境界判定', () => {
  const config = { total: 100, buffer: 20, budgetMode: 'exclusive' };

  const normal = evaluateAlert(config, { actual: 79, predictedTotalEffort: 120 });
  assert.equal(normal.level, 'normal');

  const warningByPredicted = evaluateAlert(config, { actual: 79, predictedTotalEffort: 121 });
  assert.equal(warningByPredicted.level, 'critical');

  const cautionAtThreshold = evaluateAlert(config, { actual: 80, predictedTotalEffort: 110 });
  assert.equal(cautionAtThreshold.level, 'warning');

  const cautionAtHard = evaluateAlert(config, { actual: 120, predictedTotalEffort: 110 });
  assert.equal(cautionAtHard.level, 'warning');

  const criticalOverHard = evaluateAlert(config, { actual: 121, predictedTotalEffort: 110 });
  assert.equal(criticalOverHard.level, 'critical');
});

test('inclusive: thresholdHard が total になる', () => {
  const config = { total: 100, buffer: 20, budgetMode: 'inclusive' };

  const caution = evaluateAlert(config, { actual: 95, predictedTotalEffort: 99 });
  assert.equal(caution.level, 'warning');

  const criticalByPredicted = evaluateAlert(config, { actual: 70, predictedTotalEffort: 101 });
  assert.equal(criticalByPredicted.level, 'critical');
});
