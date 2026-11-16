import type { EmailRecipient } from "@deskohub/email";
import { Context, Effect, Layer } from "effect";
import { internalWorkspaceEmailRecipientFor } from "@/shared/backend/email/workspace-email-recipients";
import { AccountingDocumentSnapshots } from "./accounting-document-snapshots";
import { type Invoice, InvoiceRepository } from "./invoice.repository";
import { InvoiceCancellationNotices } from "./invoice-cancellation-notices";
import { renderInvoiceDeliveryEmail } from "./invoice-delivery-email";
import { InvoiceEmailDeliveryRepository } from "./invoice-email-delivery.repository";
import {
  deliveryError,
  InvoiceEmailDeliveryError,
  invoiceEmailDependencies,
  invoiceEmailLookupId,
  makeClaimedInvoiceEmailSender,
  resolveInvoiceEmailRecipient,
  settleDelivery,
} from "./invoice-email-sending";
import { type InvoicePdfRenderingError, renderInvoicePdf } from "./invoice-pdf";

export { InvoiceEmailDeliveryError };

const invoiceCustomerEmailCategory = "workspace-invoice-customer";
const invoiceInternalEmailCategory = "workspace-invoice-internal";

/**
 * `cancelled`: the invoice is cancelled, so its original email is never sent
 * again; its cancellation notice replaces it.
 */
export type InvoiceEmailDeliveryResult =
  | { readonly status: "not_issued" }
  | { readonly status: "cancelled" }
  | { readonly status: "delivered"; readonly changed: boolean };

/** A cancelled invoice's original email is never sent, resent or retried. */
const isOriginalDeliveryBlocked = (invoice: Pick<Invoice, "cancellation">) =>
  invoice.cancellation !== null;

export interface IInvoiceEmailDeliveryService {
  readonly deliverByInvoiceId: (input: {
    readonly invoiceId: string;
  }) => Effect.Effect<InvoiceEmailDeliveryResult, InvoiceEmailDeliveryError>;
  readonly deliverByPaymentAttemptId: (input: {
    readonly paymentAttemptId: string;
  }) => Effect.Effect<InvoiceEmailDeliveryResult, InvoiceEmailDeliveryError>;
  readonly resendCustomerByPaymentAttemptId: (input: {
    readonly paymentAttemptId: string;
  }) => Effect.Effect<InvoiceEmailDeliveryResult, InvoiceEmailDeliveryError>;
}

export class InvoiceEmailDeliveryService extends Context.Service<
  InvoiceEmailDeliveryService,
  IInvoiceEmailDeliveryService
