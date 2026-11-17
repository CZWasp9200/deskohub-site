import "server-only";

import {
  type DiscountOperations as DiscountOperationRegistry,
  discountOperations,
} from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer } from "effect";
import { administrationHref } from "@/features/administration/administration-href";
import {
  type AdministrationOperationPort,
  makeAdministrationOperationPort,
  type OperationHandlers,
  type OperationLedger,
  type OperationSettlements,
  unscopedOperationLedger,
} from "@/features/administration/administration-operation-port";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { startCalendarDiscountSourceRefresh } from "./calendar-discount-source-maintenance.server";
import type { DiscountAdminMutation } from "./contracts";
import { DiscountAdministration } from "./discount-administration.service";
import {
  type DiscountMutationFailure,
  toDiscountOperationError,
} from "./discount-operation-errors";
import { executeDiscountAdminMutation } from "./execute-discount-admin-mutation";

/**
 * Where a discount mutation records its request ID. The administration API
 * keeps one per caller's channel; the Admin UI applies directly because
 * server actions aren't retried automatically.
 */
export class DiscountRequestLedger extends Context.Service<
  DiscountRequestLedger,
  OperationLedger<DiscountOperationRegistry>
>()("@deskohub-workspace/discounts/DiscountRequestLedger") {
  /** Applies every request; the caller never retries one on its own. */
  static unscoped = Layer.succeed(
    this,
    unscopedOperationLedger<DiscountOperationRegistry>()
  );
}

/** The customer pages a mutation adds a customer's own code or voucher to. */
const mutatedCustomerPages = (input: DiscountAdminMutation) => {
  if (input.kind === "create-customer-code") {
    return [
      administrationHref("/[locale]/admin/customers/[customerId]", {
        customerId: input.customerId,
      }),
    ];
  }
  if (input.kind === "create-customer-voucher") {
    return [
      administrationHref("/[locale]/admin/customers/[customerId]", {
        customerId: input.voucher.customerId,
      }),
    ];
  }
  return [];
};

/**
 * What a successful discount mutation made stale: the calendar's discount
 * source when the mutation changed it, and the customer page it added a
 * customer's own code or voucher to.
 */
export const discountOperationSettlements = {
  mutateDiscounts: {
    refreshes: startCalendarDiscountSourceRefresh,
    revalidates: mutatedCustomerPages,
  },
} satisfies OperationSettlements<DiscountOperationRegistry>;

/**
 * Builds the discount operation port from the discount administration, for
 * an adapter that holds the service itself.
 */
export const makeDiscountOperations = Effect.gen(function* () {
  const administration = yield* DiscountAdministration;
  const handlers: OperationHandlers<
    DiscountOperationRegistry,
    DiscountMutationFailure,
    never
  > = {
    mutateDiscounts: (mutation) =>
      executeDiscountAdminMutation(mutation).pipe(
        Effect.provideService(DiscountAdministration, administration)
      ),
  };
  return yield* makeAdministrationOperationPort({
    group: "DiscountOperations",
    operations: discountOperations,
    handlers,
    ledger: DiscountRequestLedger,
    toOperationError: toDiscountOperationError,
  });
});

/** The discount operation port the Admin UI and `/api/v1/cli` call. */
export class DiscountOperations extends Context.Service<
  DiscountOperations,
  AdministrationOperationPort<DiscountOperationRegistry, DiscountRequestLedger>
>()("@deskohub-workspace/discounts/DiscountOperations") {
  static Default = Layer.effect(this, makeDiscountOperations);

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(AccountRoleGrants.Live, DiscountAdministration.Live)
    )
  );
}
