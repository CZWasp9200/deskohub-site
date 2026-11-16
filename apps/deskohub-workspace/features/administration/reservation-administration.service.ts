import { DotyposService } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { isDatabaseQueryError } from "@/db/sql-constraint";
import { CustomerEmailLocaleService } from "@/features/account";
import {
  InvoiceCancellationService,
  type ReservationInvoiceRecording,
} from "@/features/accounting/backend/invoice-cancellation.service";
import type { InvoiceNoticeSummary } from "@/features/accounting/invoice-cancellation";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { AdministrationActor } from "@/features/administrators/administration-source";
import { WorkspaceCheckoutNetworkDetailsService } from "@/features/checkout/backend/fulfillment/network-details.service";
import { WorkspaceReservationEmailService } from "@/features/checkout/backend/fulfillment/workspace-reservation-email.service";
import { administrationForcedPaymentCancellationFailureCode } from "@/features/checkout/backend/repositories/payment-lifecycle.repository";
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
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { WorkspaceEmailLayer } from "@/shared/backend/config/email.config";
import { servicePerOperation } from "@/shared/backend/service-per-operation";
import {
  ADMINISTRATION_CANCELLATION_RETRY_AFTER_MS,
  canCancelReservation,
} from "./reservation-status";

/** The reservation's invoice, cancelled with it. */
type ReservationInvoiceCancellation = {
  readonly outcome: "cancelled" | "already_cancelled";
  readonly invoiceId: InvoiceId;
  readonly invoiceNumber: string;
  readonly correctiveDocumentNumber: string;
  readonly notices: InvoiceNoticeSummary;
};

type ReservationCancellationResult = {
  readonly outcome: "cancelled" | "already_cancelled";
  readonly email: "not_requested" | "sent" | "failed";
  /** `null` when the reservation had no live invoice to cancel. */
  readonly invoice: ReservationInvoiceCancellation | null;
};

export type ReservationCancellationFailureReason =
  | "not_found"
  | "delivery_in_progress"
  | "confirmation_in_progress"
  | "invalid_state"
  | "cancelled_in_dotypos"
  | "pending_payment"
  | "changed"
  | "reservation_unavailable"
  | "details_unavailable"
  | "claim_failed"
  | "dotypos_failed"
  | "record_failed"
  | "invoice_unavailable"
  | "confirmation_stale";