>()("@deskohub-workspace/accounting/InvoiceEmailDeliveryService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const accountingSnapshots = yield* AccountingDocumentSnapshots;
      const deliveries = yield* InvoiceEmailDeliveryRepository;
      const invoices = yield* InvoiceRepository;
      const notices = yield* InvoiceCancellationNotices;
      const send = yield* makeClaimedInvoiceEmailSender;

      const deliverAudience = Effect.fn(
        "InvoiceEmailDeliveryService.deliverAudience"
      )(function* (input: {
        readonly invoice: Invoice;
        readonly audience: "customer" | "internal";
        readonly recipient: EmailRecipient;
        readonly renderPdf: Effect.Effect<Buffer, InvoicePdfRenderingError>;
        readonly resend?: boolean;
      }) {
        const claim = yield* (
          input.resend
            ? deliveries.claimResend({ invoiceId: input.invoice.id })
            : deliveries.claim({
                invoiceId: input.invoice.id,
                audience: input.audience,
              })
        ).pipe(
          Effect.mapError((cause) =>
            deliveryError({
              code: "persistence_failed",
              paymentAttemptId: invoiceEmailLookupId(input.invoice),
              message: "Invoice email delivery could not be claimed.",
              cause,
            })
          )
        );

        if (claim === "cancelled") {
          return yield* deliveryError({
            code: "invoice_cancelled",
            paymentAttemptId: invoiceEmailLookupId(input.invoice),
            message: "The invoice was cancelled before its email was sent.",
          });
        }
        if (!claim) return false;

        const category = {
          customer: invoiceCustomerEmailCategory,
          internal: invoiceInternalEmailCategory,
        }[input.audience];
        const claimed = {
          invoiceId: input.invoice.id,
          audience: input.audience,
          attemptNumber: claim.attemptNumber,
        };
        yield* send({
          invoice: input.invoice,
          audience: input.audience,
          recipient: input.recipient,
          attachment: {
            fileName: `${input.invoice.invoiceNumber}.pdf`,
            render: input.renderPdf,
          },
          renderEmail: renderInvoiceDeliveryEmail({
            invoice: input.invoice,
            audience: input.audience,
          }),
          category,
          source: "workspace-invoice-delivery",
          idempotencyKey: input.resend
            ? `workspace-invoice-customer-resend-${input.invoice.id}-${claim.attemptNumber}`
            : `${category}-${input.invoice.id}`,
          ledger: {
            markAccepted: (accepted) =>
              deliveries.markAccepted({ ...claimed, ...accepted }),
            markFailed: (failureCode) =>
              deliveries.markFailed({ ...claimed, failureCode }),
          },
        });

        if (input.audience === "customer") {
          // A cancellation recorded while this email was in flight could not
          // owe the customer a notice yet; now that the invoice reached them,
          // it does. The accepted email stays delivered either way.
          yield* notices.ensureOwed(input.invoice.id).pipe(
            Effect.catch((error) =>
              Effect.logWarning("Owed cancellation notice was not sent", {
                invoiceId: input.invoice.id,
                code: error.code,
              })
            )
          );
        }

        return true;
      });

      const loadDelivery = Effect.fn(
        "InvoiceEmailDeliveryService.loadDelivery"
      )(function* (paymentAttemptId: string) {
        const invoice = yield* invoices
          .findLatestByPaymentAttemptId(paymentAttemptId)
          .pipe(
            Effect.mapError((cause) =>
              deliveryError({
                code: "invoice_load_failed",
                paymentAttemptId,
                message: "Issued invoice could not be loaded for delivery.",
                cause,
              })
            )
          );
        if (!invoice) return null;
        if (isOriginalDeliveryBlocked(invoice)) return "cancelled" as const;

        return yield* loadInvoiceDelivery(invoice);
      });

      const loadInvoiceDelivery = Effect.fn(
        "InvoiceEmailDeliveryService.loadInvoiceDelivery"
      )(function* (invoice: Invoice) {
        return {
          invoice,
          recipient: yield* resolveInvoiceEmailRecipient(invoice).pipe(
            Effect.provideService(
              AccountingDocumentSnapshots,
              accountingSnapshots
            )
          ),
          renderPdf: yield* Effect.cached(renderInvoicePdf(invoice.document)),
        };
      });

      const deliverLoaded = Effect.fn(
        "InvoiceEmailDeliveryService.deliverLoaded"
      )(function* (
        delivery: NonNullable<
          Effect.Success<ReturnType<typeof loadInvoiceDelivery>>
        >
      ) {
        const customer = yield* deliverAudience({
          invoice: delivery.invoice,
          audience: "customer",
          recipient: { email: delivery.recipient },
          renderPdf: delivery.renderPdf,
        }).pipe(settleDelivery);
        const internal = yield* deliverAudience({
          invoice: delivery.invoice,
          audience: "internal",
          recipient: internalWorkspaceEmailRecipientFor(delivery.recipient),
          renderPdf: delivery.renderPdf,
        }).pipe(settleDelivery);

        if (!customer.success) return yield* customer.error;
        if (!internal.success) {
          return yield* deliveryError({
            code: internal.error.code,
            paymentAttemptId:
              delivery.invoice.paymentAttemptId ?? delivery.invoice.id,
            message: internal.error.message,
            customerDelivered: customer.value,
            cause: internal.error,
          });
        }
        return {
          status: "delivered",
          changed: customer.value || internal.value,
        } as const;
      });

      const deliverByInvoiceId = Effect.fn(
        "InvoiceEmailDeliveryService.deliverByInvoiceId"
      )(function* ({ invoiceId }: { readonly invoiceId: string }) {
        const invoice = yield* invoices.findById(invoiceId).pipe(
          Effect.mapError((cause) =>
            deliveryError({
              code: "invoice_load_failed",
              paymentAttemptId: invoiceId,
              message: "Issued invoice could not be loaded for delivery.",
              cause,
            })
          )
        );
        if (!invoice) return { status: "not_issued" } as const;
        if (isOriginalDeliveryBlocked(invoice)) {
          return { status: "cancelled" } as const;
        }
        return yield* loadInvoiceDelivery(invoice).pipe(
          Effect.flatMap(deliverLoaded)
        );
      });

      return {
        deliverByInvoiceId,
        deliverByPaymentAttemptId: Effect.fn(
          "InvoiceEmailDeliveryService.deliverByPaymentAttemptId"
        )(function* ({ paymentAttemptId }) {
          const delivery = yield* loadDelivery(paymentAttemptId);
          if (!delivery) return { status: "not_issued" } as const;
          if (delivery === "cancelled") return { status: "cancelled" } as const;
          return yield* deliverLoaded(delivery);
        }),
        resendCustomerByPaymentAttemptId: Effect.fn(
          "InvoiceEmailDeliveryService.resendCustomerByPaymentAttemptId"
        )(function* ({ paymentAttemptId }) {
          const delivery = yield* loadDelivery(paymentAttemptId);
          if (!delivery) return { status: "not_issued" } as const;
          if (delivery === "cancelled") return { status: "cancelled" } as const;

          const changed = yield* deliverAudience({
            invoice: delivery.invoice,
            audience: "customer",
            recipient: { email: delivery.recipient },
            renderPdf: delivery.renderPdf,
            resend: true,
          });
          if (!changed) {
            return yield* deliveryError({
              code: "delivery_in_progress",
              paymentAttemptId,
              message: "Another invoice email delivery is already in progress.",
            });
          }
          return { status: "delivered", changed } as const;
        }),
      } satisfies IInvoiceEmailDeliveryService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        invoiceEmailDependencies(),
        InvoiceEmailDeliveryRepository.Live,
        InvoiceCancellationNotices.Live
      )
    )
  );
}
