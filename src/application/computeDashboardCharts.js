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

export function computeBurndown(monthlyBreakdown, project) {
  const startDate = project?.config?.schedule?.startDate;
  const endDate = project?.config?.schedule?.endDate;
  const total = project?.config?.effort?.total;
  if (!startDate || !endDate || !total) return [];

  const months = getMonthRange(startDate, endDate);
  if (months.length === 0) return [];

  // 月ごとの累計工数を計算
  const cumulativeByMonth = {};
  let cumulative = 0;
  for (const m of (monthlyBreakdown?.months ?? [])) {
    const monthData = monthlyBreakdown.data[m] ?? {};
    cumulative += Object.values(monthData).reduce((s, h) => s + h, 0);
    cumulativeByMonth[m] = cumulative;
  }

  // 最後に実績データがある月のインデックスと残工数
  const n = months.length;
  let lastActualIdx = -1;
  for (let i = 0; i < n; i++) {
    if (cumulativeByMonth[months[i]] != null) lastActualIdx = i;
  }
  const lastActualRemaining = lastActualIdx >= 0
    ? Math.max(0, total - cumulativeByMonth[months[lastActualIdx]])
    : null;

  // 予想工数が手動設定されている場合の終了点
  const predictedEffort = project?.config?.effort?.predicted;
  const endRemaining = predictedEffort != null ? Math.max(0, total - predictedEffort) : 0;

  return months.map((month, i) => {
    // 理想線: total → 0 の直線
    const ideal = Math.round(total * (1 - i / Math.max(n - 1, 1)));

    // 実績残工数 (データのない月は null)
    const cum = cumulativeByMonth[month];
    const remaining = cum != null ? Math.max(0, total - cum) : null;

    // 予想残工数: 最終実績点 → 終了日
    let predicted = null;
    if (lastActualIdx >= 0 && i >= lastActualIdx) {
      if (i === lastActualIdx) {
        predicted = lastActualRemaining;
      } else {
        const steps = n - 1 - lastActualIdx;
        predicted = steps > 0
          ? Math.round(lastActualRemaining + (endRemaining - lastActualRemaining) * (i - lastActualIdx) / steps)
          : endRemaining;
      }
    }

    return { month, ideal, remaining, predicted };
  });
}

function getMonthRange(startDate, endDate) {
  const months = [];
  let [y, m] = startDate.slice(0, 7).split('-').map(Number);
  const [ey, em] = endDate.slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return months;
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
