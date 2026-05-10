/** @typedef {'normal'|'warning'|'critical'} AlertLevel */

/** @typedef {'ok'|'insufficient_data'|'period_closed'|'fallback_weekend_only'} ForecastStatus */

/** @typedef {`${number}-${number}-${number}`} DateYmd */

/**
 * @typedef {Object} ProjectConfig
 * @property {string} projectId
 * @property {DateYmd} startDate
 * @property {DateYmd} endDate
 * @property {'inclusive'|'exclusive'} budgetMode
 */

/**
 * @typedef {Object} ForecastResult
 * @property {ForecastStatus} status
 * @property {number} averageVelocity
 * @property {number} predictedTotalEffort
 * @property {number} remainingEffort
 */

/**
 * @typedef {Object} AlertState
 * @property {AlertLevel} level
 * @property {string} reason
 */

export {};
