import "server-only";

import type {
  ReservationProductFilterType,
  ReservationProductPropertyCondition,
} from "@deskohub/workspace-admin-api";
import {
  and,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  ne,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm";
import { Match } from "effect";
import { workspaceReservations } from "@/db/schema";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import type { ReservationProductPropertyIds } from "@/features/reservation/reservation-product-descriptor";

const details = workspaceReservations.reservationDetails;

/**
 * Where each catalog property lives in a reservation snapshot. A snapshot
 * that lacks the field (a reservation the backfill couldn't resolve) yields
 * null, which no property condition matches.
 */
const propertyValues: {
  readonly [Family in WorkspaceReservationKind]: {
    readonly [Property in ReservationProductPropertyIds[Family]]: SQL;
  };
} = {
  cowork: {
    tier: sql`${details}->>'entryTier'`,
    coffee: sql`(${details}->>'coffee')::boolean`,
    monitor: sql`${details}->>'monitorOption'`,
  },
  "meeting-room": {
    offer: sql`(${details}->'duration'->>'unit') || ':' || (${details}->'duration'->>'amount')`,
  },
  office: {
    seats: sql`(${details}->>'seats')::int`,
    days: sql`(${details}->>'dayCount')::int`,
  },
};

const propertyCondition = (
  value: SQL,
  condition: ReservationProductPropertyCondition
): SQL =>
  Match.value(condition).pipe(
    Match.when({ operator: "anyOf" }, (choice) =>
      inArray(value, [...choice.value])
    ),
    Match.when(
      { operator: "noneOf" },
      (choice) => sql`coalesce(${notInArray(value, [...choice.value])}, false)`
    ),
    Match.when(
      { operator: "is" },
      (flag) => sql`coalesce(${eq(value, flag.value)}, false)`
    ),
    Match.when({ operator: "eq" }, (count) => eq(value, count.value)),
    Match.when({ operator: "ne" }, (count) => ne(value, count.value)),
    Match.when({ operator: "lt" }, (count) => lt(value, count.value)),
    Match.when({ operator: "lte" }, (count) => lte(value, count.value)),
    Match.when({ operator: "gt" }, (count) => gt(value, count.value)),
    Match.when({ operator: "gte" }, (count) => gte(value, count.value)),
    Match.exhaustive
  );

/**
 * Selects reservations of the product family whose snapshot meets every
 * property condition. An unknown property matches nothing; audience filters
 * are validated against the catalog before they're stored.
 */
export const reservationProductCondition = ({
  family,
  properties,
}: ReservationProductFilterType): SQL => {
  const values: Readonly<Record<string, SQL>> = propertyValues[family];
  return and(
    sql`${details}->>'kind' = ${family}`,
    ...properties.map((condition) => {
      const value = Object.hasOwn(values, condition.property)
        ? values[condition.property]
        : undefined;
      return value ? propertyCondition(value, condition) : sql`false`;
    })
  )!;
};
