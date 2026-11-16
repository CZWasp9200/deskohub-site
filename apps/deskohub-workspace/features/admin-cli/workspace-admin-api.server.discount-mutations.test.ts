import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AdministrationStoredDiscountId,
  AdministrationVoucherId,
  CliClientCompatibility,
  CliMutationInProgress,
  CliMutationRejected,
  CliMutationRequestId,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliSessionId,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Data, Effect, Layer, Schema } from "effect";
import { HttpApiTest } from "effect/unstable/httpapi";

// Every calendar discount cache invalidation and `after` callback.
const refreshes: string[] = [];
const nextServer = await import("next/server");
mock.module("next/cache", () => ({
  cacheLife: () => undefined,
  cacheTag: () => undefined,
  revalidatePath: () => undefined,
  revalidateTag: (tag: string) => {
    refreshes.push(`revalidate:${tag}`);
  },
}));
mock.module("next/server", () => ({
  ...nextServer,
  after: () => {
    refreshes.push("after");
  },
}));

const { AccountRoleGrants } = await import(
  "@/features/administrators/backend/account-role-grants.service"
);
const { UnusedAdministrationCustomerDirectory } = await import(
  "@/features/administration/customer-directory.test-utils"
);
const { calendarDiscountSourceTag } = await import(
  "@/features/discounts/calendar-discount-source.server"
);
const {
  DiscountAdministration,
  DiscountAdminAudienceError,
  DiscountAdminConflictError,
  DiscountAdminNotFoundError,
  DiscountAdminServiceDatesError,
} = await import("@/features/discounts/admin/discount-administration.service");
const { AdministrationRequestLedger } = await import(
  "./administration-request-ledger.service"
);
const { StandaloneAccessCodeAdministration } = await import(
  "@/features/access-codes"
);
const { InvoiceAdministrationService } = await import(
  "@/features/accounting/admin/invoice-administration.service"
);
const { AdministrationService } = await import(
  "@/features/administration/administration.service"
);
const { ReservationAccessAdministration } = await import(
  "@/features/administration/reservation-access-administration.service"
);
const { ReservationAdministrationService } = await import(
  "@/features/administration/reservation-administration.service"
);
const { ReservationProductDetailsBackfill } = await import(
  "@/features/reservation/backend/reservation-product-details-backfill.service"
);
const { CliAuthentication } = await import("./cli-authentication.service");
const { AdminCliAdministrationApiHandlers } = await import(
  "./workspace-admin-api.server"
);
const { authorizedCliRequest, UnrecordedAdministrationActions } = await import(
  "./cli-api.test-utils"
);

/** The administration API's other services, which these tests never reach. */
const UnusedAdministrationServices = Layer.mergeAll(
  Layer.succeed(InvoiceAdministrationService, {} as never),
  Layer.succeed(StandaloneAccessCodeAdministration, {} as never),
  Layer.succeed(ReservationAdministrationService, {} as never),
  Layer.succeed(ReservationProductDetailsBackfill, {} as never),
  Layer.succeed(ReservationAccessAdministration, {} as never),
  Layer.succeed(AdministrationService, {} as never),
  Layer.succeed(CliAuthentication, {} as never),
  // The in-memory client can't send the `dhw` version.
  Layer.succeed(CliClientCompatibility, (httpEffect) => httpEffect)
);

type DiscountAdministrationService = (typeof DiscountAdministration)["Service"];

const discountId = Schema.decodeUnknownSync(AdministrationStoredDiscountId)(
  "01980000-0000-7000-8000-000000000001"
);
const voucherId = Schema.decodeUnknownSync(AdministrationVoucherId)(
  "01980000-0000-7000-8000-000000000003"
);
const requestId = Schema.decodeUnknownSync(CliMutationRequestId)(
  "01980000-0000-7000-8000-000000000010"
);
const unavailableMessage = "The administration API is temporarily unavailable.";

/** A dependency failure the mutation can't recover from on its own. */
class DependencyOutage extends Data.TaggedError("DependencyOutage")<{
  readonly message: string;
}> {}

/**
 * A ledger that applies every request as the real one applies a new claim:
 * on success it runs `afterSettled`; on failure it asks the recovery policy
 * whether the claim would be released. `refusal` answers instead of applying,
 * as the real ledger answers a claim in progress or a reused request ID.
 */
const settlingRequestLedger = (
  refusal?: CliMutationInProgress | CliMutationRejected | CliServiceUnavailable
) => {
  const releases: boolean[] = [];
  const layer = Layer.succeed(AdministrationRequestLedger, {
    applyOnce: () => Effect.die("Discount mutations have external effects."),
    applyOnceWithEffects: (mutation) =>
      refusal
        ? Effect.fail(refusal)
        : mutation.apply.pipe(
            Effect.tapError((failure) =>
              Effect.sync(() =>
                releases.push(mutation.recovery.releasesOn(failure))
              )
            ),
            Effect.tap(() => mutation.afterSettled ?? Effect.void)
          ),
  } as (typeof AdministrationRequestLedger)["Service"]);
  return { layer, releases };
};

