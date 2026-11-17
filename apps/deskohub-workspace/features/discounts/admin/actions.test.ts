import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Fiber, Layer, Predicate } from "effect";
import { administrationHref } from "@/features/administration/administration-href";
import { mockAdministrationActionRequest } from "@/shared/testing/workspace-action-request.test-utils";

const revalidatedPaths: string[] = [];
// The mutation and every tag invalidation and `after` callback, each with
// whether it ran inside a fiber. The action's own telemetry flush schedules
// `after` callbacks before the mutation.
const timeline: string[] = [];
const fiberState = () =>
  Fiber.getCurrent() === undefined ? "outside" : "inside";
const sinceMutation = () => timeline.slice(timeline.indexOf("inside:mutate"));

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({
  cacheLife: () => undefined,
  cacheTag: () => undefined,
  revalidatePath: () => undefined,
  revalidateTag: (tag: string) => {
    timeline.push(`${fiberState()}:revalidate:${tag}`);
  },
}));
const request = await mockAdministrationActionRequest({
  administrator: "discount-administration-actions",
  referer: "https://deskohub.test/en-US/admin",
});
const { access } = request;
request.after.mockImplementation(() => {
  timeline.push(`${fiberState()}:after`);
});
mock.module("@/features/i18n/server/revalidate-localized-path", () => ({
  revalidateLocalizedPath: (path: string) => {
    revalidatedPaths.push(path);
  },
}));

const {
  DiscountAdministration,
  DiscountAdminAudienceError,
  DiscountAdminConflictError,
  DiscountAdminNotFoundError,
  DiscountAdminServiceDatesError,
} = await import("./discount-administration.service");
const { AccountRoleGrants } = await import(
  "@/features/administrators/backend/account-role-grants.service"
);
const { m } = await import("@/features/administration/i18n");
const { calendarDiscountSourceTag } = await import(
  "../calendar-discount-source.server"
);

type Administration = DiscountAdministration["Service"];

let administration: Partial<
  Record<keyof Administration, () => Effect.Effect<unknown, unknown>>
> = {};
const calls: string[] = [];

// Answers only the calls a test sets; any other call is a test failure.
const originalLive = DiscountAdministration.Live;
DiscountAdministration.Live = Layer.succeed(
  DiscountAdministration,
  new Proxy({} as Administration, {
    get: (_, method) => {
      if (!Predicate.isString(method)) return undefined;
      calls.push(method);
      return (
        administration[method as keyof Administration] ??
        (() => Effect.die(`unexpected ${method}`))
      );
    },
  })
);

// The access gate checks the grant; an operation port re-reads it.
const originalGrants = AccountRoleGrants.Live;
AccountRoleGrants.Live = Layer.mock(AccountRoleGrants, {
  has: () => Effect.succeed(true),
});

// Imported after the fakes, since the actions take the layers on load.
const { mutateDiscountAdmin } = await import("./actions");

const customerCode = {
  kind: "create-customer-code",
  customerId: "customer-id",
  code: {
    code: "SUMMER10",
    enabled: true,
    validFrom: "2026-08-01T00:00:00+02:00",
    validUntil: "2026-09-01T00:00:00+02:00",
    maxUses: 100,
  },
  discount: {
    kind: "existing",
    discountId: "019c91dd-c560-7e55-b9d8-c95065efd51d",
  },
} as const;

const recordMutation = <A, E>(mutation: Effect.Effect<A, E>) =>
  Effect.andThen(
    Effect.sync(() => timeline.push(`${fiberState()}:mutate`)),
    mutation
  );

afterAll(() => {
  DiscountAdministration.Live = originalLive;
  AccountRoleGrants.Live = originalGrants;
});

beforeEach(() => {
  access.set("administrator");
  administration = {};
  calls.length = 0;
  revalidatedPaths.length = 0;
  timeline.length = 0;
});

