"use server";

import { Effect, Layer, Schema } from "effect";
import { accountActionError } from "@/features/account/account-action-guards";
import { requireAccountFeature } from "@/features/account/backend/account-feature-withheld";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { requireVerifiedSession } from "@/features/account/backend/verified-customer-session";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type {
  CustomerAccountAccessError,
  CustomerAccountId,
} from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import {
  type WithdrawalRefusedError,
  WithdrawalService,
  type WithdrawalUnavailableError,
} from "@/features/withdrawal/backend/withdrawal.service";
import { WithdrawalReleaseGate } from "@/features/withdrawal/backend/withdrawal-release-gate";
import { WithdrawalReleaseGateRequest } from "@/features/withdrawal/backend/withdrawal-release-gate.server";
import {
  toWithdrawalQuoteData,
  toWithdrawalReceiptData,
  type WithdrawalQuoteData,
  type WithdrawalReceiptData,
  type WithdrawalRefusal,
} from "@/features/withdrawal/withdrawal-read-model";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

const reservationWithdrawalSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ orderId: workspaceReservationIdSchema }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

/** The quote, or why the customer can't withdraw from the reservation now. */
export type ReservationWithdrawalQuoteResult =
  | { readonly status: "available"; readonly quote: WithdrawalQuoteData }
  | { readonly status: "refused"; readonly reason: WithdrawalRefusal };

/** The receipt, or why the withdrawal wasn't accepted. */
export type ReservationWithdrawalResult =
  | { readonly status: "withdrawn"; readonly receipt: WithdrawalReceiptData }
  | { readonly status: "refused"; readonly reason: WithdrawalRefusal };

/**
 * Runs a withdrawal operation for the signed-in customer while the online
 * withdrawal function is released; a closed gate reads as "unavailable".
 * Refusals are result data the client acts on; account failures read as the
 * account's errors, and anything else as the runtime's unexpected failure.
 */
const runForSignedInCustomer = <A>(
  locale: Locale,
  operation: (
    withdrawals: WithdrawalService["Service"],
    accountId: CustomerAccountId
  ) => Effect.Effect<
    A,
    | WithdrawalRefusedError
    | WithdrawalUnavailableError
    | CustomerAccountAccessError
  >
) =>
  Effect.gen(function* () {
    yield* requireAccountFeature("withdrawal", WithdrawalReleaseGate.isOpen);
    const user = yield* requireVerifiedSession;
    const withdrawals = yield* WithdrawalService;
    return yield* operation(withdrawals, user.accountId);
  }).pipe(
    Effect.map((value) => ({ status: "done" as const, value })),
    Effect.catchTag("WithdrawalRefusedError", ({ reason }) =>
      Effect.succeed({ status: "refused" as const, reason })
    ),
    Effect.catchTags({
      CustomerAccountAccessError: (error) =>
        Effect.fail(accountActionError(locale)(error)),
      AccountFeatureWithheldError: (error) =>
        Effect.fail(accountActionError(locale)(error)),
    }),
    Effect.provide(
      Layer.mergeAll(
        WithdrawalService.Live,
        CustomerAuthentication.Default,
        WithdrawalReleaseGateRequest
      )
    )
  );

const quoteReservationWithdrawalAction = defineWorkspaceAction(
  {
    operation: "account.quote-reservation-withdrawal",
    schema: reservationWithdrawalSchema,
  },
  (input, { locale }) =>
    runForSignedInCustomer(locale, (withdrawals, accountId) =>
      withdrawals.quote({
        accountId,
        locale,
        contract: { kind: "reservation", id: input.orderId },
      })
    ).pipe(
      Effect.map(
        (result): ReservationWithdrawalQuoteResult =>
          result.status === "done"
            ? { status: "available", quote: toWithdrawalQuoteData(result.value) }
            : result
      )
    )
);

const withdrawFromReservationAction = defineWorkspaceAction(
  {
    operation: "account.withdraw-from-reservation",
    schema: reservationWithdrawalSchema,
  },
  (input, { locale }) =>
    runForSignedInCustomer(locale, (withdrawals, accountId) =>
      withdrawals.withdraw({
        accountId,
        locale,
        contract: { kind: "reservation", id: input.orderId },
      })
    ).pipe(
      Effect.map(
        (result): ReservationWithdrawalResult =>
          result.status === "done"
            ? {
                status: "withdrawn",
                receipt: toWithdrawalReceiptData(result.value),
              }
            : result
      )
    )
);

export const quoteReservationWithdrawal: typeof quoteReservationWithdrawalAction =
  async (...args: Parameters<typeof quoteReservationWithdrawalAction>) => {
    "use server";
    return await quoteReservationWithdrawalAction(...args);
  };

export const withdrawFromReservation: typeof withdrawFromReservationAction =
  async (...args: Parameters<typeof withdrawFromReservationAction>) => {
    "use server";
    return await withdrawFromReservationAction(...args);
  };
