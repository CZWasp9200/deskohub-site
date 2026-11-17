import { DotyposService } from "@deskohub/dotypos";
import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { CustomerEmailLocaleService } from "@/features/account";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { WorkspaceCheckoutNetworkDetailsService } from "@/features/checkout/backend/fulfillment/network-details.service";
import { WorkspaceReservationEmailService } from "@/features/checkout/backend/fulfillment/workspace-reservation-email.service";
import { PaymentRefundService } from "@/features/checkout/backend/payment/payment-refund.service";
import { administrationForcedPaymentCancellationFailureCode } from "@/features/checkout/backend/repositories/payment-lifecycle.repository";
import { WorkspaceTableAssignmentService } from "@/features/checkout/backend/reservation/workspace-table-assignment.service";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";
import { SeatingMapReleaseGate } from "@/features/reservation/backend/seating-map-release-gate";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationDetails,
  WorkspaceReservationService,
} from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { ReservationAccessService } from "@/features/reservation-access";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { WorkspaceEmailLayer } from "@/shared/backend/config/email.config";
import { servicePerOperation } from "@/shared/backend/service-per-operation";
import {
  ReservationAdministrationError,
  type ReservationCancellationFailureReason,
} from "./reservation-administration-error";
import {
  type ReservationRestorationInput,
  type ReservationRestorationResult,
  ReservationRestorationService,
} from "./reservation-restoration.service";
import {
  ADMINISTRATION_CANCELLATION_RETRY_AFTER_MS,
  canCancelReservation,
} from "./reservation-status";

type ReservationCancellationResult = {
  readonly outcome: "cancelled" | "already_cancelled";
  readonly email: "not_requested" | "sent" | "failed";
};

// Existing callers import the error from here.
export { ReservationAdministrationError } from "./reservation-administration-error";

type ReservationCancellationInput = {
  readonly force?: boolean;
  readonly reservationId: WorkspaceReservationId;
  readonly sendCancellationEmail: boolean;
};

interface IReservationAdministrationService {
  readonly cancel: (
    input: ReservationCancellationInput
  ) => Effect.Effect<
    ReservationCancellationResult,
    ReservationAdministrationError
  >;
  readonly restore: (
    input: ReservationRestorationInput
  ) => Effect.Effect<
    ReservationRestorationResult,
    ReservationAdministrationError
  >;
}

export class ReservationAdministrationService extends Context.Service<
  ReservationAdministrationService,
  IReservationAdministrationService