describe("mutateDiscountAdmin", () => {
  test("revalidates the customer page a customer code was created for", async () => {
    administration = {
      createCustomerCode: () =>
        recordMutation(Effect.succeed("019c91dd-c560-7e55-b9d8-c95065efd51f")),
    };

    const result = await mutateDiscountAdmin(customerCode);

    expect(result).toHaveProperty("data");
    expect(calls).toEqual(["createCustomerCode"]);
    expect(revalidatedPaths).toEqual([
      administrationHref("/[locale]/admin/customers/[customerId]", {
        customerId: "customer-id",
      }),
    ]);
    expect(sinceMutation()).toEqual(["inside:mutate"]);
  });

  test("refreshes the calendar discounts after a discount change settles", async () => {
    administration = {
      deleteDiscount: () => recordMutation(Effect.void),
    };

    const result = await mutateDiscountAdmin({
      kind: "delete-discount",
      id: "019c91dd-c560-7e55-b9d8-c95065efd51d",
    });

    expect(result).toHaveProperty("data");
    expect(sinceMutation()).toEqual([
      "inside:mutate",
      `outside:revalidate:${calendarDiscountSourceTag}`,
      "outside:after",
    ]);
  });

  test("words a failed mutation for the operator and revalidates nothing", async () => {
    const missing = new DiscountAdminNotFoundError({
      resource: { kind: "Dotypos customer", id: "customer-id" as never },
      message: "missing",
    });
    administration = {
      createCustomerCode: () => recordMutation(Effect.fail(missing)),
    };

    const result = await mutateDiscountAdmin(customerCode);

    expect(result).toEqual({
      serverError: m.discountsErrorDotyposCustomerMissing(
        {},
        { locale: "en-US" }
      ),
    });
    expect(revalidatedPaths).toEqual([]);
    expect(sinceMutation()).toEqual(["inside:mutate"]);
  });

  test("refuses an account without the grant before any mutation", async () => {
    access.set("not-administrator");

    const result = await mutateDiscountAdmin(customerCode);

    expect(result).toHaveProperty("serverError");
    expect(result).not.toHaveProperty("data");
    expect(calls).toEqual([]);
    expect(revalidatedPaths).toEqual([]);
  });

  test("answers an account without the grant with the generic failure", async () => {
    access.set("not-administrator");

    const result = await mutateDiscountAdmin(customerCode);

    expect(result).toEqual({
      serverError: m.discountsErrorSaveFailed({}, { locale: "en-US" }),
    });
  });

  test.each([
    ...(
      [
        ["discount", m.discountsErrorDiscountMissing],
        ["discount code", m.discountsErrorCodeMissing],
        ["voucher", m.discountsErrorVoucherMissing],
        ["Dotypos customer", m.discountsErrorDotyposCustomerMissing],
        ["Dotypos discount group", m.discountsErrorDotyposDiscountGroupMissing],
        [
          "code audience membership",
          m.discountsErrorCodeAudienceMembershipMissing,
        ],
        [
          "voucher audience membership",
          m.discountsErrorVoucherAudienceMembershipMissing,
        ],
      ] as const
    ).map(
      ([kind, copy]) =>
        [
          `a missing ${kind}`,
          new DiscountAdminNotFoundError({
            resource: { kind, id: "resource-id" } as never,
            message: "missing",
          }),
          copy,
        ] as const
    ),
    ...(
      [
        ["discount-code", m.discountsErrorCodeFinalCustomer],
        ["voucher", m.discountsErrorVoucherFinalCustomer],
      ] as const
    ).map(
      ([promotionKind, copy]) =>
        [
          `the last ${promotionKind} audience customer`,
          new DiscountAdminAudienceError({ promotionKind, message: "last" }),
          copy,
        ] as const
    ),
    ...(
      [
        ["promotion-code-taken", m.discountsErrorPromotionCodeTaken],
        ["discount-referenced", m.discountsErrorDiscountReferenced],
        ["discount-code-claimed", m.discountsErrorCodeClaimed],
        ["voucher-claimed", m.discountsErrorVoucherClaimed],
        ["voucher-credit-below-usage", m.discountsErrorVoucherCreditBelowUsage],
        ["voucher-currency-locked", m.discountsErrorVoucherCurrencyLocked],
      ] as const
    ).map(
      ([reason, copy]) =>
        [
          `a ${reason} conflict`,
          new DiscountAdminConflictError({ reason, message: "conflict" }),
          copy,
        ] as const
    ),
    [
      "refused service dates",
      new DiscountAdminServiceDatesError({ message: "dates" }),
      m.discountsErrorServiceDatesInvalid,
    ] as const,
    [
      "an unavailable dependency",
      { _tag: "DotyposReadFailure", message: "Dotypos didn't answer." },
      m.discountsErrorSaveFailed,
    ] as const,
  ])("words %s with its own copy", async (_, failure, copy) => {
    administration = {
      deleteDiscount: () => Effect.fail(failure),
    };

    const result = await mutateDiscountAdmin({
      kind: "delete-discount",
      id: "019c91dd-c560-7e55-b9d8-c95065efd51d",
    });

    expect(result).toEqual({
      serverError: copy({}, { locale: "en-US" }),
    });
    expect(timeline).not.toContain(
      `outside:revalidate:${calendarDiscountSourceTag}`
    );
  });

  test("answers a defect with the unexpected-failure copy", async () => {
    administration = {
      deleteDiscount: () => Effect.die("unexpected"),
    };

    const result = await mutateDiscountAdmin({
      kind: "delete-discount",
      id: "019c91dd-c560-7e55-b9d8-c95065efd51d",
    });

    expect(result).toEqual({
      serverError: m.discountsActionFailedUnexpectedly({}, { locale: "en-US" }),
    });
  });

  test("leaves the calendar discounts alone for a voucher change", async () => {
    administration = {
      deleteVoucher: () => recordMutation(Effect.void),
    };

    const result = await mutateDiscountAdmin({
      kind: "delete-voucher",
      id: "019c91dd-c560-7e55-b9d8-c95065efd51e",
    });

    expect(result).toHaveProperty("data");
    expect(sinceMutation()).toEqual(["inside:mutate"]);
    expect(revalidatedPaths).toEqual([]);
  });
});
