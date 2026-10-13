import { Predicate } from "effect";

export const CENSORED_LOG_VALUE = "[REDACTED]";

/**
 * Error properties that classify a failure without describing its payload.
 * Logs keep their values only after `censorErrorClassificationValue`.
 */
export const errorClassificationKeys = [
  "_tag",
  "reason",
  "operation",
  "code",
  "outcome",
  "failureCode",
  "errorCode",
  "status",
  "statusCode",
  "constraint",
] as const;

/**
 * Keeps finite numbers, booleans, and short identifier-like strings such as
 * tags, codes, and statuses; censors every other value.
 */
export const censorErrorClassificationValue = <T>(value: T): T | string => {
  if (Predicate.isBoolean(value)) return value;
  if (Predicate.isNumber(value)) {
    return Number.isFinite(value) ? value : CENSORED_LOG_VALUE;
  }
  if (
    Predicate.isString(value) &&
    value.length <= 64 &&
    /^(?:[A-Za-z][A-Za-z0-9]*(?:[._:/-][A-Za-z0-9]+)*|[0-9A-Z]{5})$/.test(value)
  ) {
    return value;
  }
  return CENSORED_LOG_VALUE;
};
