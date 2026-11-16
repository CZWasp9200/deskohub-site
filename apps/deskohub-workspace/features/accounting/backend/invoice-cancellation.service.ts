import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import {
  invoices,
  type ReservationState,
  workspaceReservations,
} from "@/db/schema";
import type { InvoiceNumber } from "@/features/accounting/invoice";
import {
  InvoiceCancellationError,
  type InvoiceCancellationRecord,
  type InvoiceNoticeSummary,
  isCustomerCancellationNoticeOwed,
} from "@/features/accounting/invoice-cancellation";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { AdministrationActor } from "@/features/administrators/administration-source";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { AccountingStorage } from "./accounting-storage";
import { type Invoice, InvoiceRepository } from "./invoice.repository";
import {
  type InvoiceCancellationRecording,
  InvoiceCancellationRepository,
  type InvoiceNoticeClaim,
} from "./invoice-cancellation.repository";
import { InvoiceCancellationNotices } from "./invoice-cancellation-notices";
import { InvoiceEmailDeliveryRepository } from "./invoice-email-delivery.repository";

/**
 * What cancelling the invoice would do, read before any write. The
 * workflows recheck each fact under their locks.
 */
export interface InvoiceCancellationPlan {
  readonly invoice: {
    readonly id: InvoiceId;
    readonly invoiceNumber: InvoiceNumber;
    readonly reservationId: WorkspaceReservationId | null;
    /** Already cancelled: cancelling again changes nothing. */
    readonly cancelled: boolean;
  };
  /**
   * `owed` when the invoice email was ever accepted for the customer or is
   * being delivered to them: the customer then gets a cancellation notice.
   */
  readonly customerNotice: "owed" | "not_owed";
  /**
   * The billed reservation's part: `cancels_reservation` while it is live,
   * so the invoice is cancelled with it; `already_cancelled` (or `none` for
   * a manual invoice) cancels the invoice alone.
   */
  readonly reservation:
    | "none"
    | "cancels_reservation"
    | "already_cancelled"
    | "cancellation_in_progress";
}

/** A reservation invoice's cancellation, recorded with its reservation. */
export interface ReservationInvoiceRecording
  extends InvoiceCancellationRecording {
  readonly invoiceNumber: InvoiceNumber;
}

/** The cancellation an invoice workflow ended with. */
export interface InvoiceCancellationOutcome {
  readonly outcome: "cancelled" | "already_cancelled";
  readonly cancellation: InvoiceCancellationRecord;
}

type NoticeDelivery = {
  readonly changed: boolean;
  readonly notices: InvoiceNoticeSummary;
};

export interface IInvoiceCancellationService {
  readonly plan: (
    invoiceId: InvoiceId
  ) => Effect.Effect<InvoiceCancellationPlan, InvoiceCancellationError>;
  /** The plan for the reservation's live invoice; `null` without one. */
  readonly planForReservation: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<InvoiceCancellationPlan | null, InvoiceCancellationError>;
  /**
   * Cancels an invoice that bills no live reservation: a manual invoice, or
   * one whose reservation is already cancelled. A live reservation's invoice
   * is cancelled only with its reservation, so it fails
   * `reservation_confirmation_required`, or
   * `reservation_cancellation_in_progress` while that cancellation runs.
   * The notices are sent after the commit; a failed notice stays retryable.
   */
  readonly cancelStandalone: (input: {
    readonly invoiceId: InvoiceId;
    readonly actor: AdministrationActor;
    readonly confirmedCustomerNotice: boolean;
  }) => Effect.Effect<InvoiceCancellationOutcome, InvoiceCancellationError>;
  /**
   * Cancels the reservation's live invoice inside the caller's transaction,
   * which has just cancelled the reservation. `null` when it has none.
   */
  readonly recordForReservation: (input: {
    readonly reservationId: WorkspaceReservationId;
    readonly actor: AdministrationActor;
  }) => Effect.Effect<
    ReservationInvoiceRecording | null,
    InvoiceCancellationError,
    WorkspaceTransaction
  >;
  /**
   * Sends the notices a recording claimed. A failed notice is logged and
   * reported in the summary, never as a failure: the cancellation stands.
   */
  readonly deliverNotices: (
    recording: Pick<InvoiceCancellationRecording, "claims" | "record">
  ) => Effect.Effect<NoticeDelivery>;
  /**
   * Claims and sends every owed notice of a cancelled invoice that failed or
   * outlived its lease. Accepted notices are never sent again.
   */
  readonly retryNotices: (
    invoiceId: InvoiceId
  ) => Effect.Effect<NoticeDelivery, InvoiceCancellationError>;
}

export class InvoiceCancellationService extends Context.Service<
  InvoiceCancellationService,
  IInvoiceCancellationService
