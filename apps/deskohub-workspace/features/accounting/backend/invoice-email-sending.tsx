import type {
  EmailDeliveryId,
  EmailMessage,
  EmailRecipient,
} from "@deskohub/email";
import {
  EmailConfigTag,
  type EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Data, Effect, Layer } from "effect";
import { env } from "@/env";
import { isManualInvoiceDocument } from "@/features/accounting/invoice";
import type { InvoiceEmailDeliveryFailureCode } from "@/features/accounting/invoice-email-delivery";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { WorkspaceEmailLayer } from "@/shared/backend/config/email.config";
import { workspaceEmailRecipient } from "@/shared/backend/email/workspace-email-recipients";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import { AccountingDocumentSnapshots } from "./accounting-document-snapshots";
import { AccountingStorage } from "./accounting-storage";
import type { CorrectiveDocumentPdfRenderingError } from "./corrective-document-pdf";
import type { Invoice } from "./invoice.repository";
import type { InvoicePdfRenderingError } from "./invoice-pdf";

export class InvoiceEmailDeliveryError extends Data.TaggedError(
  "InvoiceEmailDeliveryError"
)<{
  readonly code:
    | "delivery_recipient_unavailable"
    | "delivery_in_progress"
    | "email_delivery_failed"
    | "invoice_cancelled"
    | "invoice_load_failed"
    | "pdf_render_failed"
    | "persistence_failed";
  readonly paymentAttemptId: string;
  readonly message: string;
  readonly customerDelivered?: boolean;
  readonly cause?: unknown;
}> {}

export const deliveryError = (
  input: Omit<
    ConstructorParameters<typeof InvoiceEmailDeliveryError>[0],
    "cause"
  > & {
    readonly cause?: unknown;
  }
) =>
  new InvoiceEmailDeliveryError(
    input.cause === undefined
      ? input
      : { ...input, cause: censorLogValue(input.cause) }
  );

/** The reference an invoice email error names: its payment attempt, else the invoice. */
export const invoiceEmailLookupId = (
  invoice: Pick<Invoice, "id" | "paymentAttemptId">
) => invoice.paymentAttemptId ?? invoice.id;

/**
 * The customer address an invoice's emails go to: the frozen delivery target
 * of a reservation invoice's source snapshot, or the manual invoice's stored
 * delivery email. Never a client-provided address.
 */
export const resolveInvoiceEmailRecipient = Effect.fn(
  "resolveInvoiceEmailRecipient"
)(function* (invoice: Invoice) {
  if (isManualInvoiceDocument(invoice.document)) {
    return invoice.document.delivery.email;
  }

  if (!invoice.paymentAttemptId) {
    return yield* deliveryError({
      code: "invoice_load_failed",
      paymentAttemptId: invoice.id,
      message: "Reservation invoice payment reference is unavailable.",
    });
  }
  const paymentAttemptId = invoice.paymentAttemptId;
  const accountingSnapshots = yield* AccountingDocumentSnapshots;

  const source = yield* accountingSnapshots
    .find(paymentAttemptIdSchema.make(paymentAttemptId))
    .pipe(
      Effect.mapError((cause) =>
        deliveryError({
          code: "invoice_load_failed",
          paymentAttemptId,
          message: "Invoice source snapshot could not be loaded for delivery.",
          cause,
        })
      )
    );
  if (!source?.delivery) {
    return yield* deliveryError({
      code: "delivery_recipient_unavailable",
      paymentAttemptId,
      message: "Invoice delivery recipient is unavailable.",
    });
  }
  return source.delivery.email;
});

