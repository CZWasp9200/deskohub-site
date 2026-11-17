import {
  type DotyposConditionalWriteFailure,
  type DotyposCustomerId,
  DotyposService,
} from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Result } from "effect";
import type { AccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import {
  type InvoiceBuyerAddress,
  toDotyposCustomerBillingDetails,
} from "@/features/accounting/billing-identity";
import type { InvoiceBuyer } from "@/features/accounting/invoice";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { Locale } from "@/features/i18n";
import { openReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/stored-reservation-details.server";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import { getReservationInvoiceBuyer } from "@/features/reservation/reservation-billing";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { AccountingDocumentSnapshots } from "./accounting-document-snapshots";
import { AccountingStorage } from "./accounting-storage";
import {
  type IInvoiceRepository,
  InvoiceRepository,
  type InvoiceRepositoryError,
} from "./invoice.repository";
import { isFulfilledReservation } from "./invoice-eligibility";
import {
  type InvoiceEmailDeliveryError,
  InvoiceEmailDeliveryService,
} from "./invoice-email-delivery.service";
import type { AccountingRecordUnavailable } from "./sealed-accounting-json";

type ReservationInvoiceProcessingError =
  | AccountingRecordUnavailable
  | EffectDrizzleQueryError
  | DotyposConditionalWriteFailure
  | InvoiceEmailDeliveryError
  | InvoiceRepositoryError
  | WorkspaceReservationDetailsMalformedError;

class PostOrderInvoiceUnavailableError extends Data.TaggedError(
  "PostOrderInvoiceUnavailableError"
)<{ readonly message: string }> {}

export type PostOrderInvoiceState = "create" | "issued" | "unavailable";

interface PostOrderInvoiceAccess {
  readonly orderId: WorkspaceReservationId;
  readonly locale: Locale;
  readonly accessToken?: ReservationAccessToken;
}

type InvoiceIssueRequest = Parameters<IInvoiceRepository["issue"]>[0];

/** Where an issuance's buyer comes from, which decides what Dotypos holds. */
type InvoiceBuyerOrigin<E> =
  | {
      /**
       * The payment attempt's snapshot froze the buyer, so every issuance of
       * the attempt derives the same one and a lost race committed it too.
       */
      readonly kind: "frozen";
      /** The invoice exists, and Dotypos took this buyer before it was issued. */
      readonly issued: boolean;
    }
  | {
      /**
       * The customer submitted the buyer after payment. A concurrent
       * submission can commit another buyer, which Dotypos must then hold
       * once `acceptCommitted` accepts it.
       */
      readonly kind: "submitted";
      readonly acceptCommitted: (
        committed: InvoiceBuyer
      ) => Effect.Effect<void, E>;
    };

export interface IReservationInvoiceService {
  /**
   * Issues and delivers the invoice a fulfilled reservation's active payment
   * attempt froze; a reservation without an active attempt is skipped.
   */
  readonly issueAfterFulfillment: (input: {
    readonly reservationId: WorkspaceReservationId;
  }) => Effect.Effect<void, ReservationInvoiceProcessingError>;
  readonly getPostOrderState: (
    input: PostOrderInvoiceAccess
  ) => Effect.Effect<PostOrderInvoiceState, ReservationInvoiceProcessingError>;
  readonly createPostOrderInvoice: (
    input: PostOrderInvoiceAccess & { readonly address: InvoiceBuyerAddress }
  ) => Effect.Effect<
    {
      readonly status: "created" | "already-issued";
      readonly delivered: boolean;
    },
    ReservationInvoiceProcessingError | PostOrderInvoiceUnavailableError
  >;
  readonly resendPostOrderInvoice: (
    input: PostOrderInvoiceAccess
  ) => Effect.Effect<
    void,
    ReservationInvoiceProcessingError | PostOrderInvoiceUnavailableError
  >;
}

export class ReservationInvoiceService extends Context.Service<
  ReservationInvoiceService,
  IReservationInvoiceService
>()("ReservationInvoiceService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const accountingSnapshots = yield* AccountingDocumentSnapshots;
      const dotypos = yield* DotyposService;
      const invoiceDeliveries = yield* InvoiceEmailDeliveryService;
      const invoices = yield* InvoiceRepository;
      const reservations = yield* WorkspaceReservationRepository;

      const getPostOrderContext = Effect.fn(
        "ReservationInvoiceService.getPostOrderContext"
      )(function* (input: PostOrderInvoiceAccess) {
        if (!input.accessToken) return { state: "unavailable" as const };
        const authorized = yield* openReservationAccessToken({
          token: input.accessToken,
          orderId: input.orderId,
          locale: input.locale,
        }).pipe(Effect.result);
        if (Result.isFailure(authorized)) {
          return { state: "unavailable" as const };
        }

        const reservation = yield* reservations.findById(input.orderId);
        if (!isPostOrderInvoiceableReservation(reservation, input.locale)) {
          return { state: "unavailable" as const };
        }

        const paymentAttemptId = reservation.activePaymentAttemptId;
        const source = yield* accountingSnapshots.find(paymentAttemptId);
        if (!isDeliverableReservationSnapshot(source, reservation)) {
          return { state: "unavailable" as const };
        }

        const invoice =
          yield* invoices.findByPaymentAttemptId(paymentAttemptId);
        if (invoice) {
          return { state: "issued" as const, paymentAttemptId };
        }
        if (!isUnrequestedPersonalInvoice(reservation, source)) {
          return { state: "unavailable" as const };
        }

        return { state: "create" as const, paymentAttemptId, source };
      });

      /**
       * Issues the payment attempt's invoice. Dotypos takes the buyer before
       * the invoice commits it, so a failed PATCH stops issuance; after a lost
       * race it takes the committed buyer, when the origin allows one. The
       * caller delivers the issued invoice under its own policy.
       */
      const issueInvoice = Effect.fnUntraced(function* <E = never>(input: {
        readonly request: InvoiceIssueRequest;
        readonly dotyposCustomerId: DotyposCustomerId;
        readonly origin: InvoiceBuyerOrigin<E>;
      }) {
        const { request, origin } = input;
        const updateBilling = (buyer: InvoiceBuyer) =>
          dotypos.updateCustomerBillingDetails(
            input.dotyposCustomerId,
            toDotyposCustomerBillingDetails(buyer)
          );

        if (origin.kind === "submitted" || !origin.issued) {
          yield* updateBilling(request.buyer);
        }
        const issuance = yield* invoices.issue(request);
        if (origin.kind === "submitted" && !issuance.changed) {
          const committed = issuance.invoice.document.buyer;
          yield* origin.acceptCommitted(committed);
          yield* updateBilling(committed);
        }
        return issuance;
      });

      return ReservationInvoiceService.of({
        issueAfterFulfillment: Effect.fn(
          "ReservationInvoiceService.issueAfterFulfillment"
        )(function* ({ reservationId }) {
          const reservation = yield* reservations.findById(reservationId);
          const paymentAttemptId = reservation?.activePaymentAttemptId;
          if (!paymentAttemptId) {
            yield* Effect.logWarning(
              "Reservation invoice processing skipped: payment attempt missing",
              { workspaceReservationId: reservationId }
            );
            return;
          }

          const source = yield* accountingSnapshots.find(paymentAttemptId);
          if (!source?.billing) return;
          const buyer = getReservationInvoiceBuyer({
            billing: source.billing,
            customerName: source.buyer.legalName,
          });
          if (!buyer) return;

          const issued =
            yield* invoices.findByPaymentAttemptId(paymentAttemptId);
          yield* issueInvoice({
            request: { paymentAttemptId, buyer },
            dotyposCustomerId: source.dotyposCustomerId,
            origin: { kind: "frozen", issued: issued !== null },
          });
          yield* invoiceDeliveries.deliverByPaymentAttemptId({
            paymentAttemptId,
          });
        }),
        getPostOrderState: Effect.fn(
          "ReservationInvoiceService.getPostOrderState"
        )(function* (input) {
          return (yield* getPostOrderContext(input)).state;
        }),
        createPostOrderInvoice: Effect.fn(
          "ReservationInvoiceService.createPostOrderInvoice"
        )(function* (input) {
          const context = yield* getPostOrderContext(input);
          if (context.state === "issued") {
            return { status: "already-issued", delivered: true } as const;
          }
          if (context.state !== "create") {
            return yield* new PostOrderInvoiceUnavailableError({
              message: "Post-order invoice creation is unavailable.",
            });
          }

          const issuance = yield* issueInvoice({
            request: {
              paymentAttemptId: context.paymentAttemptId,
              buyer: {
                kind: "person",
                legalName: context.source.buyer.legalName,
                address: input.address,
              },
              provenance: { source: "post-order-link" },
            },
            dotyposCustomerId: context.source.dotyposCustomerId,
            origin: { kind: "submitted", acceptCommitted: requirePerson },
          });
          const delivered = yield* invoiceDeliveries
            .deliverByPaymentAttemptId({
              paymentAttemptId: context.paymentAttemptId,
            })
            .pipe(
              Effect.as(true),
              Effect.catchTag("InvoiceEmailDeliveryError", (error) =>
                Effect.succeed(error.customerDelivered === true)
              )
            );
          return {
            status: issuance.changed ? "created" : "already-issued",
            delivered,
          } as const;
        }),
        resendPostOrderInvoice: Effect.fn(
          "ReservationInvoiceService.resendPostOrderInvoice"
        )(function* (input) {
          const context = yield* getPostOrderContext(input);
          if (context.state !== "issued") {
            return yield* new PostOrderInvoiceUnavailableError({
              message: "Post-order invoice resend is unavailable.",
            });
          }
          yield* invoiceDeliveries.resendCustomerByPaymentAttemptId({
            paymentAttemptId: context.paymentAttemptId,
          });
        }),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        AccountingStorage.Live,
        WorkspaceDotyposLayer,
        WorkspaceReservationRepository.Live,
        InvoiceEmailDeliveryService.Live
      )
    ),
    Layer.orDie
  );
}

type PostOrderInvoiceableReservation = WorkspaceReservation & {
  readonly fulfilledAt: Temporal.Instant;
  readonly activePaymentAttemptId: PaymentAttemptId;
};

/** A paid, confirmed reservation in the page's locale whose access code was delivered. */
const isPostOrderInvoiceableReservation = (
  reservation: WorkspaceReservation | null,
  locale: Locale
): reservation is PostOrderInvoiceableReservation =>
  reservation !== null &&
  reservation.locale === locale &&
  reservation.paymentState === "paid" &&
  reservation.reservationState === "confirmed" &&
  isFulfilledReservation(reservation) &&
  Boolean(reservation.activePaymentAttemptId);

/** The reservation's own snapshot, with a frozen recipient to deliver to. */
const isDeliverableReservationSnapshot = (
  source: AccountingDocumentSnapshot | null,
  reservation: WorkspaceReservation
): source is AccountingDocumentSnapshot =>
  source !== null &&
  Boolean(source.delivery) &&
  source.workspaceReservationId === reservation.id &&
  source.dotyposCustomerId === reservation.dotyposCustomerId;

/**
 * A post-order request only submits a person, so the request it lost to
 * committed a person too; any other buyer is not this reservation's.
 */
const requirePerson = Effect.fnUntraced(function* (buyer: InvoiceBuyer) {
  if (buyer.kind !== "person") {
    return yield* new PostOrderInvoiceUnavailableError({
      message: "The issued invoice buyer does not match the reservation.",
    });
  }
});

/** A personal reservation that asked for no invoice when it was paid. */
const isUnrequestedPersonalInvoice = (
  reservation: WorkspaceReservation,
  source: AccountingDocumentSnapshot
) =>
  reservation.reservationPurpose === "personal" &&
  source.billing?.purpose === "personal" &&
  source.billing.invoice === "none" &&
  source.buyer.kind === "person";
