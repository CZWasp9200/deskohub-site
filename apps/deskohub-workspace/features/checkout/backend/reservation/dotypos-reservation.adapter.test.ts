import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { checkoutDetailsSchema } from "@/features/checkout/schemas/checkout-details";
import { createWorkspaceDotyposReservation } from "./dotypos-reservation.adapter";
import {
  type IWorkspaceTableAssignmentService,
  WorkspaceTableAssignmentService,
} from "./workspace-table-assignment.service";

const checkoutDetails = Schema.decodeUnknownSync(checkoutDetailsSchema)({
  locale: "en-US",
  reservation: {
    kind: "cowork",
    entryTier: "basic",
    date: "2099-06-10",
    coffee: false,
  },
  payment: {
    expectedPrice: { value: 35_000, exponent: 2, currency: "CZK" },
    undiscountedPrice: { value: 35_000, exponent: 2, currency: "CZK" },
    discounts: [],
    summary: {
      sections: [],
      total: { value: 35_000, exponent: 2, currency: "CZK" },
    },
  },
  legal: {},
});

describe("createWorkspaceDotyposReservation", () => {
  test("uses the cowork reservation domain interval for creation", async () => {
    const reservation = {
      kind: "cowork" as const,
      entryTier: "basic" as const,
      date: "2099-06-10",
      coffee: false,
    };
    const assignTableId = mock(() => Effect.succeed("cowork-table-id"));
    const createReservation = mock(() =>
      Effect.succeed({ id: "dotypos-reservation-id" } as never)
    );
    const testLayer = Layer.mergeAll(
      Layer.mock(WorkspaceTableAssignmentService, {
        assignTableId,
      } satisfies IWorkspaceTableAssignmentService),
      Layer.mock(DotyposService, {
        createReservation,
      })
    );

    await createWorkspaceDotyposReservation({
      paymentOrderId: "payment-order-id",
      dotyposCustomerId: "dotypos-customer-id",
      checkoutDetails,
      reservation,
      status: "NEW",
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(assignTableId).toHaveBeenCalledWith(reservation);
    expect(createReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: new Date("2099-06-09T22:00:00Z"),
        endDate: new Date("2099-06-10T22:00:00Z"),
      })
    );
  });
});
