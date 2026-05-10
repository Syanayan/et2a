const ceil = Math.ceil;

/**
 * @param {{
 * actual:number,
 * elapsedWorkingDays:number,
 * totalWorkingDays:number,
 * total:number,
 * buffer:number,
 * budgetMode:'inclusive'|'exclusive',
 * today:string,
 * endDate?:string,
 * remainingWorkingDays:string[],
 * previousOkResult?:{averageVelocity:number,predictedTotalEffort:number,remainingEffort:number,depletionDate?:string|null,exceededEffort:number}
 * }} input
 */
export function calculateForecast(input) {
  if (input.endDate && input.endDate < input.today) {
    return baseResult('period_closed');
  }

  if (input.actual === 0 || input.elapsedWorkingDays === 0) {
    return baseResult('insufficient_data');
  }

  const averageVelocity = input.actual / input.elapsedWorkingDays;
  const predictedTotalEffort = averageVelocity * input.totalWorkingDays;
  const budget = input.budgetMode === 'exclusive' ? input.total + input.buffer : input.total;
  const remainingEffort = budget - input.actual;

  if (!Number.isFinite(averageVelocity) || !Number.isFinite(predictedTotalEffort)) {
    if (input.previousOkResult) {
      return {
        status: 'ok',
        ...input.previousOkResult
      };
    }
    return baseResult('insufficient_data');
  }

  let depletionDate = null;
  let exceededEffort = 0;

  if (remainingEffort < 0) {
    depletionDate = input.today;
    exceededEffort = Math.abs(remainingEffort);
  } else if (averageVelocity > 0) {
    const daysToDeplete = ceil(remainingEffort / averageVelocity);
    depletionDate = input.remainingWorkingDays[daysToDeplete - 1] ?? null;
  }

  return {
    status: 'ok',
    averageVelocity,
    predictedTotalEffort,
    remainingEffort,
    depletionDate,
    exceededEffort
  };
}

function baseResult(status) {
  return {
    status,
    averageVelocity: 0,
    predictedTotalEffort: 0,
    remainingEffort: 0,
    depletionDate: null,
    exceededEffort: 0
  };
}
