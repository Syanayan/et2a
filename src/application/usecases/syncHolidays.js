import { syncHolidays as syncHolidaysService } from '../../infrastructure/holidaySyncService.js';

export async function syncHolidaysUsecase(params) {
  const {
    project,
    dryRun = false,
    syncHolidays = syncHolidaysService,
    saveProjectConfig,
    appendAuditLog,
  } = params;

  const currentHolidays = project?.config?.calendar?.holidays ?? [];
  const sources = project?.config?.calendar?.holidaySources ?? [];

  const result = await syncHolidays({
    sources,
    currentHolidays,
  });

  let nextProject = project;

  if (!dryRun) {
    const nextConfig = {
      ...project.config,
      calendar: {
        ...project.config.calendar,
        holidays: result.holidays,
      },
    };

    if (typeof saveProjectConfig === 'function') {
      await saveProjectConfig(nextConfig);
    }

    nextProject = { ...project, config: nextConfig };
  }

  await safeAudit(appendAuditLog, {
    action: 'sync_holidays',
    projectId: project?.config?.projectId,
    dryRun,
    result: result.success ? 'success' : 'fallback',
    warningState: result.warningState,
    errorCount: result.errors?.length ?? 0,
  });

  return {
    ok: true,
    project: nextProject,
    result,
    dashboardState: {
      warningState: result.warningState,
      holidaySync: {
        success: result.success,
        fallbackUsed: result.fallbackUsed,
        errorCount: result.errors.length,
      },
    },
    notification: {
      level: result.success ? 'info' : 'warning',
      message: result.success ? 'Holiday sync completed' : 'Holiday sync fallback in use',
    },
  };
}

async function safeAudit(appendAuditLog, entry) {
  if (typeof appendAuditLog !== 'function') {
    return;
  }

  await appendAuditLog({ entry });
}