>()("@deskohub-workspace/administration/ReservationAdministrationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      const emails = yield* WorkspaceReservationEmailService;
      const reservations = yield* WorkspaceReservationRepository;
      const reservationDetails = yield* WorkspaceReservationService;
      const restoration = yield* ReservationRestorationService;

      const claimCancellation = Effect.fnUntraced(function* (
        current: WorkspaceReservation,
        forcedPendingPayment: boolean
      ) {
        const pendingPaymentCancellation = getPendingPaymentCancellation(
          current,
          forcedPendingPayment
        );
        const claimed = yield* reservations
          .claimAdministrationCancellation({
            id: current.id,
            ...(pendingPaymentCancellation && {
              pendingPaymentCancellation,
            }),
            staleCancellingBefore: Temporal.Now.instant().subtract({
              milliseconds: ADMINISTRATION_CANCELLATION_RETRY_AFTER_MS,
            }),
          })
          .pipe(
            Effect.mapError((cause) =>
              cancellationFailed(
                "claim_failed",
                "The reservation could not be claimed for cancellation.",
                cause
              )
            )
          );
        if (!claimed) {
          return yield* new ReservationAdministrationError({
            code: "not_cancellable",
            reason: "changed",
            message:
              "The reservation changed while cancellation was starting. Refresh and try again.",
          });
        }
        return claimed;
      });

      /**
       * Cancels the reservation in Dotypos. When that fails, a reservation
       * Dotypos already reports as cancelled counts as done; otherwise the
       * claim is marked failed.
       */
      const cancelInDotypos = Effect.fnUntraced(function* (
        current: WorkspaceReservation,
        details: WorkspaceReservationDetails,
        claimed: WorkspaceReservation,
        administrationForceCancellation: boolean
      ) {
        yield* dotypos.cancelReservation(details.dotyposReservationId).pipe(
          Effect.catch(
            Effect.fn(function* (cause) {
              const cancelled = yield* reservationDetails
                .getReservation(current.id)
                .pipe(
                  Effect.map((latest) => latest.providerStatus === "CANCELLED"),
                  Effect.orElseSucceed(() => false)
                );
              if (cancelled) return;

              yield* reservations
                .markAdministrationCancellationFailed({
                  id: claimed.id,
                  claimedAt: claimed.updatedAt,
                  failureCode: getCancellationFailureCode(
                    administrationForceCancellation,
                    "admin_dotypos_cancel_failed"
                  ),
                })
                .pipe(Effect.ignore);
              return yield* Effect.fail(cause);
            })
          ),
          Effect.mapError((cause) =>
            cancellationFailed(
              "dotypos_failed",
              "Dotypos could not cancel the reservation.",
              cause
            )
          )
        );
      });

      /**
       * Records the completed cancellation, or marks the claim failed when
       * that write fails. Returns when the reservation was cancelled.
       */
      const recordCancellation = Effect.fnUntraced(function* (
        claimed: WorkspaceReservation,
        administrationForceCancellation: boolean
      ) {
        const cancelledAt = Temporal.Now.instant();
        yield* reservations
          .markAdministrationCancelled({
            id: claimed.id,
            cancelledAt,
            claimedAt: claimed.updatedAt,
            failureCode: getCancellationFailureCode(
              administrationForceCancellation,
              null
            ),
          })
          .pipe(
            Effect.tapError(() =>
              reservations
                .markAdministrationCancellationFailed({
                  id: claimed.id,
                  claimedAt: claimed.updatedAt,
                  failureCode: getCancellationFailureCode(
                    administrationForceCancellation,
                    "admin_local_cancel_failed"
                  ),
                })
                .pipe(Effect.ignore)
            ),
            Effect.mapError((cause) =>
              cancellationFailed(
                "record_failed",
                "The completed cancellation could not be recorded.",
                cause
              )
            )
          );
        return cancelledAt;
      });

      /**
       * Records that the customer was told about the cancellation, so a
       * restore can tell them in turn. The email went out either way, so a
       * failed record only logs.
       */
      const recordCancellationEmail = (input: {
        readonly id: WorkspaceReservationId;
        readonly cancelledAt: Temporal.Instant;
      }) =>
        reservations
          .recordCancellationEmailSent({
            ...input,
            sentAt: Temporal.Now.instant(),
          })
          .pipe(
            Effect.flatMap((recorded) =>
              recorded
                ? Effect.void
                : Effect.logWarning(
                    "The cancellation email was sent after the reservation changed, so it was not recorded."
                  )
            ),
            Effect.catch((cause) =>
              Effect.logWarning(
                "The sent cancellation email could not be recorded.",
                cause
              )
            )
          );

      return {
        cancel: Effect.fn("ReservationAdministrationService.cancel")(
          function* (input) {
            const current = yield* reservations
              .findById(input.reservationId)
              .pipe(
                Effect.mapError((cause) =>
                  cancellationFailed(
                    "reservation_unavailable",
                    "The reservation could not be loaded.",
                    cause
                  )
                )
              );
            if (!current) {
              return yield* new ReservationAdministrationError({
                code: "not_found",
                reason: "not_found",
                message: "The reservation was not found.",
              });
            }
            if (current.reservationState === "cancelled") {
              return {
                outcome: "already_cancelled",
                email: "not_requested",
              };
            }
            const forcedPendingPayment =
              current.paymentState === "pending" && input.force === true;
            const administrationForceCancellation =
              forcedPendingPayment ||
              current.failureCode ===
                administrationForcedPaymentCancellationFailureCode;
            if (
              !canCancelReservation(
                current,
                Temporal.Now.instant(),
                forcedPendingPayment
              )
            ) {
              return yield* getUncancellableReservationError(current);
            }

            const details = yield* reservationDetails
              .getReservation(current.id)
              .pipe(
                Effect.mapError((cause) =>
                  cancellationFailed(
                    "details_unavailable",
                    "The current reservation details could not be loaded.",
                    cause
                  )
                )
              );
            const refusal = getProviderStateRefusal(
              current,
              details,
              forcedPendingPayment
            );
            if (refusal) return yield* refusal;
            const claimed = yield* claimCancellation(
              current,
              forcedPendingPayment
            );

            if (details.providerStatus !== "CANCELLED") {
              yield* cancelInDotypos(
                current,
                details,
                claimed,
                administrationForceCancellation
              );
            }

            const cancelledAt = yield* recordCancellation(
              claimed,
              administrationForceCancellation
            );

            const email = yield* sendLoadedCancellationEmail({
              send: input.sendCancellationEmail,
              details,
              emails,
            });
            if (email === "sent") {
              yield* recordCancellationEmail({ id: claimed.id, cancelledAt });
            }
            return { outcome: "cancelled", email };
          }
        ),
        restore: restoration.restore,
      } satisfies IReservationAdministrationService;
    })
  );

  /**
   * The service as an administration API serves it. An administration API
   * builds its services once per process, so each cancellation and restore
   * builds its own seating-map release decision and the reservation details
   * read over it, which would otherwise reach every later request. `shared`
   * holds no request state: it builds once with the returned Layer, and
   * every operation takes that instance.
   */
  static perOperationOver = <E, R>(
    shared: Layer.Layer<
      | AccountingDocumentSnapshotRepository
      | DotyposService
      | PaymentRefundService
      | ReservationAccessService
      | WorkspaceDatabase
      | WorkspaceFeatureFlagService
      | WorkspaceReservationEmailService
      | WorkspaceReservationRepository
      | WorkspaceTableAssignmentService,
      E,
      R
    >
  ) =>
    servicePerOperation(
      this,
      { cancel: true, restore: true },
      this.Default.pipe(
        Layer.provide(ReservationRestorationService.Default),
        Layer.provide(WorkspaceReservationService.Default),
        Layer.provide(SeatingMapReleaseGate.Default)
      )
    ).pipe(Layer.provide(shared));

  static Live = this.perOperationOver(
    Layer.mergeAll(
      WorkspaceReservationEmailService.Default.pipe(
        Layer.provide(
          Layer.provideMerge(
            Layer.provideMerge(
              WorkspaceEmailLayer,
              WorkspaceCheckoutNetworkDetailsService.Default
            ),
            CustomerEmailLocaleService.Live
          )
        )
      ),
      WorkspaceReservationRepository.Default,
      WorkspaceDotyposLayer,
      WorkspaceFeatureFlagService.Default,
      PaymentRefundService.Live,
      AccountingDocumentSnapshotRepository.Default.pipe(
        Layer.provide(AccountingSnapshotKeyService.Default)
      ),
      ReservationAccessService.Live,
      WorkspaceTableAssignmentService.Default.pipe(
        Layer.provide(WorkspaceReservationRepository.Default),
        Layer.provide(WorkspaceDotyposLayer)
      )
    ).pipe(Layer.provideMerge(WorkspaceDatabase.Default))
  );
}

