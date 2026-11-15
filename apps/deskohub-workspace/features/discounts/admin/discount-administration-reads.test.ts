import { describe, expect, test } from "bun:test";
import {
  type Customer as DotyposCustomer,
  type DotyposCustomerId,
  DotyposService,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import { GoogleCalendarService } from "@deskohub/google-calendar";
import { AdministrationCustomerSearchResult } from "@deskohub/workspace-admin-api";
import { Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { AdministrationCustomerDirectory } from "@/features/administration/customer-directory.service";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import type { DiscountCodeId } from "../persistence-contracts";
import {
  getAdminDiscountCodeUsage,
  makeDiscountAdministrationReads,
  toAdminDotyposCustomer,
} from "./discount-administration-reads";

describe("discount administration read models", () => {
  test("counts reserved and redeemed claims against capacity but excludes releases", () => {
    expect(
      getAdminDiscountCodeUsage({
        maxUses: 5,
        states: ["reserved", "redeemed", "released", "released"],
      })
    ).toEqual({
      reservedUses: 1,
      redeemedUses: 1,
      releasedUses: 2,
      remainingUses: 3,
    });
  });

  test("keeps unlimited capacity and floors exhausted codes at zero", () => {
    expect(
      getAdminDiscountCodeUsage({
        maxUses: null,
        states: ["redeemed"],
      }).remainingUses
    ).toBeNull();
    expect(
      getAdminDiscountCodeUsage({
        maxUses: 1,
        states: ["reserved", "redeemed"],
      }).remainingUses
    ).toBe(0);
  });
});

describe("discount administration customers", () => {
  const unnamed = { id: "dotypos-customer" } as DotyposCustomer;

  test("signals a customer without a name or contact detail", () => {
    expect(toAdminDotyposCustomer(unnamed)).toMatchObject({
      displayName: "Unnamed customer",
      hasName: false,
    });
    expect(
      toAdminDotyposCustomer({ ...unnamed, phone: " +420 123 456 789 " })
    ).toMatchObject({ displayName: "+420 123 456 789", hasName: true });
  });

  test("keeps the administration API customer shape unchanged", () => {
    const encoded = Schema.encodeSync(AdministrationCustomerSearchResult)({
      kind: "matched",
      customers: [toAdminDotyposCustomer(unnamed)],
    });

    expect(encoded.customers[0]).toEqual({
      id: "dotypos-customer",
      displayName: "Unnamed customer",
      email: null,
      phone: null,
      discountGroupId: null,
    });
  });
});

/** The reads over a substituted Dotypos and database; the directory is the real one. */
const readsLayer = (
  database: Layer.Layer<WorkspaceDatabase>,
  dotypos: Layer.Layer<DotyposService>
) =>
  Layer.mergeAll(
    database,
    AdministrationCustomerDirectory.Default.pipe(Layer.provide(dotypos)),
    dotypos,
    Layer.mock(GoogleCalendarService, {}),
    Layer.mock(CalendarResourceConfig, {
      salesCalendarId: "sales-calendar" as never,
    })
  );

describe("discount administration audiences", () => {
  test("lists audience customers in audience order when the batch read fails", async () => {
    const audience = ["failing", "deleted", "active", "missing"].map((id) => ({
      dotyposCustomerId: id as DotyposCustomerId,
    }));
    const customers = new Map(
      [
        { id: "active", firstName: "Jana" },
        { id: "deleted", firstName: "Petr", deleted: true },
      ].map((customer) => [customer.id, customer as DotyposCustomer])
    );
    const unavailable = new DotyposUnavailable({
      operation: "getCustomer",
      reason: "server",
    });
    const row = {
      id: "code",
      discountId: "discount",
      maxUses: null,
      maxUsesPerCustomer: null,
      serviceDateFrom: null,
      serviceDateUntil: null,
      promotion: {
        code: "SYNTHETIC",
        enabled: true,
        validFrom: null,
        validUntil: null,
        customers: audience,
      },
      discount: { labels: { "en-US": "Synthetic" } },
      redemptions: [],
    };

    const detail = await Effect.gen(function* () {
      const reads = yield* makeDiscountAdministrationReads;
      return yield* reads.loadCodeDetail({ codeId: "code" as DiscountCodeId });
    }).pipe(
      Effect.provide(
        readsLayer(
          Layer.succeed(
            WorkspaceDatabase,
            WorkspaceDatabase.make({
              query: {
                discountCodes: { findFirst: () => Effect.succeed(row) },
              },
            } as never)
          ),
          Layer.mock(DotyposService, {
            getCustomersByIds: () => Effect.fail(unavailable),
            getCustomer: (id) =>
              id === "failing"
                ? Effect.fail(unavailable)
                : Effect.succeed(Option.fromNullishOr(customers.get(id))),
          })
        )
      ),
      Effect.runPromise
    );

    expect(
      detail.customers.map(({ customerId, customer }) => [
        customerId,
        customer?.id ?? null,
      ])
    ).toEqual([
      ["failing", null],
      ["deleted", "deleted"],
      ["active", "active"],
      ["missing", null],
    ]);
  });
});
