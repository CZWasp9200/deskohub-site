import { describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Option } from "effect";
import type { ReservationVisit } from "@/features/reservation/backend/reservation-visits.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { AutomationTriggerKind } from "./automation-states";
import {
  readsTriggeringVisit,
  type TriggeringVisitVerdict,
  triggeringVisitVerdict,
  type WorkspaceCancellations,
  withdrawnByCancellation,
  withdrawnByWorkspaceCancellation,
} from "./automation-trigger-verification";

const asOf = Temporal.Instant.from("2026-10-19T10:00:00Z");
const later = asOf.add({ minutes: 30 });

const visit = (
  overrides: Partial<Pick<ReservationVisit, "startsAt" | "endsAt" | "status">>
): Option.Option<ReservationVisit> =>
  Option.some({
    workspaceReservationId: workspaceReservationIdSchema.make("reservation"),
    dotyposReservationId: DotyposReservationIdSchema.make("dotypos"),
    dotyposCustomerId: DotyposCustomerIdSchema.make("customer"),
    startsAt: asOf.subtract({ hours: 3 }),
    endsAt: asOf.subtract({ hours: 1 }),
    status: "active",
    ...overrides,
  });

/** The live visit as Dotypos returns it at `asOf`. */
const visits = {
  gone: Option.none(),
  cancelled: visit({ status: "cancelled" }),
  past: visit({}),
  startsAtAsOf: visit({ startsAt: asOf, endsAt: asOf.add({ hours: 2 }) }),
  endsAtAsOf: visit({ endsAt: asOf }),
  startsLater: visit({ startsAt: later, endsAt: later.add({ hours: 2 }) }),
  endsLater: visit({ endsAt: later }),
} satisfies Record<string, Option.Option<ReservationVisit>>;

type TriggerRule = {
  readonly readsVisit: boolean;
  readonly withdrawnByCancellation: boolean;
  readonly verdicts: Record<keyof typeof visits, TriggeringVisitVerdict>;
};

const readsNoVisit = {
  readsVisit: false,
  withdrawnByCancellation: false,
  verdicts: {
    gone: "current",
    cancelled: "current",
    past: "current",
    startsAtAsOf: "current",
    endsAtAsOf: "current",
    startsLater: "current",
    endsLater: "current",
  },
} satisfies TriggerRule;

const rules = {
  "reservation-booked": {
    readsVisit: true,
    withdrawnByCancellation: true,
    // A booked trigger has happened whenever the visit is.
    verdicts: {
      gone: "withdrawn",
      cancelled: "withdrawn",
      past: "current",
      startsAtAsOf: "current",
      endsAtAsOf: "current",
      startsLater: "current",
      endsLater: "current",
    },
  },
  "reservation-started": {
    readsVisit: true,
    withdrawnByCancellation: true,
    verdicts: {
      gone: "withdrawn",
      cancelled: "withdrawn",
      past: "current",
      startsAtAsOf: "current",
      endsAtAsOf: "current",
      startsLater: "moved",
      endsLater: "current",
    },
  },
  "reservation-finished": {
    readsVisit: true,
    withdrawnByCancellation: true,
    verdicts: {
      gone: "withdrawn",
      cancelled: "withdrawn",
      past: "current",
      startsAtAsOf: "moved",
      endsAtAsOf: "current",
      startsLater: "moved",
      endsLater: "moved",
    },
  },
  // The cancellation itself: not withdrawn by it.
  "reservation-cancelled": readsNoVisit,
  schedule: readsNoVisit,
  "account-created": readsNoVisit,
} satisfies Record<AutomationTriggerKind, TriggerRule>;

describe("trigger verification per kind", () => {
  test.each(Object.entries(rules) as [AutomationTriggerKind, TriggerRule][])(
    "%s",
    (kind, rule) => {
      expect(readsTriggeringVisit(kind)).toBe(rule.readsVisit);
      expect(withdrawnByCancellation(kind)).toBe(rule.withdrawnByCancellation);
      expect(
        Object.fromEntries(
          Object.entries(visits).map(([name, visit]) => [
            name,
            triggeringVisitVerdict({ kind, visit, asOf }),
          ])
        )
      ).toEqual(rule.verdicts);
    }
  );
});

describe("withdrawal by the reservation's Workspace cancellation", () => {
  const reservationId = workspaceReservationIdSchema.make("reservation");
  const triggerAt = asOf.subtract({ hours: 1 });
  /** The reservation's state when the trigger is checked. */
  const states = {
    notCancelled: new Map(),
    cancelledAtTrigger: new Map([[reservationId, triggerAt]]),
    // Restored, then cancelled again later.
    cancelledLater: new Map([[reservationId, triggerAt.add({ minutes: 1 })]]),
  } satisfies Record<string, WorkspaceCancellations>;

  const bookingWithdrawals = {
    notCancelled: false,
    cancelledAtTrigger: true,
    cancelledLater: true,
  };
  const neverWithdrawn = {
    notCancelled: false,
    cancelledAtTrigger: false,
    cancelledLater: false,
  };
  const expected = {
    "reservation-booked": bookingWithdrawals,
    "reservation-started": bookingWithdrawals,
    "reservation-finished": bookingWithdrawals,
    // Withdrawn once a restore has undone it, including when the
    // reservation was cancelled again since.
    "reservation-cancelled": {
      notCancelled: true,
      cancelledAtTrigger: false,
      cancelledLater: true,
    },
    schedule: neverWithdrawn,
    "account-created": neverWithdrawn,
  } satisfies Record<
    AutomationTriggerKind,
    Record<keyof typeof states, boolean>
  >;

  test.each(
    Object.entries(expected) as [
      AutomationTriggerKind,
      Record<keyof typeof states, boolean>,
    ][]
  )("%s", (kind, withdrawals) => {
    const hasReservation = kind.startsWith("reservation-");
    expect(
      Object.fromEntries(
        Object.entries(states).map(([name, cancellations]) => [
          name,
          withdrawnByWorkspaceCancellation(
            {
              kind,
              at: triggerAt,
              reservationId: hasReservation ? reservationId : null,
            },
            cancellations
          ),
        ])
      )
    ).toEqual(withdrawals);
  });
});
