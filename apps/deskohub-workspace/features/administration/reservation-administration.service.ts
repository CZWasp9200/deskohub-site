import { DotyposService } from "@deskohub/dotypos";
import { Context, Effect, Layer, Option, Result } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { isDatabaseQueryError } from "@/db/sql-constraint";
import { CustomerEmailLocaleService } from "@/features/account";
import { AccountingDocumentSnapshots } from "@/features/accounting/backend/accounting-document-snapshots";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import {
  InvoiceCancellationService,
  type ReservationInvoiceRecording,
} from "@/features/accounting/backend/invoice-cancellation.service";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import {
  isInvoiceReplacedOnRestoration,
  readReservationInvoiceStanding,
} from "@/features/accounting/backend/reservation-invoice-standing";
import type { InvoiceNoticeSummary } from "@/features/accounting/invoice-cancellation";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { AdministrationActor } from "@/features/administrators/administration-source";
import { WorkspaceCheckoutNetworkDetailsService } from "@/features/checkout/backend/fulfillment/network-details.service";
import { PaidFulfillmentQueueService } from "@/features/checkout/backend/fulfillment/paid-fulfillment-queue.service";
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
import {
  canCancelReservation,
  REQUESTED_CANCELLATION_RETRY_AFTER_MS,
} from "@/features/reservation/reservation-cancellation-policy";
import { ReservationAccessService } from "@/features/reservation-access";
import { ReservationInvitations } from "@/features/reservation-invitees/backend/reservation-invitations.service";
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

/**
 * The new invoice a restore issues for the one cancelled with the
 * reservation. Issuing or sending it can fail after the restore committed;
 * the restore stands. `retrying`: the paid-fulfillment queue retries it.
 * `failed`: nothing retries it on its own; the customer's post-order page
 * offers the invoice (or resends an issued one), and a rerun of the restore
 * issues one still owed. `not_issued`: the cancelled invoice could not be
 * opened, so none issues.
 */
type ReservationRestorationInvoice = {
  readonly outcome: "issued" | "retrying" | "failed" | "not_issued";
  /** Set once the new invoice exists, even when sending it failed. */
  readonly invoiceId: InvoiceId | null;
  readonly invoiceNumber: string | null;
};

export type ReservationAdministrationRestorationResult =
  ReservationRestorationResult & {
    /** `null` when the reservation's invoice wasn't cancelled with it, or it had none. */
    readonly invoice: ReservationRestorationInvoice | null;
  };

