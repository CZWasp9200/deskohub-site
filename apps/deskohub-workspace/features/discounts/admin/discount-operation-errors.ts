import {
  type AdministrationOperationError,
  OperationConflict,
  OperationNotFound,
  OperationUnavailable,
} from "@deskohub/workspace-admin-api";
import type { Effect } from "effect";
import { Match } from "effect";
import type { AdministratorGrantReadFailure } from "@/features/administration/administration-operation-port";
import type { DiscountAdminConflictReason } from "./discount-administration.service";
import type { DiscountAdminMissingResource } from "./discount-administration-errors";
import type { executeDiscountAdminMutation } from "./execute-discount-admin-mutation";

const notFoundCodes = {
  discount: "discount-not-found",
  "discount code": "discount-code-not-found",
  voucher: "voucher-not-found",
  "Dotypos customer": "dotypos-customer-not-found",
  "Dotypos discount group": "dotypos-discount-group-not-found",
  "code audience membership": "code-audience-membership-not-found",
  "voucher audience membership": "voucher-audience-membership-not-found",
} as const satisfies Record<DiscountAdminMissingResource["kind"], string>;

const finalAudienceCustomerCodes = {
  "discount-code": "code-final-audience-customer",
  voucher: "voucher-final-audience-customer",
} as const;

/**
 * The stable code of each discount mutation failure an operator can act on.
 * A conflict's code is its reason.
 */
export type DiscountOperationFailureCode =
  | (typeof notFoundCodes)[keyof typeof notFoundCodes]
  | (typeof finalAudienceCustomerCodes)[keyof typeof finalAudienceCustomerCodes]
  | DiscountAdminConflictReason
  | "service-dates-invalid";

/** A failure of the discount mutation itself. */
export type DiscountMutationFailure = Effect.Error<
  ReturnType<typeof executeDiscountAdminMutation>
>;

/**
 * Maps a discount mutation failure to its port category with a stable code.
 * The message stays the domain error's English message, which the
 * administration API answers with. A refused audience removal and refused
 * service dates are conflicts, as the administration API has always answered
 * them. Any other failure is an unavailable dependency. Port errors pass
 * through unchanged.
 */
export const toDiscountOperationError = (
  cause:
    | DiscountMutationFailure
    | AdministratorGrantReadFailure
    | AdministrationOperationError
): AdministrationOperationError =>
  Match.value(cause).pipe(
    Match.tag(
      "OperationUnauthorized",
      "OperationInputInvalid",
      "OperationConflict",
      "OperationNotFound",
      "OperationUnavailable",
      "OperationInProgress",
      (failure) => failure
    ),
    Match.tag(
      "DiscountAdminNotFoundError",
      (failure) =>
        new OperationNotFound({
          code: notFoundCodes[failure.resource.kind],
          message: failure.message,
          cause: failure,
        })
    ),
    Match.tag(
      "DiscountAdminAudienceError",
      (failure) =>
        new OperationConflict({
          code: finalAudienceCustomerCodes[failure.promotionKind],
          message: failure.message,
          cause: failure,
        })
    ),
    Match.tag(
      "DiscountAdminConflictError",
      (failure) =>
        new OperationConflict({
          code: failure.reason,
          message: failure.message,
          cause: failure,
        })
    ),
    Match.tag(
      "DiscountAdminServiceDatesError",
      (failure) =>
        new OperationConflict({
          code: "service-dates-invalid",
          message: failure.message,
          cause: failure,
        })
    ),
    Match.orElse(
      (failure) =>
        new OperationUnavailable({
          code: "service-unavailable",
          message: "The administration API is temporarily unavailable.",
          cause: failure,
        })
    )
  );
