const RETRY_DELAYS_MS = [1000, 2000, 4000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export async function syncHolidays({
  sources,
  currentHolidays = [],
  loaders,
  sleep = defaultSleep,
}) {
  const errors = [];
  const collected = [];

  for (const source of sources ?? []) {
    const result = await loadWithRetry(source, loaders, sleep);
    if (result.ok) {
      collected.push(...result.holidays);
    } else {
      errors.push(...result.errors);
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      fallbackUsed: true,
      holidays: uniqueSorted(currentHolidays),
      warningState: 'holiday_sync_fallback',
      errors,
    };
  }

  return {
    success: true,
    fallbackUsed: false,
    holidays: uniqueSorted(collected),
    warningState: null,
    errors: [],
  };
}

async function loadWithRetry(source, loaders, sleep) {
  const errors = [];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const loader = resolveLoader(source, loaders);
      const holidays = await loader(source);
      return { ok: true, holidays: normalizeHolidays(holidays), errors: [] };
    } catch (error) {
      errors.push({ source, attempt: attempt + 1, message: toErrorMessage(error) });
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  return { ok: false, holidays: [], errors };
}

function resolveLoader(source, loaders) {
  const loader = loaders?.[source?.type];
  if (typeof loader !== 'function') {
    throw new Error(`unsupported_source_type:${source?.type ?? 'unknown'}`);
  }
  return loader;
}

function normalizeHolidays(holidays) {
  if (!Array.isArray(holidays)) {
    return [];
  }
  return holidays.filter((day) => typeof day === 'string');
}

function uniqueSorted(days) {
  return [...new Set(normalizeHolidays(days))].sort();
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
