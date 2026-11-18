import { Context, Effect, Layer } from "effect";
import type { InvoiceNoticeSummary } from "@/features/accounting/invoice-cancellation";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import { internalWorkspaceEmailRecipientFor } from "@/shared/backend/email/workspace-email-recipients";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import { AccountingDocumentSnapshots } from "./accounting-document-snapshots";
import { renderCorrectiveDocumentPdfFile } from "./corrective-document-pdf";
import { InvoiceRepository } from "./invoice.repository";
import {
  InvoiceCancellationRepository,
  type InvoiceNoticeClaim,
} from "./invoice-cancellation.repository";
import { renderInvoiceCancellationNoticeEmail } from "./invoice-cancellation-notice-email";
import {
  deliveryError,
  type InvoiceEmailDeliveryError,
  invoiceEmailDependencies,
  makeClaimedInvoiceEmailSender,
  resolveInvoiceEmailRecipient,
  settleDelivery,
} from "./invoice-email-sending";

export interface IInvoiceCancellationNotices {
  /**
   * Sends the cancellation notices claimed for the invoice, each with the
   * corrective document attached, and records each outcome on the notice
   * ledger. A failed notice stays retryable; it never undoes the
   * cancellation.
   */
  readonly deliver: (input: {
    readonly invoiceId: InvoiceId;
    readonly claims: readonly InvoiceNoticeClaim[];
  }) => Effect.Effect<
    { readonly changed: boolean; readonly notices: InvoiceNoticeSummary },
    InvoiceEmailDeliveryError
  >;
  /**
   * Claims and sends the customer's notice when the invoice is cancelled and
   * its original customer email was accepted after the cancellation was
   * recorded. Does nothing otherwise.
   */
  readonly ensureOwed: (
    invoiceId: InvoiceId
  ) => Effect.Effect<void, InvoiceEmailDeliveryError>;
}

/**
 * Cancellation notice delivery over the notice ledger: each claimed notice
 * goes through the email service with the corrective document attached.
 */
export class InvoiceCancellationNotices extends Context.Service<
  InvoiceCancellationNotices,
  IInvoiceCancellationNotices