/** Where a claimed send records its outcome: the claim on its own ledger. */
interface ClaimedInvoiceEmailLedger {
  readonly markAccepted: (accepted: {
    readonly providerDeliveryId: EmailDeliveryId;
    readonly acceptedAt: Temporal.Instant;
  }) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly markFailed: (
    failureCode: InvoiceEmailDeliveryFailureCode
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
}

export interface ClaimedInvoiceEmail {
  readonly invoice: Pick<
    Invoice,
    "id" | "paymentAttemptId" | "workspaceReservationId"
  >;
  readonly audience: "customer" | "internal";
  readonly recipient: EmailRecipient;
  readonly attachment: {
    readonly fileName: string;
    readonly render: Effect.Effect<
      Uint8Array,
      CorrectiveDocumentPdfRenderingError | InvoicePdfRenderingError
    >;
  };
  readonly renderEmail: Effect.Effect<
    { readonly subject: string; readonly html: string; readonly text: string },
    EmailServiceError
  >;
  /** The provider tag; also the stable idempotency key's prefix. */
  readonly category: string;
  readonly source: string;
  readonly idempotencyKey: string;
  readonly ledger: ClaimedInvoiceEmailLedger;
}

/**
 * Sends claimed invoice emails: renders the attachment and the email, sends
 * through the email service, and records acceptance or failure on the
 * claim's ledger. A failure is recorded before it is returned, so the claim
 * is retryable at once. Original invoice emails and cancellation notices
 * share it; each brings its ledger, copy and idempotency key.
 */
export const makeClaimedInvoiceEmailSender = Effect.gen(function* () {
  const emailConfig = yield* EmailConfigTag;
  const emailService = yield* EmailServiceTag;

  return Effect.fn("ClaimedInvoiceEmailSender.send")(function* (
    input: ClaimedInvoiceEmail
  ) {
    const lookupId = invoiceEmailLookupId(input.invoice);
    const fail = (error: InvoiceEmailDeliveryError) =>
      input.ledger
        .markFailed(
          error.code === "pdf_render_failed"
            ? "pdf_render_failed"
            : "email_send_failed"
        )
        .pipe(
          Effect.mapError((cause) =>
            deliveryError({
              code: "persistence_failed",
              paymentAttemptId: lookupId,
              message: "Failed invoice email delivery was not recorded.",
              cause,
            })
          ),
          Effect.andThen(Effect.fail(error))
        );

    const { attachment, rendered } = yield* Effect.all({
      attachment: input.attachment.render.pipe(
        Effect.mapError((cause) =>
          deliveryError({
            code: "pdf_render_failed",
            paymentAttemptId: lookupId,
            message: "Invoice PDF could not be rendered for delivery.",
            cause,
          })
        )
      ),
      rendered: input.renderEmail.pipe(
        Effect.mapError((cause) =>
          deliveryError({
            code: "email_delivery_failed",
            paymentAttemptId: lookupId,
            message: "Invoice delivery email could not be rendered.",
            cause,
          })
        )
      ),
    }).pipe(Effect.catch(fail));

    const message: EmailMessage = {
      from: emailConfig.defaultFrom,
      to: input.recipient,
      replyTo: workspaceEmailRecipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: input.idempotencyKey,
      attachments: [
        {
          filename: input.attachment.fileName,
          content: Buffer.isBuffer(attachment)
            ? attachment
            : Buffer.from(attachment),
          contentType: "application/pdf",
        },
      ],
      tags: [input.category],
      metadata: {
        deploymentEnvironment: env.VERCEL_ENV,
        source: input.source,
        ...(input.invoice.workspaceReservationId && {
          workspaceReservationId: input.invoice.workspaceReservationId,
        }),
        invoiceId: input.invoice.id,
        audience: input.audience,
      },
    };

    const sendResult = yield* emailService.send(message).pipe(
      Effect.catch((cause) =>
        fail(
          deliveryError({
            code: "email_delivery_failed",
            paymentAttemptId: lookupId,
            message: "Invoice email delivery failed.",
            cause,
          })
        )
      )
    );

    yield* input.ledger
      .markAccepted({
        providerDeliveryId: sendResult.id,
        acceptedAt: Temporal.Now.instant(),
      })
      .pipe(
        Effect.mapError((cause) =>
          deliveryError({
            code: "persistence_failed",
            paymentAttemptId: lookupId,
            message: "Accepted invoice email delivery was not recorded.",
            cause,
          })
        )
      );
  });
});

/** Runs a delivery to its end and keeps its outcome, so a sibling still runs. */
export const settleDelivery = <A,>(
  effect: Effect.Effect<A, InvoiceEmailDeliveryError>
) =>
  effect.pipe(
    Effect.map((value) => ({ success: true as const, value })),
    Effect.catch((error) => Effect.succeed({ success: false as const, error }))
  );

/**
 * The storage and email layers invoice emails read through: issued invoices,
 * their source snapshots for the recipient, and the email service.
 */
export function invoiceEmailDependencies() {
  return Layer.merge(AccountingStorage.Live, WorkspaceEmailLayer);
}