type IWorkspaceReservationEmailService =
  WorkspaceReservationEmailService["Service"];

const sendLoadedCancellationEmail = ({
  details,
  emails,
  send,
}: {
  readonly details: Parameters<
    IWorkspaceReservationEmailService["sendCancellationEmail"]
  >[0]["reservation"];
  readonly emails: IWorkspaceReservationEmailService;
  readonly send: boolean;
}) =>
  emails.sendCancellationEmail({ reservation: details }).pipe(
    Effect.as("sent" as const),
    Effect.orElseSucceed(() => "failed" as const),
    Effect.when(Effect.succeed(send)),
    Effect.map(Option.getOrElse(() => "not_requested" as const))
  );

const cancellationFailed = (
  reason: ReservationCancellationFailureReason,
  message: string,
  cause: unknown
) =>
  new ReservationAdministrationError({
    code: "cancellation_failed",
    reason,
    message,
    cause,
  });

/** Why a reservation that can't be cancelled in its current state is refused. */
const getUncancellableReservationError = (
  current: Pick<WorkspaceReservation, "fulfillmentState">
) => {
  if (current.fulfillmentState === "awaiting_delivery") {
    return new ReservationAdministrationError({
      code: "not_cancellable",
      reason: "delivery_in_progress",
      message:
        "The confirmation email is still being delivered. Try again after delivery completes.",
    });
  }
  if (current.fulfillmentState === "processing") {
    return new ReservationAdministrationError({
      code: "not_cancellable",
      reason: "confirmation_in_progress",
      message:
        "The reservation is being confirmed. Try again after confirmation finishes.",
    });
  }
  return new ReservationAdministrationError({
    code: "not_cancellable",
    reason: "invalid_state",
    message: "The reservation cannot be cancelled in its current state.",
  });
};

/**
 * Refuses a cancellation Dotypos already made outside Workspace, or one a
 * pending payment blocks unless the operator forced it for an active attempt.
 */
const getProviderStateRefusal = (
  current: Pick<
    WorkspaceReservation,
    "activePaymentAttemptId" | "paymentState" | "reservationState"
  >,
  details: Pick<WorkspaceReservationDetails, "providerStatus">,
  forcedPendingPayment: boolean
) => {
  if (
    details.providerStatus === "CANCELLED" &&
    !["cancelling", "cancellation_failed"].includes(current.reservationState)
  ) {
    return new ReservationAdministrationError({
      code: "not_cancellable",
      reason: "cancelled_in_dotypos",
      message:
        "Dotypos already reports this reservation as cancelled. Use the recovery workflow instead.",
    });
  }
  if (
    current.paymentState === "pending" &&
    (!forcedPendingPayment || !current.activePaymentAttemptId)
  ) {
    return new ReservationAdministrationError({
      code: "not_cancellable",
      reason: "pending_payment",
      message:
        "The reservation has a pending payment. Retry with force only after reviewing the provider payment.",
    });
  }
  return undefined;
};

/** The pending payment a forced cancellation terminalizes with its claim. */
const getPendingPaymentCancellation = (
  current: Pick<WorkspaceReservation, "activePaymentAttemptId">,
  forcedPendingPayment: boolean
) =>
  forcedPendingPayment && current.activePaymentAttemptId
    ? {
        paymentAttemptId: current.activePaymentAttemptId,
        failureCode: administrationForcedPaymentCancellationFailureCode,
      }
    : undefined;

/** A forced cancellation keeps its own failure code on every outcome. */
const getCancellationFailureCode = <Code extends string | null>(
  administrationForceCancellation: boolean,
  code: Code
) =>
  administrationForceCancellation
    ? administrationForcedPaymentCancellationFailureCode
    : code;
