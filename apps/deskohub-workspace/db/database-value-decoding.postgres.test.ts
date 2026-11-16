import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, max, min, sql } from "drizzle-orm";
import {
  bigint,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { equalsAny } from "./equals-any";
import { instant } from "./instant";
import { sensitiveInstant } from "./sensitive-instant";

const suiteDatabase =
  await createWorkspacePostgresSuiteDatabase("value_decoding");

const probe = pgTable("database_value_decoding_probe", {
  id: text("id").primaryKey(),
  at: instant("at").notNull(),
  hiddenAt: sensitiveInstant("hidden_at").notNull(),
  plainAt: timestamp("plain_at", { withTimezone: true }).notNull(),
  day: date("day", { mode: "string" }).notNull(),
  big: bigint("big", { mode: "number" }).notNull(),
  amount: numeric("amount").notNull(),
  payload: jsonb("payload").notNull(),
  count: integer("count").notNull(),
});

// Microseconds that differ only below the millisecond.
const earlier = Temporal.Instant.from("2026-09-05T10:00:00.000100Z");
const later = Temporal.Instant.from("2026-09-05T10:00:00.000900Z");

describe.skipIf(!suiteDatabase)(
  "Database value decoding on the native driver",
  () => {
    if (!suiteDatabase) return;
    const { db, pool } = suiteDatabase;
    const run = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.runPromise(effect);

    beforeAll(async () => {
      await pool.query(`create table database_value_decoding_probe (
      id text primary key,
      at timestamptz not null,
      hidden_at timestamptz not null,
      plain_at timestamptz not null,
      day date not null,
      big bigint not null,
      amount numeric not null,
      payload jsonb not null,
      count integer not null
    )`);
      await run(
        db.insert(probe).values([
          {
            id: "earlier",
            at: earlier,
            hiddenAt: earlier,
            plainAt: new Date("2026-09-05T10:00:00.123Z"),
            day: "2026-09-05",
            big: 9_007_199_254_740_991,
            amount: "12.50",
            payload: { nested: [1, "two"] },
            count: 3,
          },
          {
            id: "later",
            at: later,
            hiddenAt: later,
            plainAt: new Date("2026-09-05T10:00:01.000Z"),
            day: "2026-09-06",
            big: 1,
            amount: "0.0001",
            payload: [],
            count: 4,
          },
        ])
      );
    });

    afterAll(() => suiteDatabase.close());

    test("reads instant columns as Temporal instants with their microseconds", async () => {
      const rows = await run(
        db
          .select({ id: probe.id, at: probe.at, hiddenAt: probe.hiddenAt })
          .from(probe)
          .orderBy(probe.at)
      );
      expect(rows.map(({ id }) => id)).toEqual(["earlier", "later"]);
      expect(rows[0]!.at.equals(earlier)).toBe(true);
      expect(rows[0]!.hiddenAt.equals(earlier)).toBe(true);
      expect(rows[1]!.at.equals(later)).toBe(true);
    });

    test("reads min, max and mapWith aggregates of an instant column as instants with their microseconds", async () => {
      const [aggregates] = await run(
        db
          .select({
            first: min(probe.at),
            last: max(probe.at),
            mapped: sql`max(${probe.at})`.mapWith(probe.at),
          })
          .from(probe)
      );
      expect(aggregates!.first?.equals(earlier)).toBe(true);
      expect(aggregates!.last?.equals(later)).toBe(true);
      expect(
        (aggregates!.mapped as Temporal.Instant | null)?.equals(later)
      ).toBe(true);
    });

    test("filters and orders by sub-millisecond instants on the server", async () => {
      const rows = await run(
        db.select({ id: probe.id }).from(probe).where(eq(probe.at, later))
      );
      expect(rows).toEqual([{ id: "later" }]);
    });

    test("reads Drizzle's own column modes as before", async () => {
      const [row] = await run(
        db.select().from(probe).where(eq(probe.id, "earlier"))
      );
      expect(row!.plainAt).toEqual(new Date("2026-09-05T10:00:00.123Z"));
      expect(row!.day).toBe("2026-09-05");
      expect(row!.big).toBe(9_007_199_254_740_991);
      expect(row!.amount).toBe("12.50");
      expect(row!.payload).toEqual({ nested: [1, "two"] });
      expect(row!.count).toBe(3);
    });

    test("reads cast raw results as the declared JS values", async () => {
      const { rows } = await run(
        db.execute(sql`select count(*)::int as n, min(day)::text as day,
        min(at)::text as at from database_value_decoding_probe`)
      );
      expect(rows).toEqual([
        { n: 2, day: "2026-09-05", at: "2026-09-05 10:00:00.0001+00" },
      ]);
    });

    test("reads uncast raw int8 as bigint and timestamptz as Date", async () => {
      // Pins the native driver's raw values, which Workspace code casts in SQL
      // or decodes through a column wherever it needs a number or an instant.
      const {
        rows: [row],
      } = await run(
        db.execute(
          sql`select count(*) as n, max(plain_at) as at from database_value_decoding_probe`
        )
      );
      expect(row).toEqual({
        n: 2n,
        at: new Date("2026-09-05T10:00:01.000Z"),
      });
    });

    test("binds a Temporal instant in a raw template as its timestamp", async () => {
      const rows = await run(
        db
          .select({ id: probe.id })
          .from(probe)
          .where(sql`${probe.at} > ${earlier}`)
      );
      expect(rows).toEqual([{ id: "later" }]);
    });

    test("matches a text column against a bound text[] parameter", async () => {
      const rows = await run(
        db
          .select({ id: probe.id })
          .from(probe)
          .where(equalsAny(probe.id, ["later", "missing"]))
      );
      expect(rows).toEqual([{ id: "later" }]);
    });
  }
);