>()("@deskohub-workspace/accounting/InvoiceCancellationNotices") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const cancellations = yield* InvoiceCancellationRepository;
      const invoices = yield* InvoiceRepository;
      const accountingSnapshots = yield* AccountingDocumentSnapshots;
      const send = yield* makeClaimedInvoiceEmailSender;

      const loadNotice = Effect.fn("InvoiceCancellationNotices.loadNotice")(
        function* (invoiceId: InvoiceId) {
          const invoice = yield* invoices.findById(invoiceId).pipe(
            Effect.mapError((cause) =>
              deliveryError({
                code: "invoice_load_failed",
                paymentAttemptId: invoiceId,
                message:
                  "Cancelled invoice could not be loaded for its notice.",
                cause,
              })
            )
          );
          const correctiveDocument = yield* cancellations
            .loadCorrectiveDocument(invoiceId)
            .pipe(
              Effect.mapError((cause) =>
                deliveryError({
                  code: "invoice_load_failed",
                  paymentAttemptId: invoiceId,
                  message:
                    "Corrective document could not be loaded for delivery.",
                  cause,
                })
              )
            );
          if (!(invoice && correctiveDocument)) {
            return yield* deliveryError({
              code: "invoice_load_failed",
              paymentAttemptId: invoiceId,
              message: "Only a cancelled invoice has a cancellation notice.",
            });
          }
          const recipient = yield* resolveInvoiceEmailRecipient(invoice).pipe(
            Effect.provideService(
              AccountingDocumentSnapshots,
              accountingSnapshots
            )
          );

          return {
            invoice,
            correctiveDocument,
            recipient,
            renderPdf: yield* Effect.cached(
              renderCorrectiveDocumentPdfFile(correctiveDocument).pipe(
                Effect.map((file) => file.bytes)
              )
            ),
          };
        }
      );

      /** A notice that never reached sending is released for the next attempt. */
      const releaseClaims = (input: {
        readonly invoiceId: InvoiceId;
        readonly claims: readonly InvoiceNoticeClaim[];
        readonly error: InvoiceEmailDeliveryError;
      }) =>
        Effect.forEach(
          input.claims,
          (claim) =>
            cancellations
              .markNoticeFailed({
                invoiceId: input.invoiceId,
                audience: claim.audience,
                attemptNumber: claim.attemptNumber,
                failureCode: "email_send_failed",
              })
              .pipe(
                // Each claim is released on its own; an unrecorded one is
                // reclaimable once its lease expires.
                Effect.catch((cause) =>
                  Effect.logWarning(
                    "Failed cancellation notice was not recorded",
                    {
                      cause: censorLogValue(cause),
                      invoiceId: input.invoiceId,
                      audience: claim.audience,
                      code: input.error.code,
                    }
                  )
                )
              ),
          { discard: true }
        );

      const loadSummary = (invoiceId: InvoiceId) =>
        cancellations.find(invoiceId).pipe(
          Effect.mapError((cause) =>
            deliveryError({
              code: "persistence_failed",
              paymentAttemptId: invoiceId,
              message: "Cancellation notice ledger could not be read.",
              cause,
            })
          ),
          Effect.flatMap((record) =>
            record
              ? Effect.succeed(record.notices)
              : deliveryError({
                  code: "invoice_load_failed",
                  paymentAttemptId: invoiceId,
                  message:
                    "Only a cancelled invoice has a cancellation notice.",
                })
          )
        );

      const deliver: IInvoiceCancellationNotices["deliver"] = Effect.fn(
        "InvoiceCancellationNotices.deliver"
      )(function* ({
        invoiceId,
        claims,
      }: {
        readonly invoiceId: InvoiceId;
        readonly claims: readonly InvoiceNoticeClaim[];
      }) {
        if (claims.length === 0) {
          return { changed: false, notices: yield* loadSummary(invoiceId) };
        }

        const notice = yield* loadNotice(invoiceId).pipe(
          Effect.tapError((error) =>
            releaseClaims({ invoiceId, claims, error })
          )
        );
        const results = yield* Effect.forEach(
          [...claims].sort(
            (left, right) =>
              audienceOrder[left.audience] - audienceOrder[right.audience]
          ),
          (claim) =>
            send({
              invoice: notice.invoice,
              audience: claim.audience,
              recipient:
                claim.audience === "customer"
                  ? { email: notice.recipient }
                  : internalWorkspaceEmailRecipientFor(notice.recipient),
              attachment: {
                fileName: `${notice.correctiveDocument.documentNumber}.pdf`,
                render: notice.renderPdf,
              },
              renderEmail: renderInvoiceCancellationNoticeEmail({
                invoice: notice.invoice,
                correctiveDocument: notice.correctiveDocument,
                audience: claim.audience,
              }),
              category: invoiceCancellationNoticeEmailCategory,
              source: "workspace-invoice-cancellation-notice",
              idempotencyKey: `workspace-invoice-cancellation-${claim.audience}-${invoiceId}`,
              ledger: {
                markAccepted: (accepted) =>
                  cancellations.markNoticeAccepted({
                    invoiceId,
                    audience: claim.audience,
                    attemptNumber: claim.attemptNumber,
                    ...accepted,
                  }),
                markFailed: (failureCode) =>
                  cancellations.markNoticeFailed({
                    invoiceId,
                    audience: claim.audience,
                    attemptNumber: claim.attemptNumber,
                    failureCode,
                  }),
              },
            }).pipe(
              settleDelivery,
              Effect.map((result) => ({ audience: claim.audience, result }))
            )
        );

        const failed = results.find(({ result }) => !result.success);
        if (failed && !failed.result.success) {
          const customerDelivered = results.some(
            ({ audience, result }) => audience === "customer" && result.success
          );
          const { error } = failed.result;
          return yield* failed.audience === "internal" && customerDelivered
            ? deliveryError({
                code: error.code,
                paymentAttemptId: error.paymentAttemptId,
                message: error.message,
                customerDelivered,
                cause: error,
              })
            : error;
        }
        return { changed: true, notices: yield* loadSummary(invoiceId) };
      });

      const ensureOwed: IInvoiceCancellationNotices["ensureOwed"] = Effect.fn(
        "InvoiceCancellationNotices.ensureOwed"
      )(function* (invoiceId: InvoiceId) {
        // The claim waits for a cancellation being recorded and is null when
        // the invoice isn't cancelled or the customer is owed nothing new.
        const claim = yield* cancellations
          .claimNotice({ invoiceId, audience: "customer" })
          .pipe(
            Effect.mapError((cause) =>
              deliveryError({
                code: "persistence_failed",
                paymentAttemptId: invoiceId,
                message: "Owed cancellation notice could not be claimed.",
                cause,
              })
            )
          );
        if (!claim) return;

        yield* deliver({ invoiceId, claims: [claim] });
      });

      return { deliver, ensureOwed } satisfies IInvoiceCancellationNotices;
    })
  );

  static Live = this.Default.pipe(Layer.provide(invoiceEmailDependencies()));
}

const invoiceCancellationNoticeEmailCategory =
  "workspace-invoice-cancellation-notice";

/** Customers hear first, so a staff-copy failure never delays their notice. */
const audienceOrder = { customer: 0, internal: 1 } as const;
