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
  findOrderCoworkStay,
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

const reservedDeskOrder: WorkspaceReservation = {
  ...order,
  reservationDetails: {
    kind: "cowork",
    entryTier: "reserved-desk",
    coffee: true,
  },
} as never;

const coworkSnapshot = makeCoworkInvoiceDocument("en-US") as never;

const recreated = (() => {
  const rebuilt = rebuildAcceptedReservation(order, coworkSnapshot, undefined);
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
        makeMeetingRoomInvoiceDocument("en-US") as never,
        undefined
      )
    ).toBeNull();
  });

  test("keeps an overnight stay on the rebuilt Reserved Desk", () => {
    const rebuilt = rebuildAcceptedReservation(
      reservedDeskOrder,
      coworkSnapshot,
      "overnight"
    );
    expect(rebuilt?.reservation).toMatchObject({
      kind: "cowork",
      entryTier: "reserved-desk",
      stay: "overnight",
    });
    expect(rebuilt?.checkoutDetails.reservation).toBe(rebuilt?.reservation);
    expect(
      rebuildAcceptedReservation(reservedDeskOrder, coworkSnapshot, "day")
        ?.reservation
    ).not.toHaveProperty("stay");
  });
});

describe("findOrderCoworkStay", () => {
  const dotyposReservationId = "dotypos-reservation-id" as never;
  const findStay = (
    input: {
      readonly order?: WorkspaceReservation;
      readonly bounds?: {
        readonly startDate: string;
        readonly endDate: string;
      };
    } = {}
  ) => {
    const getReservationWithoutCustomer = mock(() =>
      Effect.succeed({ ...input.bounds, seats: "1" })
    );
    return {
      getReservationWithoutCustomer,
      stay: Effect.runPromise(
        findOrderCoworkStay({
          order: input.order ?? reservedDeskOrder,
          dotyposReservationId,
        }).pipe(
          Effect.provideService(DotyposService, {
            getReservationWithoutCustomer,
          } as never)
        )
      ),
    };
  };

  test("reads an overnight stay from the Dotypos reservation's bounds", async () => {
    // Prague winter time (UTC+1): noon on 2099-01-01 to noon on 2099-01-02.
    const found = findStay({
      bounds: {
        startDate: "2099-01-01T11:00:00Z",
        endDate: "2099-01-02T11:00:00Z",
      },
    });
    expect(await found.stay).toBe("overnight");
    expect(found.getReservationWithoutCustomer).toHaveBeenCalledWith(
      dotyposReservationId
    );
  });

  test("reads a day stay from day bounds", async () => {
    const found = findStay({
      bounds: {
        startDate: "2098-12-31T23:00:00Z",
        endDate: "2099-01-01T23:00:00Z",
      },
    });
    expect(await found.stay).toBe("day");
  });

  test("leaves the stay unknown when the bounds can't be read", async () => {
    expect(
      await findStay({ bounds: { startDate: "", endDate: "" } }).stay
    ).toBeUndefined();
  });

  test("reads nothing from Dotypos for a cowork tier without overnight stays", async () => {
    const found = findStay({ order });
    expect(await found.stay).toBeUndefined();
    expect(found.getReservationWithoutCustomer).not.toHaveBeenCalled();
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
