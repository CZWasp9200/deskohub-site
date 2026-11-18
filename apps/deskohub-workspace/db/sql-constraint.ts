import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Option, Predicate } from "effect";
import { SqlError } from "effect/sql";

/** A failed database statement, as Drizzle or Effect SQL reports it. */
export type DatabaseQueryError = EffectDrizzleQueryError | SqlError.SqlError;

export const isDatabaseQueryError = <E>(
  error: E
): error is E & DatabaseQueryError =>
  error instanceof EffectDrizzleQueryError || SqlError.isSqlError(error);

/**
 * Name of the constraint a failed statement violated. A unique violation
 * names it on the Effect SQL reason; other integrity violations (foreign key,
 * check, not null) keep it on the Postgres error the reason wraps.
 */
export const findViolatedConstraint = (
  error: DatabaseQueryError
): Option.Option<string> =>
  findSqlError(error).pipe(
    Option.flatMap(({ reason }) => {
      switch (reason._tag) {
        case "UniqueViolation":
          return Option.some(reason.constraint);
        case "ConstraintError":
          return Predicate.hasProperty(reason.cause, "constraint") &&
            Predicate.isString(reason.cause.constraint) &&
            reason.cause.constraint.length > 0
            ? Option.some(reason.cause.constraint)
            : Option.none();
        default:
          return Option.none();
      }
    })
  );

/** Whether the statement gave up waiting for a lock (SQLSTATE 55P03, `lock_timeout`). */
export const isLockWaitTimeout = (error: DatabaseQueryError): boolean =>
  findSqlError(error).pipe(
    Option.exists(({ reason }) => reason._tag === "LockTimeoutError")
  );

/** The SQLSTATE Postgres answered a failed statement with, such as `23505`. */
export const findSqlState = (
  error: DatabaseQueryError
): Option.Option<string> =>
  findSqlError(error).pipe(
    Option.flatMap(({ reason }) =>
      Predicate.hasProperty(reason.cause, "code") &&
      Predicate.isString(reason.cause.code)
        ? Option.some(reason.cause.code)
        : Option.none()
    )
  );

/** Drizzle reports the Effect SQL failure inside the `Cause` it wraps. */
const findSqlError = (
  error: DatabaseQueryError
): Option.Option<SqlError.SqlError> => {
  if (SqlError.isSqlError(error)) return Option.some(error);
  if (SqlError.isSqlError(error.cause)) return Option.some(error.cause);
  return Cause.isCause(error.cause)
    ? Cause.findErrorOption(error.cause).pipe(
        Option.filter(SqlError.isSqlError)
      )
    : Option.none();
};
