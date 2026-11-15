import { BigDecimal, Schema } from "effect";
import { accountingDocumentIdentitySchema } from "@/features/accounting/accounting-document-snapshot";
import {
  type InvoiceDocument,
  invoiceNumberSchema,
  invoiceSupplierSchema,
  storedInvoiceBuyerSchema,
} from "@/features/accounting/invoice";
import {
  type InvoiceCancellationCause,
  invoiceCancellationCauses,
} from "@/features/accounting/invoice-cancellation";
import { getInvoiceStatedLines } from "@/features/accounting/invoice-presentation";
import {
  getInvoiceSettlement,
  getInvoiceTotal,
} from "@/features/accounting/invoice-settlement";
import {
  type InvoiceId,
  invoiceIdSchema,
} from "@/features/accounting/manual-invoice";
import {
  type AdministrationActor,
  administrationSources,
} from "@/features/administrators/administration-source";
import {
  instantStringSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";

/** A corrective document's number in its own annual series, `WS-OD-YYYY-NNNNNN`. */
export const correctiveDocumentNumberSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^WS-OD-[0-9]{4}-[0-9]{6,}$/)),
  Schema.brand("CorrectiveDocumentNumber")
).annotate({
  identifier: "CorrectiveDocumentNumber",
  description: "Deskohub corrective document number.",
});

export type CorrectiveDocumentNumber =
  typeof correctiveDocumentNumberSchema.Type;

const decodeCorrectiveDocumentNumber = Schema.decodeUnknownSync(
  correctiveDocumentNumberSchema
);

export const formatCorrectiveDocumentNumber = (input: {
  readonly year: number;
  readonly sequence: number;
}): CorrectiveDocumentNumber => {
  if (
    !Number.isInteger(input.year) ||
    !Number.isInteger(input.sequence) ||
    input.sequence < 1
  ) {
    throw new RangeError(
      "Corrective document number components are outside their range."
    );
  }

  return decodeCorrectiveDocumentNumber(
    `WS-OD-${input.year}-${input.sequence.toString().padStart(6, "0")}`
  );
};

/**
 * Whether money goes back to the buyer: a paid invoice with a positive total
 * is refunded; an unpaid or non-positive one leaves nothing due.
 */
const correctiveDocumentSettlements = ["refund_due", "nothing_due"] as const;

/**
 * The immutable accounting record that cancels one issued invoice in full.
 * It copies the parties and lines of the cancelled document, never current
 * data, and negates every amount. Like the invoice document it is versionless
 * and decoded strictly.
 */
export const correctiveDocumentSchema = Schema.Struct({
  documentKind: Schema.Literal("invoice-cancellation"),
  documentNumber: correctiveDocumentNumberSchema,
  issuedAt: instantStringSchema,
  locale: accountingDocumentIdentitySchema.fields.locale,
  dotyposCustomerId: accountingDocumentIdentitySchema.fields.dotyposCustomerId,
  cause: Schema.Literals(invoiceCancellationCauses),
  correctedInvoice: Schema.Struct({
    invoiceId: invoiceIdSchema,
    invoiceNumber: invoiceNumberSchema,
    issuedAt: instantStringSchema,
  }),
  supplier: invoiceSupplierSchema,
  buyer: storedInvoiceBuyerSchema,
  currency: Schema.NonEmptyString,
  /** Each line of the cancelled invoice with its amount negated, exact decimal text. */
  lines: Schema.Array(
    Schema.Struct({
      description: Schema.NonEmptyString,
      amount: Schema.String,
    })
  ).check(Schema.isMinLength(1)),
  /** The cancelled invoice's total, negated, exact decimal text. */
  total: Schema.String,
  settlement: Schema.Literals(correctiveDocumentSettlements),
  provenance: Schema.Struct({
    source: Schema.Literals(administrationSources),
    /** The cancelling administrator's login email. */
    actor: Schema.NonEmptyString,
    system: Schema.Literal("deskohub-workspace"),
    generatedAt: instantStringSchema,
  }),
}).annotate({
  identifier: "CorrectiveDocument",
  description:
    "Immutable facts of a corrective document cancelling an issued invoice.",
});

export type CorrectiveDocument = typeof correctiveDocumentSchema.Type;

export const decodeCorrectiveDocument = Schema.decodeUnknownEffect(
  correctiveDocumentSchema,
  { onExcessProperty: "error" }
);

const negateDecimal = (amount: string) =>
  BigDecimal.format(BigDecimal.negate(BigDecimal.fromStringUnsafe(amount)));

/**
 * Builds the corrective document that cancels the issued invoice, issued at
 * the cancellation instant under its allocated number.
 */
export const makeCorrectiveDocument = (input: {
  readonly invoice: {
    readonly id: InvoiceId;
    readonly document: InvoiceDocument;
  };
  readonly cause: InvoiceCancellationCause;
  readonly actor: AdministrationActor;
  readonly documentNumber: CorrectiveDocumentNumber;
  readonly issuedAt: Temporal.Instant;
}): CorrectiveDocument => {
  const { document } = input.invoice;
  const total = getInvoiceTotal(document);
  const issuedAt = instantStringSchema.make(
    temporalInstantToIsoString(input.issuedAt)
  );
  const refunded =
    getInvoiceSettlement(document)._tag === "Paid" &&
    BigDecimal.isPositive(BigDecimal.fromStringUnsafe(total.amount));

  return {
    documentKind: "invoice-cancellation",
    documentNumber: input.documentNumber,
    issuedAt,
    locale: document.locale,
    dotyposCustomerId: document.dotyposCustomerId,
    cause: input.cause,
    correctedInvoice: {
      invoiceId: input.invoice.id,
      invoiceNumber: document.invoiceNumber,
      issuedAt: document.issuedAt,
    },
    supplier: document.supplier,
    buyer: document.buyer,
    currency: total.currency,
    lines: getInvoiceStatedLines(document).map((line) => ({
      description: line.description,
      amount: negateDecimal(line.amount),
    })),
    total: negateDecimal(total.amount),
    settlement: refunded ? "refund_due" : "nothing_due",
    provenance: {
      source: input.actor.source,
      actor: input.actor.administrator.email,
      system: "deskohub-workspace",
      generatedAt: issuedAt,
    },
  };
};
