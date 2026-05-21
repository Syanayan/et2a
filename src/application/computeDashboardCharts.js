export function computeWeeklyEffort(effortHistory, project, today, totalWorkingDays) {
  const weekDates = getWeekDates(today);
  const dailyActuals = computeDailyActuals(effortHistory);
  const total = project?.config?.effort?.total ?? 0;
  const planned = totalWorkingDays > 0 ? total / totalWorkingDays : 0;

  return weekDates.map(({ day, date }) => ({
    day,
    date,
    planned: Math.round(planned * 10) / 10,
    actual: dailyActuals[date] ?? 0,
  }));
}

export function computeBurndown(effortHistory, project) {
  if (!effortHistory || effortHistory.length === 0) return [];
  const sorted = [...effortHistory].sort((a, b) => a.date.localeCompare(b.date));
  const total = project?.config?.effort?.total ?? 0;
  const startDate = project?.config?.schedule?.startDate ?? sorted[0].date;
  const endDate = project?.config?.schedule?.endDate ?? sorted[sorted.length - 1].date;
  const totalDays = Math.max(1, daysBetween(startDate, endDate));

  return sorted.map(({ date, actual }) => {
    const elapsed = daysBetween(startDate, date);
    const predicted = Math.round((elapsed / totalDays) * total * 10) / 10;
    return { date, actual, predicted };
  });
}

function getWeekDates(today) {
  const d = new Date(today);
  const dow = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return ['月', '火', '水', '木', '金'].map((day, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return { day, date: date.toISOString().slice(0, 10) };
  });
}

function computeDailyActuals(effortHistory) {
  const sorted = [...effortHistory].sort((a, b) => a.date.localeCompare(b.date));
  const map = {};
  for (let i = 0; i < sorted.length; i++) {
    const prev = i > 0 ? sorted[i - 1].actual : 0;
    map[sorted[i].date] = Math.max(0, sorted[i].actual - prev);
  }
  return map;
}

function daysBetween(start, end) {
  return Math.round((new Date(end) - new Date(start)) / 86400000);
}
