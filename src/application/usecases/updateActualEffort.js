import { calculateForecast } from '../../domain/forecastCalculator.js';
import { evaluateAlert } from '../../domain/alertEvaluator.js';
import { validateProjectConfig } from '../../infrastructure/configValidator.js';

export async function updateActualEffort(params) {
  const {
    project,
    nextActual,
    elapsedWorkingDays,
    totalWorkingDays,
    today,
    remainingWorkingDays,
    saveProjectConfig,
    appendAuditLog,
  } = params;

  const nextConfig = {
    ...project.config,
    effort: {
      ...project.config.effort,
      actual: nextActual,
    },
  };

  const validation = validateProjectConfig(nextConfig);
  if (!validation.ok) {
    await safeAudit(appendAuditLog, {
      action: 'update_actual_effort',
      projectId: nextConfig.projectId,
      nextActual,
      result: 'validation_error',
      error: validation.error,
    });

    return {
      ok: false,
      error: validation.error,
      notification: { level: 'error', message: validation.error.message },
    };
  }

  await saveProjectConfig(nextConfig);

  const forecast = calculateForecast({
    actual: nextConfig.effort.actual,
    elapsedWorkingDays,
    totalWorkingDays,
    total: nextConfig.effort.total,
    buffer: nextConfig.effort.buffer,
    budgetMode: nextConfig.effort.budgetMode ?? 'inclusive',
    today,
    endDate: nextConfig.schedule?.endDate,
    remainingWorkingDays,
  });

  const alert = evaluateAlert(nextConfig.effort, {
    actual: nextConfig.effort.actual,
    predictedTotalEffort: forecast.predictedTotalEffort,
  });

  await safeAudit(appendAuditLog, {
    action: 'update_actual_effort',
    projectId: nextConfig.projectId,
    nextActual,
    forecastStatus: forecast.status,
    alertLevel: alert.level,
    result: 'success',
  });

  return {
    ok: true,
    project: { ...project, config: nextConfig },
    forecast,
    alert,
    notification: { level: 'info', message: 'Actual effort updated' },
  };
}

async function safeAudit(appendAuditLog, entry) {
  if (typeof appendAuditLog !== 'function') {
    return;
  }

  await appendAuditLog({ entry });
}
