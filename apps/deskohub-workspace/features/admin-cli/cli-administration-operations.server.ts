import {
  type AdministrationOperationError,
  CliInputInvalid,
  CliMutationInProgress,
  CliMutationRejected,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliSessionUnauthorized,
  CurrentAdministrationCaller,
  OperationConflict,
  OperationInProgress,
  OperationUnavailable,
} from "@deskohub/workspace-admin-api";
import { type Context, Effect, Match } from "effect";
import { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import { mapAdministrationApiFailure } from "./administration-api-failure";

/**
 * Maps a port error category to the CLI error with the same HTTP status:
 * invalid input 400, conflict and a request still being applied 409, not
 * found 404, unavailable 503. A revoked administrator is unauthorized (401),
 * as when the bearer middleware notices it first.
 */
const toCliFailure = (error: AdministrationOperationError) =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      OperationUnauthorized: ({ message }) =>
        new CliSessionUnauthorized({ message }),
      OperationInputInvalid: ({ code, message }) =>
        new CliInputInvalid({ code, message }),
      OperationConflict: ({ code, message }) =>
        new CliMutationRejected({ code, message }),
      OperationNotFound: ({ code, message }) =>
        new CliResourceNotFound({ code, message }),
      OperationUnavailable: ({ code, message }) =>
        new CliServiceUnavailable({ code, message }),
      OperationInProgress: ({ message, requestId }) =>
        new CliMutationInProgress({ message, requestId }),
    })
  );

/**
 * Runs an operation port's invocation for the calling administrator, with
 * the operation group's ledger for the caller's channel, and answers with
 * the CLI error of the port error's category.
 */
export const invokeAsCliCaller = <A, R, Ledger, LedgerService>(
  invocation: Effect.Effect<
    A,
    AdministrationOperationError,
    R | CurrentAdministrator | Ledger
  >,
  ledger: Context.Key<Ledger, LedgerService>,
  ledgerOf: (caller: CurrentAdministrationCaller["Service"]) => LedgerService
) =>
  CurrentAdministrationCaller.pipe(
    Effect.flatMap((caller) =>
      invocation.pipe(
        mapAdministrationApiFailure(toCliFailure),
        Effect.provideService(CurrentAdministrator, caller.actor),
        Effect.provideService(ledger, ledgerOf(caller))
      )
    )
  );

/**
 * The administration request ledger's own failures become port errors, so
 * the port answers them in its categories; other failures pass through.
 */
export const toOperationLedgerFailure = <E>(
  error: E | CliMutationInProgress | CliMutationRejected | CliServiceUnavailable
) => {
  if (error instanceof CliMutationInProgress) {
    return new OperationInProgress({
      code: "request-in-progress",
      message: error.message,
      requestId: error.requestId,
    });
  }
  if (error instanceof CliMutationRejected) {
    return new OperationConflict({
      code: "request-id-reused",
      message: error.message,
    });
  }
  if (error instanceof CliServiceUnavailable) {
    return new OperationUnavailable({
      code: error.code ?? "service-unavailable",
      message: error.message,
    });
  }
  return error;
};
