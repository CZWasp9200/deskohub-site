import { Schema } from "effect";
import type { WorkspaceCoworkProductTier } from "@/features/reservation/cowork-reservation-product";
import {
  isOvernightStayInterval,
  type ReservationInterval,
} from "@/features/reservation/reservation-interval-domain";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

/**
 * How long a Reserved Desk reservation holds its desk from the arrival date:
 * `day` is the arrival date's Prague calendar day, `overnight` runs from the
 * overnight changeover time (noon) on the arrival date to the same wall-clock
 * time on the next date. Only Reserved Desk offers an overnight stay; every
 * other cowork tier is a day stay.
 *
 * The stay exists only on booking input and orders. A booked reservation's
 * stay is never stored; read it from its Dotypos bounds with
 * {@link getBookedCoworkStay}.
 */
const coworkStays = ["day", "overnight"] as const;

export const coworkStaySchema = Schema.Literals(coworkStays);

export type CoworkStay = typeof coworkStaySchema.Type;

/** A booking without a stay books a day stay. */
const defaultCoworkStay = "day" satisfies CoworkStay;

/** The one cowork tier that offers an overnight stay. */
export const overnightCoworkStayTier =
  "reserved-desk" satisfies WorkspaceCoworkProductTier;

/** Whether a tier and stay select an overnight stay's noon-to-noon interval. */
export const isOvernightCoworkStay = (
  tier: WorkspaceCoworkProductTier | undefined,
  stay: CoworkStay | undefined
) => tier === overnightCoworkStayTier && stay === "overnight";

/**
 * The stay of a booked cowork reservation, derived from its provider bounds:
 * a Reserved Desk reservation from the changeover time on one Prague date to
 * the changeover time on the next is overnight; anything else is a day stay.
 */
export const getBookedCoworkStay = (reservation: {
  readonly tier: WorkspaceCoworkProductTier;
  readonly interval: {
    readonly startsAt: ReservationInterval["startsAt"] | Temporal.Instant;
    readonly endsAt: ReservationInterval["endsAt"] | Temporal.Instant;
  };
}): CoworkStay =>
  reservation.tier === overnightCoworkStayTier &&
  isOvernightStayInterval(reservation.interval)
    ? "overnight"
    : defaultCoworkStay;

/**
 * The Prague wall-clock times an overnight stay starts on its arrival date
 * and ends on the next date, as `HH:mm`.
 */
export const getOvernightStayTimes = () => {
  const changeover =
    workspaceSiteConstants.openingHours.overnightStayChangeover;
  return { startTime: changeover, endTime: changeover } as const;
};
