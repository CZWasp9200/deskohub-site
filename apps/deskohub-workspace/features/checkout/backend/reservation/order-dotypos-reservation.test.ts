import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import {
  makeCoworkInvoiceDocument,
  makeMeetingRoomInvoiceDocument,
} from "@/features/accounting/invoice.test-utils";
import {
  WorkspaceAvailabilityService,
  WorkspaceTableUnavailableError,
} from "@/features/reservation/backend/workspace-availability.service";
import type { WorkspaceReservation } from "@/features/reservation/backend/workspace-reservation.repository";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  findOrderDotyposReservations,
  type RecreatedReservation,
  rebuildAcceptedReservation,
  resumeOrCreateOrderDotyposReservation,
} from "./order-dotypos-reservation";
import {
  TableAssignmentUnavailableError,
  WorkspaceTableAssignmentService,
} from "./workspace-table-assignment.service";

const orderId = workspaceReservationIdSchema.make("reservation-id");
const order: WorkspaceReservation = {
  id: orderId,
  dotyposCustomerId: "dotypos-customer-id",
  reservationDetails: { kind: "cowork", entryTier: "basic", coffee: true },
} as never;

const coworkSnapshot = makeCoworkInvoiceDocument("en-US") as never;

const recreated = (() => {
  const rebuilt = rebuildAcceptedReservation(order, coworkSnapshot);
  if (!rebuilt) throw new Error("The cowork order must rebuild.");
  return rebuilt;
})();

const makeHarness = (
  options: {
    readonly ensureAvailable?: () => Effect.Effect<void, unknown>;
    readonly assignTableId?: () => Effect.Effect<unknown, unknown>;
    readonly overlapping?: readonly unknown[];
  } = {}
) => {
  const events: string[] = [];
  const spies = {
    ensureAvailable: mock(() => {
      events.push("ensureAvailable");
      return options.ensureAvailable?.() ?? Effect.void;
    }),
    assignTableId: mock(() => {
      events.push("assignTableId");
      return options.assignTableId?.() ?? Effect.succeed("table-id");
    }),
    createReservation: mock((input: { readonly status: string }) => {
      events.push(`createReservation:${input.status}`);
      return Effect.succeed({ id: "created-id" } as never);
    }),
    listActiveReservationsOverlapping: mock(
      (_input: { readonly startDate: Date; readonly endDate: Date }) =>
        Effect.succeed((options.overlapping ?? []) as never)
    ),
  };
  const layer = Layer.mergeAll(
    Layer.mock(DotyposService, {
      createReservation: spies.createReservation as never,
      listActiveReservationsOverlapping:
        spies.listActiveReservationsOverlapping as never,
    }),
    Layer.mock(WorkspaceAvailabilityService, {
      ensureAvailable: spies.ensureAvailable as never,
    }),
    Layer.mock(WorkspaceTableAssignmentService, {
      assignTableId: spies.assignTableId as never,
    })
  );
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      | DotyposService
      | WorkspaceAvailabilityService
      | WorkspaceTableAssignmentService
    >
  ) => effect.pipe(Effect.provide(layer), Effect.result, Effect.runPromise);
  return { events, spies, run };
};

const resumeOrCreate = (
  harness: ReturnType<typeof makeHarness>,
  input: {
    readonly found: readonly unknown[];
    readonly status: "NEW" | "CONFIRMED";
    readonly recreated?: RecreatedReservation;
  }
) =>
  harness.run(
    resumeOrCreateOrderDotyposReservation({
      order,
      recreated: input.recreated ?? recreated,
      found: input.found as never,
      status: input.status,
    })
  );

describe("rebuildAcceptedReservation", () => {
  test("rebuilds the order's reservation on the accepted snapshot's date", () => {
    expect(recreated.reservation).toMatchObject({
      kind: "cowork",
      entryTier: "basic",
      date: (coworkSnapshot as { reservation: { date: string } }).reservation
        .date,
    });
    expect(recreated.checkoutDetails).toMatchObject({
      reservation: recreated.reservation,
      legal: {},
    });
  });

  test("does not rebuild when the snapshot is for another reservation kind", () => {
    expect(
      rebuildAcceptedReservation(
        order,
        makeMeetingRoomInvoiceDocument("en-US") as never
      )
    ).toBeNull();
  });
});

describe("findOrderDotyposReservations", () => {
  test("keeps the overlapping active reservations whose note names the order", async () => {
    const harness = makeHarness({
      overlapping: [
        {
          id: "order-hold",
          status: "NEW",
          note: "Payment order: reservation-id",
        },
        { id: "other-hold", status: "NEW", note: "Payment order: other-id" },
        { id: "walk-in", status: "CONFIRMED" },
      ],
    });
    const interval = {
      startsAt: "2099-01-01T08:00:00Z",
      endsAt: "2099-01-01T16:00:00Z",
    };

    const result = await harness.run(
      findOrderDotyposReservations({ orderId, interval })
    );

    expect(result).toMatchObject({
      _tag: "Success",
      success: [{ id: "order-hold" }],
    });
    expect(
      harness.spies.listActiveReservationsOverlapping.mock.calls[0]?.[0]
    ).toEqual({
      startDate: new Date(interval.startsAt),
      endDate: new Date(interval.endsAt),
    });
  });
});

describe("resumeOrCreateOrderDotyposReservation", () => {
  test.each(["NEW", "CONFIRMED"] as const)(
    "resumes the order's existing %s reservation without creating one",
    async (existingStatus) => {
      const harness = makeHarness();

      const result = await resumeOrCreate(harness, {
        found: [{ id: "existing-id", status: existingStatus }],
        status: "NEW",
      });

      expect(result).toMatchObject({
        _tag: "Success",
        success: { id: "existing-id", status: existingStatus, resumed: true },
      });
      expect(harness.events).toEqual([]);
    }
  );

  test.each(["NEW", "CONFIRMED"] as const)(
    "creates a %s reservation after availability and table assignment",
    async (status) => {
      const harness = makeHarness();

      const result = await resumeOrCreate(harness, { found: [], status });

      expect(result).toMatchObject({
        _tag: "Success",
        success: { id: "created-id", status, resumed: false },
      });
      expect(harness.events).toEqual([
        "ensureAvailable",
        "assignTableId",
        `createReservation:${status}`,
      ]);
    }
  );

  test("returns null without creating when the workspace is unavailable", async () => {
    const harness = makeHarness({
      ensureAvailable: () =>
        Effect.fail(
          new WorkspaceTableUnavailableError({
            date: "2099-01-01",
            reservation: { kind: "cowork", entryTier: "basic" },
          })
        ),
    });

    const result = await resumeOrCreate(harness, { found: [], status: "NEW" });

    expect(result).toMatchObject({ _tag: "Success", success: null });
    expect(harness.events).toEqual(["ensureAvailable"]);
  });

  test("returns null without creating when no table can be assigned", async () => {
    const harness = makeHarness({
      assignTableId: () =>
        Effect.fail(
          new TableAssignmentUnavailableError({
            requiredTags: [],
            message: "No table.",
          })
        ),
    });

    const result = await resumeOrCreate(harness, {
      found: [],
      status: "CONFIRMED",
    });

    expect(result).toMatchObject({ _tag: "Success", success: null });
    expect(harness.events).toEqual(["ensureAvailable", "assignTableId"]);
  });
});
