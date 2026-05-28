export async function syncTimesheetUsecase(params) {
  const {
    project,
    sourceType = 'csv',
    sourcePath,
    readFile,
    saveProjectConfig,
  } = params;

  if (!sourceType) {
    return {
      ok: false,
      notification: { level: 'warn', message: 'Timesheet source is not configured.' },
    };
  }

  let total;
  let monthlyBreakdown = null;
  let projectUpdates = null;
  try {
    const content = await readFile(sourcePath);
    if (sourceType === 'json') {
      const parsed = (content ?? '').trim() ? JSON.parse(content) : [];
      if (isProjectJson(parsed)) {
        const result = parseProjectJson(parsed);
        monthlyBreakdown = result.monthlyBreakdown;
        total = totalFromBreakdown(monthlyBreakdown);
        projectUpdates = result.updates;
      } else if (isNestedJson(parsed)) {
        monthlyBreakdown = parseJsonMonthly(parsed);
        total = totalFromBreakdown(monthlyBreakdown);
      } else {
        total = (parsed ?? []).reduce((sum, row) => {
          const hours = parseFloat(row.hours ?? row.actual ?? 0);
          return sum + (Number.isFinite(hours) ? hours : 0);
        }, 0);
      }
    } else {
      if (isMonthlyCsv(content)) {
        monthlyBreakdown = parseCsvMonthly(content);
        total = totalFromBreakdown(monthlyBreakdown);
      } else {
        total = parseCsv(content);
      }
    }
  } catch (err) {
    return {
      ok: false,
      notification: { level: 'error', message: `Failed to read timesheet: ${err.message}` },
    };
  }

  let nextConfig = {
    ...project.config,
    effort: { ...project.config.effort, actual: total },
  };
  if (projectUpdates) {
    if (projectUpdates.total != null) {
      nextConfig = { ...nextConfig, effort: { ...nextConfig.effort, total: projectUpdates.total } };
    }
    if (projectUpdates.endDate || projectUpdates.startDate) {
      nextConfig = {
        ...nextConfig,
        schedule: {
          ...nextConfig.schedule,
          ...(projectUpdates.startDate ? { startDate: projectUpdates.startDate } : {}),
          ...(projectUpdates.endDate   ? { endDate:   projectUpdates.endDate   } : {}),
        },
      };
    }
  }

  await saveProjectConfig(nextConfig);

  return {
    ok: true,
    project: { ...project, config: nextConfig },
    monthlyBreakdown,
    notification: { level: 'info', message: `Timesheet synced. Total: ${total}` },
  };
}

function normalizeMonth(key) {
  const [year, month] = String(key).split('-');
  return `${year}-${String(month).padStart(2, '0')}`;
}

function isProjectJson(parsed) {
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && 'Users' in parsed;
}

function parseProjectJson(parsed) {
  const membersSet = new Set();
  const monthsSet = new Set();
  const data = {};

  (parsed.Users ?? []).forEach((user) => {
    const name = user.name;
    membersSet.add(name);
    Object.entries(user.manHour ?? {}).forEach(([rawMonth, hoursStr]) => {
      const month = normalizeMonth(rawMonth);
      const hours = parseFloat(hoursStr);
      if (!Number.isFinite(hours)) return;
      monthsSet.add(month);
      if (!data[month]) data[month] = {};
      data[month][name] = hours;
    });
  });

  const months = [...monthsSet].sort();
  const monthlyBreakdown = { members: [...membersSet].sort(), months, data };

  const rawTotal = parsed.UsedOrder != null
    ? parseFloat(String(parsed.UsedOrder).replace(/[^\d.]/g, ''))
    : NaN;
  const total = Number.isFinite(rawTotal) ? rawTotal : null;

  const endDate = parsed.deadline
    ? String(parsed.deadline).replace(/\//g, '-')
    : null;

  const startDate = months.length > 0 ? `${months[0]}-01` : null;

  return { monthlyBreakdown, updates: { total, endDate, startDate } };
}

function isMonthlyCsv(content) {
  const firstLine = (content ?? '').split(/\r?\n/).find((l) => l.trim());
  if (!firstLine) return false;
  return firstLine.split(',').length >= 3;
}

function parseCsvMonthly(content) {
  const membersSet = new Set();
  const monthsSet = new Set();
  const data = {};

  (content ?? '').split(/\r?\n/)
    .filter((line) => line.trim())
    .forEach((line) => {
      const parts = line.split(',');
      if (parts.length < 3) return;
      const name = parts[0].trim();
      const month = parts[1].trim();
      const hours = parseFloat(parts[2]);
      if (!Number.isFinite(hours)) return;
      membersSet.add(name);
      monthsSet.add(month);
      if (!data[month]) data[month] = {};
      data[month][name] = hours;
    });

  return {
    members: [...membersSet].sort(),
    months: [...monthsSet].sort(),
    data,
  };
}

function isNestedJson(rows) {
  return Array.isArray(rows) && rows.length > 0 && rows[0].months != null && typeof rows[0].months === 'object';
}

function parseJsonMonthly(rows) {
  const membersSet = new Set();
  const monthsSet = new Set();
  const data = {};

  rows.forEach((row) => {
    const name = row.name;
    membersSet.add(name);
    Object.entries(row.months ?? {}).forEach(([month, hours]) => {
      monthsSet.add(month);
      if (!data[month]) data[month] = {};
      data[month][name] = hours;
    });
  });

  return {
    members: [...membersSet].sort(),
    months: [...monthsSet].sort(),
    data,
  };
}

function totalFromBreakdown(breakdown) {
  return Object.values(breakdown.data).reduce((sum, monthData) => {
    return sum + Object.values(monthData).reduce((s, h) => s + h, 0);
  }, 0);
}

function parseCsv(content) {
  return (content ?? '').split(/\r?\n/)
    .filter((line) => line.trim())
    .reduce((sum, line) => {
      const parts = line.split(',');
      const hours = parseFloat(parts[parts.length - 1]);
      return sum + (Number.isFinite(hours) ? hours : 0);
    }, 0);
}
