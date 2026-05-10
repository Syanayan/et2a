/**
 * @param {{ total:number, buffer:number, budgetMode:'inclusive'|'exclusive' }} config
 * @param {{ actual:number, predictedTotalEffort:number }} forecast
 */
export function evaluateAlert(config, forecast) {
  const thresholdActual = config.total - config.buffer;
  const thresholdHard = config.budgetMode === 'exclusive' ? config.total + config.buffer : config.total;

  if (forecast.actual > thresholdHard || forecast.predictedTotalEffort > thresholdHard) {
    return { level: 'critical', reason: 'exceeded_hard_threshold' };
  }

  if (forecast.actual >= thresholdActual && forecast.actual <= thresholdHard) {
    return { level: 'warning', reason: 'entered_buffer_zone' };
  }

  return { level: 'normal', reason: 'within_budget' };
}
