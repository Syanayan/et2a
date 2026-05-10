const SATURDAY = 6;
const SUNDAY = 0;

const toDate = (dateYmd) => new Date(`${dateYmd}T00:00:00Z`);
const toYmd = (date) => date.toISOString().slice(0, 10);

/**
 * @param {string} startDate
 * @param {string} endDate
 * @param {{ personalHolidays: string[], companyHolidays: string[] }} exclusions
 */
export function calculateWorkingDays(startDate, endDate, exclusions) {
  const start = toDate(startDate);
  const end = toDate(endDate);

  if (start > end) {
    throw new Error('startDate must be less than or equal to endDate');
  }

  const excludedDates = new Set([
    ...exclusions.companyHolidays,
    ...exclusions.personalHolidays
  ]);

  const workingDays = [];
  for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const ymd = toYmd(date);
    const day = date.getUTCDay();

    if (day === SATURDAY || day === SUNDAY) {
      continue;
    }

    if (excludedDates.has(ymd)) {
      continue;
    }

    workingDays.push(ymd);
  }

  return {
    workingDays,
    excludedDates: [...excludedDates],
    fallbackReason:
      exclusions.personalHolidays.length === 0 && exclusions.companyHolidays.length === 0
        ? 'fallback_weekend_only'
        : null
  };
}