export class ReservationAdministrationError extends Data.TaggedError(
  "ReservationAdministrationError"
)<{
  readonly code: "not_found" | "not_cancellable" | "cancellation_failed";
  /** Why the cancellation stopped, so the Admin UI can explain it in the operator's language. */
  readonly reason: ReservationCancellationFailureReason;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * The invoice consequences the operator saw before confirming. Callers that
 * predate invoice cancellation (released `dhw` binaries) omit them, and the
 * check is skipped.
 */
type ReservationCancellationConfirmedConsequences = {
  /** The reservation's live invoice is cancelled with it. */
  readonly invoice: boolean;
  /** The customer is emailed a cancellation notice for that invoice. */
  readonly customerNotice: boolean;
};

export type ReservationCancellationInput = {
  readonly actor: AdministrationActor;
  readonly confirmedConsequences?: ReservationCancellationConfirmedConsequences;
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
}

export class ReservationAdministrationService extends Context.Service<
  ReservationAdministrationService,
  IReservationAdministrationService
>()("@deskohub-workspace/administration/ReservationAdministrationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { transaction } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;
      const emails = yield* WorkspaceReservationEmailService;
      const invoiceCancellation = yield* InvoiceCancellationService;
      const reservations = yield* WorkspaceReservationRepository;
      const reservationDetails = yield* WorkspaceReservationService;

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
       * Records the completed cancellation and cancels the reservation's live
       * invoice in one transaction, so both happen or neither does. When that
       * fails, the claim is marked failed.
       */
      const recordCancellation = Effect.fnUntraced(function* (
        claimed: WorkspaceReservation,
        administrationForceCancellation: boolean,
        actor: AdministrationActor
      ) {
        return yield* transaction(
          Effect.gen(function* () {
            yield* reservations.markAdministrationCancelled({
              id: claimed.id,
              cancelledAt: Temporal.Now.instant(),
              claimedAt: claimed.updatedAt,
              failureCode: getCancellationFailureCode(
                administrationForceCancellation,
                null
              ),
            });
            return yield* invoiceCancellation.recordForReservation({
              reservationId: claimed.id,
              actor,
            });
          })
        ).pipe(
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
      });

      /**
       * Reads what the cancellation will do to the reservation's invoice. An
       * unreadable invoice stops it; consequences the operator did not see
       * refuse it. Runs in the claim's transaction, after the claim.
       */
      const checkInvoiceConsequences = Effect.fnUntraced(function* (
        input: ReservationCancellationInput
      ) {
        const plan = yield* invoiceCancellation
          .planForReservation(input.reservationId)
          .pipe(
            Effect.mapError((cause) =>
              cause.code === "document_unavailable"
                ? cancellationFailed(
                    "invoice_unavailable",
                    "The reservation's invoice could not be read, so it cannot be cancelled with the reservation.",
                    cause
                  )
                : cancellationFailed(
                    "reservation_unavailable",
                    "The reservation's invoice could not be loaded.",
                    cause
                  )
            )
          );
        const confirmed = input.confirmedConsequences;
        if (
          plan &&
          confirmed &&
          (!confirmed.invoice ||
            (plan.customerNotice === "owed" && !confirmed.customerNotice))
        ) {
          return yield* new ReservationAdministrationError({
            code: "not_cancellable",
            reason: "confirmation_stale",
            message:
              "The reservation's invoice changed since the cancellation was confirmed. Refresh and review the consequences again.",
          });
        }
      });

      /**
       * Claims the reservation and checks its invoice consequences in one
       * transaction, before the provider call. The claim's row lock makes
       * invoice issuance wait, and issuance refuses a cancelling reservation,
       * so the invoice the check reads is the one the completion cancels: an
       * invoice issued before the claim is seen by the check, one issued after
       * it is refused. A failed check rolls the claim back.
       */
      const claimWithInvoiceConsequences = Effect.fnUntraced(function* (
        input: ReservationCancellationInput,
        current: WorkspaceReservation,
        forcedPendingPayment: boolean
      ) {
        return yield* transaction(
          Effect.gen(function* () {
            const claimed = yield* claimCancellation(
              current,
              forcedPendingPayment
            );
            yield* checkInvoiceConsequences(input);
            return claimed;
          })
        ).pipe(
          Effect.mapError((cause) =>
            isDatabaseQueryError(cause)
              ? cancellationFailed(
                  "claim_failed",
                  "The reservation could not be claimed for cancellation.",
                  cause
                )
              : cause
          )
        );
      });

      const deliverInvoiceNotices = (
        recording: ReservationInvoiceRecording | null
      ) =>
        recording
          ? invoiceCancellation.deliverNotices(recording).pipe(
              Effect.map(
                ({ notices }): ReservationInvoiceCancellation => ({
                  outcome: recording.changed
                    ? "cancelled"
                    : "already_cancelled",
                  invoiceId: recording.record.invoiceId,
                  invoiceNumber: recording.invoiceNumber,
                  correctiveDocumentNumber:
                    recording.record.correctiveDocumentNumber,
                  notices,
                })
              )
            )
          : Effect.succeed(null);

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
                invoice: null,
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
            const claimed = yield* claimWithInvoiceConsequences(
              input,
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

            const invoiceRecording = yield* recordCancellation(
              claimed,
              administrationForceCancellation,
              input.actor
            );

            const email = yield* sendLoadedCancellationEmail({
              send: input.sendCancellationEmail,
              details,
              emails,
            });
            return {
              outcome: "cancelled",
              email,
              invoice: yield* deliverInvoiceNotices(invoiceRecording),
            };
          }
        ),
      } satisfies IReservationAdministrationService;
    })
  );

  /**
   * The service as an administration API serves it. An administration API
   * builds its services once per process, so each cancellation builds its
   * own seating-map release decision and the reservation details read over
   * it, which would otherwise reach every later request. `shared` holds no
   * request state: it builds once with the returned Layer, and every
   * cancellation takes that instance.
   */
  static perOperationOver = <E, R>(
    shared: Layer.Layer<
      | DotyposService
      | InvoiceCancellationService
      | WorkspaceDatabase
      | WorkspaceFeatureFlagService
      | WorkspaceReservationEmailService
      | WorkspaceReservationRepository,
      E,
      R
    >
  ) =>
    servicePerOperation(
      this,
      { cancel: true },
      this.Default.pipe(
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
      InvoiceCancellationService.Live
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
