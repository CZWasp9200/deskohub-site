import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Option } from "effect";
import { SqlError } from "effect/unstable/sql";
import { findViolatedConstraint, isDatabaseQueryError } from "./sql-constraint";

const pgError = (constraint?: string) =>
  Object.assign(new Error("synthetic Postgres error"), { constraint });

const drizzleError = (cause: unknown) =>
  new EffectDrizzleQueryError({ query: "insert", params: [], cause });

describe("findViolatedConstraint", () => {
  test("reads a unique violation's constraint through Drizzle's cause", () => {
    const sqlError = new SqlError.SqlError({
      reason: new SqlError.UniqueViolation({
        cause: pgError("codes_unique_idx"),
        constraint: "codes_unique_idx",
      }),
    });

    expect(findViolatedConstraint(sqlError)).toEqual(
      Option.some("codes_unique_idx")
    );
    expect(findViolatedConstraint(drizzleError(Cause.fail(sqlError)))).toEqual(
      Option.some("codes_unique_idx")
    );
    expect(findViolatedConstraint(drizzleError(sqlError))).toEqual(
      Option.some("codes_unique_idx")
    );
  });

  test("reads another integrity violation's constraint from the Postgres error", () => {
    const violation = (constraint?: string) =>
      drizzleError(
        Cause.fail(
          new SqlError.SqlError({
            reason: new SqlError.ConstraintError({
              cause: pgError(constraint),
            }),
          })
        )
      );

    expect(findViolatedConstraint(violation("codes_parent_fk"))).toEqual(
      Option.some("codes_parent_fk")
    );
    expect(findViolatedConstraint(violation(""))).toEqual(Option.none());
    expect(findViolatedConstraint(violation())).toEqual(Option.none());
  });

  test("finds no constraint on other database failures", () => {
    const unavailable = new SqlError.SqlError({
      reason: new SqlError.ConnectionError({ cause: pgError() }),
    });

    expect(findViolatedConstraint(unavailable)).toEqual(Option.none());
    expect(
      findViolatedConstraint(drizzleError(Cause.fail(unavailable)))
    ).toEqual(Option.none());
    expect(
      findViolatedConstraint(drizzleError(Cause.die(pgError("codes_unique"))))
    ).toEqual(Option.none());
    expect(
      findViolatedConstraint(drizzleError(pgError("codes_unique")))
    ).toEqual(Option.none());
  });
});

describe("isDatabaseQueryError", () => {
  test("recognizes Drizzle and Effect SQL failures only", () => {
    expect(isDatabaseQueryError(drizzleError(new Error("failed")))).toBe(true);
    expect(
      isDatabaseQueryError(
        new SqlError.SqlError({
          reason: new SqlError.UnknownError({ cause: new Error("failed") }),
        })
      )
    ).toBe(true);
    expect(isDatabaseQueryError(new Error("failed"))).toBe(false);
  });
});