// Existing callers import the error from here.
export { ReservationAdministrationError } from "./reservation-administration-error";

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
  readonly restore: (
    input: ReservationRestorationInput
  ) => Effect.Effect<
    ReservationAdministrationRestorationResult,
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
      const { db, transaction } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;
      const emails = yield* WorkspaceReservationEmailService;
      const invoiceCancellation = yield* InvoiceCancellationService;
      const reservations = yield* WorkspaceReservationRepository;
      const reservationDetails = yield* WorkspaceReservationService;
      const restoration = yield* ReservationRestorationService;
      const reservationInvoices = yield* ReservationInvoiceService;
      const paidFulfillment = yield* PaidFulfillmentQueueService;

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
              milliseconds: REQUESTED_CANCELLATION_RETRY_AFTER_MS,
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
       * fails, the claim is marked failed. Returns when the reservation was
       * cancelled and the invoice recording.
       */
      const recordCancellation = Effect.fnUntraced(function* (
        claimed: WorkspaceReservation,
        administrationForceCancellation: boolean,
        actor: AdministrationActor
      ) {
        const cancelledAt = Temporal.Now.instant();
        const invoiceRecording = yield* transaction(
          Effect.gen(function* () {
            yield* reservations.markAdministrationCancelled({
              id: claimed.id,
              cancelledAt,
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
        return { cancelledAt, invoiceRecording };
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

      /** The restored reservation's latest invoice when it is the replacement of `cancelled`. */
      const findReplacement = (
        reservationId: WorkspaceReservationId,
        cancelled: InvoiceId
      ) =>
        readReservationInvoiceStanding(db, reservationId).pipe(
          Effect.map((latest) =>
            latest && latest.state === "live" && latest.id !== cancelled
              ? latest
              : null
          ),
          Effect.orElseSucceed(() => null)
        );

      /**
       * After a failed replacement, the retry its origin has: the
       * paid-fulfillment queue, whose run for a fulfilled order issues and
       * sends its invoice alone, retries a `payment` one (`retrying`). A
       * `post_order` one isn't queued (`failed`): the customer's post-order
       * page offers the invoice again, and a rerun of the restore issues it.
       */
      const settleFailedReplacement = Effect.fnUntraced(function* (input: {
        readonly reservationId: WorkspaceReservationId;
        readonly cancelled: InvoiceId;
        readonly origin: "payment" | "post_order";
        readonly cause: unknown;
      }) {
        yield* Effect.logError(
          "The restored reservation's replacement invoice failed after the restore committed.",
          { origin: input.origin, cause: input.cause }
        );
        const queued =
          input.origin === "payment" &&
          (yield* paidFulfillment
            .enqueue({
              orderId: input.reservationId,
              replacesInvoiceId: input.cancelled,
            })
            .pipe(
              Effect.as(true),
              Effect.catch((cause) =>
                Effect.logFatal(
                  "The restored reservation's replacement invoice could not be queued for retry.",
                  cause
                ).pipe(Effect.as(false))
              )
            ));
        const replacement = yield* findReplacement(
          input.reservationId,
          input.cancelled
        );
        return {
          outcome: queued ? "retrying" : "failed",
          invoiceId: replacement?.id ?? null,
          invoiceNumber: replacement?.invoiceNumber ?? null,
        } satisfies ReservationRestorationInvoice;
      });

      const notIssued: ReservationRestorationInvoice = {
        outcome: "not_issued",
        invoiceId: null,
        invoiceNumber: null,
      };

      /**
       * Issues the replacement of the invoice cancelled with the reservation,
       * once the restore committed, through the issuance the cancelled one
       * came from: a credit note is never undone, so the restored reservation
       * gets a new invoice. A failure keeps the restore. A rerun of the
       * restore issues a replacement still owed. Like the restore email and
       * the cancellation notices, it absorbs typed failures only.
       */
      const issueReplacementInvoice = Effect.fnUntraced(function* (
        reservationId: WorkspaceReservationId
      ) {
        const standing = yield* readReservationInvoiceStanding(
          db,
          reservationId
        ).pipe(
          Effect.catch((cause) =>
            Effect.logFatal(
              "The restored reservation's invoice could not be read, so no replacement was issued; a rerun of the restore issues it.",
              cause
            ).pipe(Effect.as(null))
          )
        );
        if (!(standing && isInvoiceReplacedOnRestoration(standing))) {
          return null;
        }
        const plan = yield* reservationInvoices
          .planRestoredInvoice({ reservationId })
          .pipe(Effect.result);
        if (Result.isFailure(plan)) {
          yield* Effect.logFatal(
            "The restored reservation's replacement invoice could not be planned; a rerun of the restore issues it.",
            plan.failure
          );
          return {
            outcome: "failed",
            invoiceId: null,
            invoiceNumber: null,
          } satisfies ReservationRestorationInvoice;
        }
        if (plan.success.kind === "not_owed") return null;
        if (plan.success.kind === "unreadable") return notIssued;
        const reissue = plan.success;
        return yield* reservationInvoices.issueRestoredInvoice(reissue).pipe(
          Effect.map(
            (issued): ReservationRestorationInvoice =>
              issued === null
                ? notIssued
                : {
                    // A post-order replacement whose email failed waits for
                    // the customer's resend, as after creating one.
                    outcome: issued.delivered ? "issued" : "failed",
                    invoiceId: issued.invoiceId,
                    invoiceNumber: issued.invoiceNumber,
                  }
          ),
          Effect.catch((cause) =>
            settleFailedReplacement({
              reservationId,
              cancelled: reissue.cancelled.id,
              origin: reissue.origin,
              cause,
            })
          )
        );
      });

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

            const { cancelledAt, invoiceRecording } = yield* recordCancellation(
              claimed,
              administrationForceCancellation,
              input.actor
            );

            const email = yield* sendLoadedCancellationEmail({
              send: input.sendCancellationEmail,
              details,
              emails,
            });
            if (email === "sent") {
              yield* recordCancellationEmail({ id: claimed.id, cancelledAt });
            }
            return {
              outcome: "cancelled",
              email,
              invoice: yield* deliverInvoiceNotices(invoiceRecording),
            };
          }
        ),
        restore: Effect.fn("ReservationAdministrationService.restore")(
          function* (input) {
            const restored = yield* restoration.restore(input);
            return {
              ...restored,
              invoice: yield* issueReplacementInvoice(input.reservationId),
            };
          }
        ),
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
      | AccountingDocumentSnapshots
      | DotyposService
      | InvoiceCancellationService
      | PaidFulfillmentQueueService
      | PaymentRefundService
      | ReservationInvoiceService
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
            ReservationInvitations.Live,
            Layer.provideMerge(
              Layer.provideMerge(
                WorkspaceEmailLayer,
                WorkspaceCheckoutNetworkDetailsService.Default
              ),
              CustomerEmailLocaleService.Live
            )
          )
        )
      ),
      WorkspaceReservationRepository.Default,
      WorkspaceDotyposLayer,
      WorkspaceFeatureFlagService.Default,
      InvoiceCancellationService.Live,
      PaidFulfillmentQueueService.Live,
      ReservationInvoiceService.Live,
      PaymentRefundService.Live,
      AccountingDocumentSnapshots.Default.pipe(
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
