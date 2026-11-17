import { Match } from "effect";
import type { PaymentState, ReservationState } from "@/db/schema";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import { getConsumerWithdrawalPeriodCutoff } from "@/features/legal/early-performance";
import type { ReservationPurpose } from "@/features/reservation/reservation-purpose";
import {
  getUnstartedServiceRefund,
  type WithdrawalAssessment,
  type WithdrawalRefundUnit,
} from "@/features/withdrawal/withdrawal-assessment";
import type { Money } from "@/shared/money/money";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

/**
 * When a booked reservation's service runs, in the units a withdrawal counts:
 * a cowork day or Reserved Desk stay is one day from its arrival date, an
 * office runs whole Prague days, and a meeting room runs booked hours or one
 * whole day.
 */
export type ReservationServiceSchedule =
  | { readonly kind: "cowork"; readonly date: Temporal.PlainDate }
  | {
      readonly kind: "meeting-room";
      /** The booked start, without any early setup. */
      readonly startsAt: Temporal.Instant;
      /** Booked hours, or one whole day. */
      readonly duration:
        | { readonly unit: "hour"; readonly amount: number }
        | { readonly unit: "day"; readonly amount: 1 };
    }
  | {
      readonly kind: "office";
      readonly startsOn: Temporal.PlainDate;
      readonly dayCount: number;
    };

/** What a reservation's withdrawal standing depends on. */
export type ReservationWithdrawalFacts = {
  readonly reservationState: ReservationState;
  readonly paymentState: PaymentState;
  /** Absent on reservations made before checkout asked for the purpose. */
  readonly purpose: ReservationPurpose | null;
  /** When the customer concluded the contract by submitting payment. */
  readonly contractAt: Temporal.Instant;
  readonly paidAmount: Money;
  readonly schedule: ReservationServiceSchedule;
};

/**
 * A reservation's withdrawal standing at `now`. A consumer may withdraw from a
 * paid, confirmed reservation until the withdrawal period ends while some unit
 * of its service hasn't started. Before the service starts the refund is the
 * whole amount paid; afterwards a started unit counts as supplied, so the
 * refund is the unstarted share, and a reservation whose every unit started
 * can't be withdrawn from.
 */
export const assessReservationWithdrawal = (
  facts: ReservationWithdrawalFacts,
  now: Temporal.Instant
): WithdrawalAssessment => {
  if (facts.reservationState !== "confirmed" || facts.paymentState !== "paid") {
    return { withdrawable: false, reason: "not_withdrawable" };
  }
  if (facts.purpose === "business") {
    return { withdrawable: false, reason: "business_purpose" };
  }
  const periodEndsAt = getConsumerWithdrawalPeriodCutoff(facts.contractAt);
  if (Temporal.Instant.compare(now, periodEndsAt) >= 0) {
    return { withdrawable: false, reason: "period_ended" };
  }
  const { unit, starts } = getReservationServiceUnits(facts.schedule);
  const refund = getUnstartedServiceRefund({
    paidAmount: facts.paidAmount,
    unit,
    unstarted: starts.filter(
      (start) => Temporal.Instant.compare(start, now) > 0
    ).length,
    total: starts.length,
  });
  if (!refund) return { withdrawable: false, reason: "performance_started" };
  return { withdrawable: true, ...refund, periodEndsAt };
};

/** The start of each unit of a reservation's service, in order. */
const getReservationServiceUnits = (
  schedule: ReservationServiceSchedule
): {
  readonly unit: WithdrawalRefundUnit;
  readonly starts: readonly Temporal.Instant[];
} =>
  Match.value(schedule).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ date }) => ({
        unit: "day" as const,
        starts: [getWorkspaceDayStart(date)],
      }),
      "meeting-room": ({ startsAt, duration }) =>
        duration.unit === "hour"
          ? {
              unit: "hour" as const,
              starts: Array.from({ length: duration.amount }, (_, hour) =>
                startsAt.add({ hours: hour })
              ),
            }
          : { unit: "day" as const, starts: [startsAt] },
      office: ({ startsOn, dayCount }) => ({
        unit: "day" as const,
        starts: Array.from({ length: dayCount }, (_, day) =>
          getWorkspaceDayStart(startsOn.add({ days: day }))
        ),
      }),
    })
  );

const getWorkspaceDayStart = (date: Temporal.PlainDate) =>
  date
    .toZonedDateTime(workspaceSiteConstants.location.timeZone)
    .toInstant();

/**
 * The schedule of a booked reservation from its stored family details and its
 * booked span (`reservedFrom` without early setup, `reservedUntil` exclusive).
 * Rows stored before the product was recorded fall back to the span: a room
 * spanning consecutive Prague midnights is a whole day, otherwise its hours;
 * an office covers each Prague date of the span.
 */
export const getReservationServiceSchedule = (
  details: StoredWorkspaceReservationDetails,
  reservedFrom: Temporal.Instant,
  reservedUntil: Temporal.Instant
): ReservationServiceSchedule => {
  const startsOn = getWorkspaceDate(reservedFrom);
  return Match.value(details).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => ({ kind: "cowork" as const, date: startsOn }),
      "meeting-room": ({ duration }) => ({
        kind: "meeting-room" as const,
        startsAt: reservedFrom,
        duration:
          duration ?? getBookedMeetingRoomDuration(reservedFrom, reservedUntil),
      }),
      office: ({ dayCount }) => ({
        kind: "office" as const,
        startsOn,
        dayCount:
          dayCount ??
          getWorkspaceDate(reservedUntil.subtract({ nanoseconds: 1 }))
            .since(startsOn)
            .total({ unit: "days" }) + 1,
      }),
    })
  );
};

const getBookedMeetingRoomDuration = (
  reservedFrom: Temporal.Instant,
  reservedUntil: Temporal.Instant
) =>
  getWorkspaceDayStart(getWorkspaceDate(reservedFrom)).equals(reservedFrom) &&
  getWorkspaceDayStart(getWorkspaceDate(reservedFrom).add({ days: 1 })).equals(
    reservedUntil
  )
    ? ({ unit: "day", amount: 1 } as const)
    : ({
        unit: "hour",
        amount: Math.max(
          1,
          Math.ceil(reservedFrom.until(reservedUntil).total({ unit: "hours" }))
        ),
      } as const);

const getWorkspaceDate = (instant: Temporal.Instant) =>
  instant
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate();
