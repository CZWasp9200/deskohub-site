import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AdministrationDiscountCodeId,
  type AdministrationDiscountMutationResult,
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
import { HttpApiTest } from "effect/http-api";

// Every calendar discount cache invalidation and `after` callback.
const refreshes: string[] = [];
// Every page path revalidated, and whether Next.js refuses the next one.
const revalidatedPaths: string[] = [];
let refusesRevalidation = false;
const nextServer = await import("next/server");
mock.module("next/cache", () => ({
  cacheLife: () => undefined,
  cacheTag: () => undefined,
  revalidatePath: (path: string) => {
    if (refusesRevalidation) throw new Error("Next.js refused revalidation.");
    revalidatedPaths.push(path);
  },
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
const { prefixPathnameWithLocale } = await import("@deskohub/i18n/pathname");
const { locales } = await import("@/features/i18n/paraglide/runtime.js");
const { administrationHref } = await import(
  "@/features/administration/administration-href"
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
const {
  authorizedCliRequest,
  UnrecordedAdministrationActions,
  UnusedWithdrawalService,
} = await import("./cli-api.test-utils");

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
const codeId = Schema.decodeUnknownSync(AdministrationDiscountCodeId)(
  "01980000-0000-7000-8000-000000000002"
);
const customerId = "dotypos-customer-4217";
const unavailableMessage = "The administration API is temporarily unavailable.";

/** A dependency failure the mutation can't recover from on its own. */
class DependencyOutage extends Data.TaggedError("DependencyOutage")<{
  readonly message: string;
}> {}

/**
 * A ledger that applies every request as the real one applies a new claim:
 * on success it runs `afterSettled`; on failure it records the port failure
 * and asks the recovery policy whether the claim would be released. `refusal`
 * answers instead of applying, as the real ledger answers a claim in progress
 * or a reused request ID.
 */
const settlingRequestLedger = (
  refusal?: CliMutationInProgress | CliMutationRejected | CliServiceUnavailable
) => {
  const releases: boolean[] = [];
  const failures: unknown[] = [];
  const layer = Layer.succeed(AdministrationRequestLedger, {
    applyOnce: () => Effect.die("Discount mutations have external effects."),
    applyOnceWithEffects: (mutation) =>
      refusal
        ? Effect.fail(refusal)
        : mutation.apply.pipe(
            Effect.tapError((failure) =>
              Effect.sync(() => {
                failures.push(failure);
                releases.push(mutation.recovery.releasesOn(failure));
              })
            ),
            Effect.tap(() => mutation.afterSettled ?? Effect.void)
          ),
  } as (typeof AdministrationRequestLedger)["Service"]);
  return { layer, releases, failures };
};

/**
 * A ledger that finds the request already completed, as the real one replays
 * a stored result: it never applies the mutation again, and runs
 * `afterSettled` once the stored result is replayed.
 */
const replayingRequestLedger = (stored: AdministrationDiscountMutationResult) =>
  Layer.succeed(AdministrationRequestLedger, {
    applyOnce: () => Effect.die("Discount mutations have external effects."),
    applyOnceWithEffects: (mutation) =>
      Effect.sync(() => mutation.stored.replay(stored as never)).pipe(
        Effect.tap(() => mutation.afterSettled ?? Effect.void)
      ),
  } as (typeof AdministrationRequestLedger)["Service"]);

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
    Effect.provide(UnusedWithdrawalService),
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
  revalidatedPaths.length = 0;
  refusesRevalidation = false;
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
      "discount-not-found",
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
      "voucher-final-audience-customer",
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
      "discount-referenced",
    ],
    [
      "refused service dates",
      new DiscountAdminServiceDatesError({
        message: "serviceDateUntil must not be before serviceDateFrom",
      }),
      CliMutationRejected,
      "serviceDateUntil must not be before serviceDateFrom",
      true,
      "service-dates-invalid",
    ],
    [
      "an unavailable dependency",
      new DependencyOutage({ message: "Dotypos didn't answer." }),
      CliServiceUnavailable,
      unavailableMessage,
      false,
      "service-unavailable",
    ],
  ] as const)(
    "answers %s with its CLI error, stable code and claim release",
    async (_, failure, errorClass, message, released, code) => {
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
      expect(ledger.failures).toEqual([expect.objectContaining({ code })]);
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

/** The customer's page in every locale, as the page revalidation reaches it. */
const customerPagePaths = () =>
  locales.map((locale) =>
    prefixPathnameWithLocale(
      administrationHref("/[locale]/admin/customers/[customerId]", {
        customerId,
      }),
      locale
    )
  );

const customerCodeCreation = {
  kind: "create-customer-code",
  customerId,
  code: {
    code: "SUMMER10",
    enabled: true,
    validFrom: null,
    validUntil: null,
    maxUses: null,
    maxUsesPerCustomer: null,
  },
  discount: { kind: "existing", discountId },
} as const;

describe("discount mutation page revalidation over the administration API", () => {
  test("revalidates the customer's page once their own code is created", async () => {
    const result = await mutateDiscounts(customerCodeCreation, {
      discounts: { createCustomerCode: () => Effect.succeed(codeId) },
    });

    expect(result._tag).toBe("Success");
    expect(revalidatedPaths).toEqual(customerPagePaths());
  });

  test("revalidates the customer's page when a retried code creation replays", async () => {
    const created: AdministrationDiscountMutationResult = {
      kind: "create-customer-code",
      createdDiscountId: null,
      createdCodeId: codeId,
      createdVoucherId: null,
    };

    const result = await mutateDiscounts(customerCodeCreation, {
      discounts: {
        createCustomerCode: () =>
          Effect.die("A replayed request never creates the code again."),
      },
      ledger: replayingRequestLedger(created),
    });

    expect(result).toMatchObject({ _tag: "Success", success: created });
    expect(revalidatedPaths).toEqual(customerPagePaths());
  });

  test("revalidates the customer's page once their own voucher is created", async () => {
    const result = await mutateDiscounts(
      {
        kind: "create-customer-voucher",
        voucher: {
          customerId,
          code: "CREDIT500",
          enabled: true,
          validFrom: null,
          validUntil: null,
          credit: { value: 50_000, exponent: 2, currency: "CZK" },
        },
      },
      { discounts: { createCustomerVoucher: () => Effect.succeed(voucherId) } }
    );

    expect(result._tag).toBe("Success");
    expect(revalidatedPaths).toEqual(customerPagePaths());
  });

  test("revalidates no page for a change that adds nothing to a customer", async () => {
    const result = await mutateDiscounts(
      { kind: "delete-voucher", id: voucherId },
      { discounts: { deleteVoucher: () => Effect.void } }
    );

    expect(result._tag).toBe("Success");
    expect(revalidatedPaths).toEqual([]);
  });

  test("revalidates no page after a failed customer code creation", async () => {
    const result = await mutateDiscounts(customerCodeCreation, {
      discounts: {
        createCustomerCode: () =>
          Effect.fail(
            new DiscountAdminConflictError({
              reason: "promotion-code-taken",
              message: "This code is already taken.",
            })
          ),
      },
    });

    expect(result._tag).toBe("Failure");
    expect(revalidatedPaths).toEqual([]);
  });

  test("answers with the created code when Next.js refuses the revalidation", async () => {
    refusesRevalidation = true;

    const result = await mutateDiscounts(customerCodeCreation, {
      discounts: { createCustomerCode: () => Effect.succeed(codeId) },
    });

    expect(result).toMatchObject({
      _tag: "Success",
      success: { kind: "create-customer-code", createdCodeId: codeId },
    });
    expect(revalidatedPaths).toEqual([]);
  });
});