const mutateDiscounts = (
  mutation: Parameters<
    Effect.Success<typeof administrationClient>["mutateDiscounts"]
  >[0]["payload"]["mutation"],
  {
    discounts = {},
    ledger = settlingRequestLedger().layer,
  }: {
    readonly discounts?: Partial<DiscountAdministrationService>;
    readonly ledger?: Layer.Layer<
      typeof AdministrationRequestLedger.Identifier
    >;
  } = {}
) =>
  administrationClient.pipe(
    Effect.flatMap((client) =>
      client.mutateDiscounts({ payload: { requestId, mutation } })
    ),
    Effect.result,
    Effect.provide(AdminCliAdministrationApiHandlers),
    Effect.provide(
      authorizedCliRequest(
        CliSessionId.make("01980000-0000-7000-8000-000000000000")
      )
    ),
    Effect.provide(ledger),
    Effect.provide(
      Layer.succeed(DiscountAdministration, {
        ...({} as DiscountAdministrationService),
        ...discounts,
      })
    ),
    Effect.provide(UnusedAdministrationCustomerDirectory),
    Effect.provide(UnusedAdministrationServices),
    // The administration operation port re-reads the caller's grant.
    Effect.provide(
      Layer.mock(AccountRoleGrants, { has: () => Effect.succeed(true) })
    ),
    Effect.provide(UnrecordedAdministrationActions),
    Effect.provide(NodeHttpServer.layerHttpServices),
    Effect.scoped,
    Effect.runPromise
  );

const administrationClient = HttpApiTest.groups(WorkspaceAdminApi, [
  "administration",
]).pipe(Effect.map((client) => client.administration));

/** A discount deletion that fails with the given domain or dependency error. */
const failingDelete = (
  failure:
    | Effect.Error<ReturnType<DiscountAdministrationService["deleteDiscount"]>>
    | DependencyOutage
) => ({
  deleteDiscount: () => Effect.fail(failure as never),
});

beforeEach(() => {
  refreshes.length = 0;
});

describe("discount mutation failures over the administration API", () => {
  test.each([
    [
      "a missing resource",
      new DiscountAdminNotFoundError({
        resource: { kind: "discount", id: discountId },
        message: "The discount doesn't exist.",
      }),
      CliResourceNotFound,
      "The discount doesn't exist.",
      true,
    ],
    [
      "the last audience customer",
      new DiscountAdminAudienceError({
        promotionKind: "voucher",
        message: "Removing the last customer broadens the voucher.",
      }),
      CliMutationRejected,
      "Removing the last customer broadens the voucher.",
      true,
    ],
    [
      "a conflict",
      new DiscountAdminConflictError({
        reason: "discount-referenced",
        message: "This discount is still referenced.",
      }),
      CliMutationRejected,
      "This discount is still referenced.",
      true,
    ],
    [
      "refused service dates",
      new DiscountAdminServiceDatesError({
        message: "serviceDateUntil must not be before serviceDateFrom",
      }),
      CliMutationRejected,
      "serviceDateUntil must not be before serviceDateFrom",
      true,
    ],
    [
      "an unavailable dependency",
      new DependencyOutage({ message: "Dotypos didn't answer." }),
      CliServiceUnavailable,
      unavailableMessage,
      false,
    ],
  ] as const)(
    "answers %s with its CLI error and claim release",
    async (_, failure, errorClass, message, released) => {
      const ledger = settlingRequestLedger();

      const result = await mutateDiscounts(
        { kind: "delete-discount", id: discountId },
        { discounts: failingDelete(failure), ledger: ledger.layer }
      );

      expect(result._tag).toBe("Failure");
      const error = result._tag === "Failure" ? result.failure : undefined;
      expect(error).toBeInstanceOf(errorClass);
      expect(error).toMatchObject({ message });
      expect(ledger.releases).toEqual([released]);
    }
  );

  test.each([
    [
      "a request still being applied",
      new CliMutationInProgress({
        message: "This mutation is still being applied.",
        requestId,
      }),
      CliMutationInProgress,
      { message: "This mutation is still being applied.", requestId },
    ],
    [
      "a reused request ID",
      new CliMutationRejected({
        message:
          "This mutation request identifier was already used for different input.",
      }),
      CliMutationRejected,
      {
        message:
          "This mutation request identifier was already used for different input.",
      },
    ],
    [
      "an unavailable ledger",
      new CliServiceUnavailable({ message: unavailableMessage }),
      CliServiceUnavailable,
      { message: unavailableMessage },
    ],
  ] as const)(
    "answers %s from the ledger unchanged",
    async (_, refusal, errorClass, fields) => {
      const deletions: unknown[] = [];

      const result = await mutateDiscounts(
        { kind: "delete-discount", id: discountId },
        {
          discounts: {
            deleteDiscount: (input) =>
              Effect.sync(() => {
                deletions.push(input);
              }),
          },
          ledger: settlingRequestLedger(refusal).layer,
        }
      );

      const error = result._tag === "Failure" ? result.failure : undefined;
      expect(error).toBeInstanceOf(errorClass);
      expect(error).toMatchObject(fields);
      expect(deletions).toEqual([]);
      expect(refreshes).toEqual([]);
    }
  );
});

describe("discount mutation calendar refresh over the administration API", () => {
  test("refreshes the calendar discounts once a discount change settles", async () => {
    const result = await mutateDiscounts(
      { kind: "delete-discount", id: discountId },
      { discounts: { deleteDiscount: () => Effect.void } }
    );

    expect(result._tag).toBe("Success");
    expect(refreshes).toEqual([
      `revalidate:${calendarDiscountSourceTag}`,
      "after",
    ]);
  });

  test("leaves the calendar discounts alone for a voucher change", async () => {
    const result = await mutateDiscounts(
      { kind: "delete-voucher", id: voucherId },
      { discounts: { deleteVoucher: () => Effect.void } }
    );

    expect(result._tag).toBe("Success");
    expect(refreshes).toEqual([]);
  });

  test("doesn't refresh the calendar discounts after a failed change", async () => {
    const result = await mutateDiscounts(
      { kind: "delete-discount", id: discountId },
      {
        discounts: failingDelete(
          new DiscountAdminConflictError({
            reason: "discount-referenced",
            message: "This discount is still referenced.",
          })
        ),
      }
    );

    expect(result._tag).toBe("Failure");
    expect(refreshes).toEqual([]);
  });
});
