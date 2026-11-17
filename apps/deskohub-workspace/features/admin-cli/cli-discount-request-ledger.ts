import {
  AdministrationDiscountMutationResult,
  type AdministrationDiscountMutationResultType,
  type AdministrationDiscountMutationType,
  type AdministrationOperationError,
  type CliMutationRequestIdType,
  CurrentAdministrationCaller,
} from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { startOperationSettlement } from "@/features/administration/administration-operation-port";
import {
  type DiscountRequestLedger,
  discountOperationSettlements,
} from "@/features/discounts/admin/discount-operations.service";
import { discountMutationRecovery } from "./administration-mutation-recovery";
import {
  type AdministrationRequestLedger,
  StoredResult,
} from "./administration-request-ledger.service";
import { toOperationLedgerFailure } from "./cli-administration-operations.server";

/**
 * The administration API's discount ledger for one request: the caller's
 * channel keeps the request ID, so a retried request replays its first
 * result. The calendar refresh and customer-page revalidation the mutation
 * declares start best effort once a successful result is known, applied or
 * replayed; a failure settles nothing.
 */
export const cliDiscountRequestLedger = (
  ledger: AdministrationRequestLedger["Service"],
  caller: CurrentAdministrationCaller["Service"],
  requestId: CliMutationRequestIdType
): DiscountRequestLedger["Service"] => ({
  applyOnce: ({ input, apply }) =>
    // The port hands its one ledger operation over failing with port errors
    // and needing no services; a generic entry can't express either.
    applyDiscountMutation(
      ledger,
      caller,
      requestId,
      input,
      apply as never
    ) as never,
});

const applyDiscountMutation = (
  ledger: AdministrationRequestLedger["Service"],
  caller: CurrentAdministrationCaller["Service"],
  requestId: CliMutationRequestIdType,
  mutation: AdministrationDiscountMutationType,
  apply: Effect.Effect<
    AdministrationDiscountMutationResultType,
    AdministrationOperationError
  >
) =>
  ledger
    .applyOnceWithEffects({
      requestId,
      mutation,
      stored: StoredResult.unchanged(AdministrationDiscountMutationResult),
      apply,
      afterSettled: startOperationSettlement(
        discountOperationSettlements.mutateDiscounts,
        mutation
      ),
      recovery: discountMutationRecovery,
    })
    .pipe(
      Effect.mapError(toOperationLedgerFailure),
      Effect.provideService(CurrentAdministrationCaller, caller)
    );