>()("@deskohub-workspace/accounting/InvoiceCancellationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
      const invoiceRepository = yield* InvoiceRepository;
      const deliveryLedger = yield* InvoiceEmailDeliveryRepository;
      const cancellations = yield* InvoiceCancellationRepository;
      const notices = yield* InvoiceCancellationNotices;

      const readReservationState = Effect.fn(
        "InvoiceCancellationService.readReservationState"
      )(function* (
        invoiceId: InvoiceId,
        reservationId: WorkspaceReservationId
      ) {
        const [row] = yield* db
          .select({ state: workspaceReservations.reservationState })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, reservationId))
          .limit(1)
          .pipe(Effect.mapError(persistenceFailed(invoiceId)));
        return row?.state ?? null;
      });

      const planFor = Effect.fn("InvoiceCancellationService.planFor")(
        function* (invoice: Invoice) {
          const statuses = yield* deliveryLedger
            .status([invoice.id])
            .pipe(Effect.mapError(persistenceFailed(invoice.id)));
          const reservationId =
            invoice.workspaceReservationId as WorkspaceReservationId | null;
          const reservationState = reservationId
            ? yield* readReservationState(invoice.id, reservationId)
            : null;
          return {
            invoice: {
              id: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              reservationId,
              cancelled: invoice.cancellation !== null,
            },
            customerNotice: toCustomerNotice(statuses.get(invoice.id)),
            reservation: toReservationPart(reservationId, reservationState),
          } satisfies InvoiceCancellationPlan;
        }
      );

      // Reading the invoice decrypts it, so an unreadable document stops a
      // workflow here, before anything is claimed or cancelled.
      const readFailed =
        (invoiceId: InvoiceId | null) =>
        (cause: { readonly _tag: string }): InvoiceCancellationError =>
          cause._tag === "AccountingRecordUnavailable"
            ? new InvoiceCancellationError({
                code: "document_unavailable",
                invoiceId,
                message: "The invoice document could not be read.",
                cause,
              })
            : persistenceFailed(invoiceId)(cause);

      const plan = Effect.fn("InvoiceCancellationService.plan")(function* (
        invoiceId: InvoiceId
      ) {
        const invoice = yield* invoiceRepository
          .findById(invoiceId)
          .pipe(Effect.mapError(readFailed(invoiceId)));
        if (!invoice) {
          return yield* new InvoiceCancellationError({
            code: "not_found",
            invoiceId,
            message: "The invoice does not exist.",
          });
        }
        return yield* planFor(invoice);
      });

      const planForReservation = Effect.fn(
        "InvoiceCancellationService.planForReservation"
      )(function* (reservationId: WorkspaceReservationId) {
        const invoice = yield* invoiceRepository
          .findLiveByReservationId(reservationId)
          .pipe(Effect.mapError(readFailed(null)));
        return invoice ? yield* planFor(invoice) : null;
      });

      const findCancellation = (invoiceId: InvoiceId) =>
        cancellations
          .find(invoiceId)
          .pipe(Effect.mapError(persistenceFailed(invoiceId)));

      const deliverNotices = Effect.fn(
        "InvoiceCancellationService.deliverNotices"
      )(function* ({
        claims,
        record,
      }: Pick<InvoiceCancellationRecording, "claims" | "record">) {
        if (claims.length === 0) {
          return { changed: false, notices: record.notices };
        }
        return yield* notices
          .deliver({ invoiceId: record.invoiceId, claims })
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning(
                "Invoice cancellation notice delivery needs attention",
                { cause, invoiceId: record.invoiceId }
              ).pipe(
                Effect.andThen(cancellations.find(record.invoiceId)),
                Effect.map((latest) => ({
                  changed: false,
                  notices: (latest ?? record).notices,
                })),
                Effect.orElseSucceed(() => ({
                  changed: false,
                  notices: { ...record.notices, needsAttention: true },
                }))
              )
            )
          );
      });

      const cancelStandalone = Effect.fn(
        "InvoiceCancellationService.cancelStandalone"
      )(function* (input: {
        readonly invoiceId: InvoiceId;
        readonly actor: AdministrationActor;
        readonly confirmedCustomerNotice: boolean;
      }) {
        const { invoiceId } = input;
        const recording = yield* transaction(
          Effect.gen(function* () {
            yield* requireNoLiveReservation(invoiceId);
            return yield* cancellations.record({
              invoiceId,
              cause: "invoice_cancellation",
              actor: input.actor,
              confirmedCustomerNotice: input.confirmedCustomerNotice,
            });
          })
        ).pipe(Effect.mapError(asCancellationError(invoiceId)));
        yield* deliverNotices(recording);
        return {
          outcome: recording.changed ? "cancelled" : "already_cancelled",
          cancellation:
            (yield* findCancellation(invoiceId)) ?? recording.record,
        } satisfies InvoiceCancellationOutcome;
      });

      /**
       * Locks the billed reservation, as reservation cancellation does before
       * it reaches the invoice, and refuses while it is live. An invoice that
       * is already cancelled passes, so a replay answers `already_cancelled`.
       */
      const requireNoLiveReservation = Effect.fn(
        "InvoiceCancellationService.requireNoLiveReservation"
      )(function* (invoiceId: InvoiceId) {
        const { db } = yield* WorkspaceTransaction;
        const [billed] = yield* db
          .select({ reservationId: invoices.workspaceReservationId })
          .from(invoices)
          .where(eq(invoices.id, invoiceId))
          .limit(1);
        if (!billed?.reservationId) return;
        const [reservation] = yield* db
          .select({ state: workspaceReservations.reservationState })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, billed.reservationId))
          .limit(1)
          .for("update");
        if (!reservation || reservation.state === "cancelled") return;
        if (yield* cancellations.find(invoiceId)) return;
        return yield* new InvoiceCancellationError(
          reservation.state === "cancelling"
            ? {
                code: "reservation_cancellation_in_progress",
                invoiceId,
                message:
                  "The invoice's reservation is being cancelled. Try again once that finishes.",
              }
            : {
                code: "reservation_confirmation_required",
                invoiceId,
                message:
                  "The invoice bills a live reservation, which must be cancelled with it.",
              }
        );
      });

      const recordForReservation = Effect.fn(
        "InvoiceCancellationService.recordForReservation"
      )(function* (input: {
        readonly reservationId: WorkspaceReservationId;
        readonly actor: AdministrationActor;
      }) {
        // Under the reservation's row lock, which the caller's completion
        // took, no invoice can be issued for it meanwhile.
        const live = yield* invoiceRepository
          .findLiveByReservationId(input.reservationId)
          .pipe(Effect.mapError(readFailed(null)));
        if (!live) return null;
        const recording = yield* cancellations
          .record({
            invoiceId: live.id,
            cause: "reservation_cancellation",
            actor: input.actor,
            // The operator confirmed the plan before the provider call; an
            // invoice email accepted since then still gets its notice, and
            // refusing now could not undo the provider's cancellation.
            confirmedCustomerNotice: true,
          })
          .pipe(Effect.mapError(asCancellationError(live.id)));
        return {
          ...recording,
          invoiceNumber: live.invoiceNumber,
        } satisfies ReservationInvoiceRecording;
      });

      const retryNotices = Effect.fn("InvoiceCancellationService.retryNotices")(
        function* (invoiceId: InvoiceId) {
          const record = yield* findCancellation(invoiceId);
          if (!record) {
            return yield* new InvoiceCancellationError({
              code: "not_found",
              invoiceId,
              message: "The invoice is not cancelled.",
            });
          }
          const claims: InvoiceNoticeClaim[] = [];
          for (const audience of ["customer", "internal"] as const) {
            const claim = yield* cancellations
              .claimNotice({ invoiceId, audience })
              .pipe(Effect.mapError(persistenceFailed(invoiceId)));
            if (claim) claims.push(claim);
          }
          return yield* deliverNotices({ claims, record });
        }
      );

      return {
        cancelStandalone,
        deliverNotices,
        plan,
        planForReservation,
        recordForReservation,
        retryNotices,
      } satisfies IInvoiceCancellationService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        AccountingStorage.Live,
        InvoiceEmailDeliveryRepository.Live,
        InvoiceCancellationNotices.Live
      )
    )
  );
}

const toCustomerNotice = (
  summary: Parameters<typeof isCustomerCancellationNoticeOwed>[0] | undefined
): InvoiceCancellationPlan["customerNotice"] =>
  summary && isCustomerCancellationNoticeOwed(summary) ? "owed" : "not_owed";

const toReservationPart = (
  reservationId: WorkspaceReservationId | null,
  state: ReservationState | null
): InvoiceCancellationPlan["reservation"] => {
  if (!reservationId) return "none";
  if (state === "cancelled" || state === null) return "already_cancelled";
  if (state === "cancelling") return "cancellation_in_progress";
  return "cancels_reservation";
};

const persistenceFailed =
  (invoiceId: InvoiceId | null) =>
  (cause: unknown): InvoiceCancellationError =>
    new InvoiceCancellationError({
      code: "persistence_failed",
      invoiceId,
      message: "The invoice cancellation could not be read or recorded.",
      cause,
    });

const asCancellationError =
  (invoiceId: InvoiceId) =>
  (cause: unknown): InvoiceCancellationError =>
    cause instanceof InvoiceCancellationError
      ? cause
      : persistenceFailed(invoiceId)(cause);
