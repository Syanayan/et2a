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
 * previousOkResult?:{averageVelocity:number,predictedTotalEffort:number,remainingEffort:number,depletionDate?:string|null,depletionDateWithoutBuffer?:string|null,depletionDateWithBuffer?:string|null,exceededEffort:number}
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

  const depletionDateWithoutBuffer = calculateDepletionDate({
    budget: input.total,
    actual: input.actual,
    averageVelocity,
    today: input.today,
    remainingWorkingDays: input.remainingWorkingDays
  });
  const depletionDateWithBuffer = calculateDepletionDate({
    budget: input.total + input.buffer,
    actual: input.actual,
    averageVelocity,
    today: input.today,
    remainingWorkingDays: input.remainingWorkingDays
  });
  const depletionDate = input.budgetMode === 'exclusive'
    ? depletionDateWithBuffer
    : depletionDateWithoutBuffer;
  const exceededEffort = Math.max(0, input.actual - budget);

  return {
    status: 'ok',
    averageVelocity,
    predictedTotalEffort,
    remainingEffort,
    depletionDate,
    depletionDateWithoutBuffer,
    depletionDateWithBuffer,
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
    depletionDateWithoutBuffer: null,
    depletionDateWithBuffer: null,
    exceededEffort: 0
  };
}

function calculateDepletionDate({ budget, actual, averageVelocity, today, remainingWorkingDays }) {
  const remaining = budget - actual;
  if (remaining < 0) return today;
  if (averageVelocity <= 0) return null;
  const daysToDeplete = ceil(remaining / averageVelocity);
  return remainingWorkingDays[daysToDeplete - 1] ?? null;
}
