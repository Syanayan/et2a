const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * @param {unknown} config
 * @returns {{ok:true,error:null}|{ok:false,error:{code:'validation_error',message:string,field:string}}}
 */
export function validateProjectConfig(config) {
  const projectId = config?.projectId;
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
    return invalid('projectId', 'projectId must match [a-zA-Z0-9_-]{1,64}');
  }

  const startDate = config?.schedule?.startDate;
  if (typeof startDate !== 'string' || !DATE_PATTERN.test(startDate) || !isValidDateYmd(startDate)) {
    return invalid('schedule.startDate', 'schedule.startDate must be YYYY-MM-DD');
  }

  const endDate = config?.schedule?.endDate;
  if (typeof endDate !== 'string' || !DATE_PATTERN.test(endDate) || !isValidDateYmd(endDate)) {
    return invalid('schedule.endDate', 'schedule.endDate must be YYYY-MM-DD');
  }

  if (startDate > endDate) {
    return invalid('schedule', 'schedule.startDate must be less than or equal to schedule.endDate');
  }

  for (const field of ['total', 'buffer', 'actual']) {
    const value = config?.effort?.[field];
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
      return invalid(`effort.${field}`, `effort.${field} must be greater than or equal to 0`);
    }
  }

  const members = config?.members;
  if (!Array.isArray(members)) {
    return invalid('members', 'members must be an array');
  }

  for (let i = 0; i < members.length; i += 1) {
    const dailyEffort = members[i]?.dailyEffort;
    if (typeof dailyEffort !== 'number' || Number.isNaN(dailyEffort) || dailyEffort < 0.1 || dailyEffort > 1.5) {
      return invalid(`members[${i}].dailyEffort`, `members[${i}].dailyEffort must be between 0.1 and 1.5`);
    }
  }

  return { ok: true, error: null };
}

function invalid(field, message) {
  return {
    ok: false,
    error: {
      code: 'validation_error',
      message,
      field,
    },
  };
}

function isValidDateYmd(input) {
  const date = new Date(`${input}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.toISOString().slice(0, 10) === input;
}
