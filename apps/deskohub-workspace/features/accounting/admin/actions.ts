"use server";

import {
  AdministrationInvoiceCancellationInput,
  AdministrationInvoiceCreateInput,
  AdministrationInvoiceId,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Match, Schema } from "effect";
import { AdministrationService } from "@/features/administration/administration.service";
import { administrationHref } from "@/features/administration/administration-href";
import { currentAdministrationProvenance } from "@/features/administration/administration-provenance";
import { customerSearchQuerySchema } from "@/features/administration/customer-search-query";
import { m } from "@/features/administration/i18n";
import { getReservationCancellationErrorMessage } from "@/features/administration/reservation-error-messages";
import { defineAdministrationAction } from "@/features/administrators/server/administration-request.server";
import type { WorkspaceActionFailureCopy } from "@/shared/backend/workspace-action";
import {
  type InvoiceAdministrationCancelResult,
  InvoiceAdministrationService,
} from "./invoice-administration.service";
import { readInvoiceCancellationPreview } from "./invoice-cancellation-preview";
import {
  getInvoiceArchiveErrorMessage,
  getInvoiceCancellationErrorMessage,
  getInvoiceCustomerErrorMessage,
} from "./invoice-display";

const strict = { errors: "all", onExcessProperty: "error" } as const;

const failureCopy: WorkspaceActionFailureCopy = {
  timeout: m.accountingActionTimedOut,
  unexpected: m.accountingActionFailedUnexpectedly,
};

const invoiceCreateInputSchema = Schema.toStandardSchemaV1(
  AdministrationInvoiceCreateInput,
  { parseOptions: strict }
);

const invoiceIdInputSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ invoiceId: AdministrationInvoiceId }),
  { parseOptions: strict }
);

const invoicePaths = (invoiceId: string) => [
  administrationHref("/[locale]/admin/invoices"),
  administrationHref("/[locale]/admin/invoices/[invoiceId]", { invoiceId }),
];

/** The reservation detail, whose cancellation shows the reservation's invoice. */
const reservationPaths = (reservationId: string | null) =>
  reservationId
    ? [
        administrationHref("/[locale]/admin/reservations/[reservationId]", {
          reservationId,
        }),
      ]
    : [];

const createInvoiceAction = defineAdministrationAction(
  {
    operation: "invoice-administration.create",
    failureCopy,
    schema: invoiceCreateInputSchema,
    logInput: false,
    fallback: m.accountingInvoiceCreateFailed,
    capabilities: InvoiceAdministrationService.Live,
    // The service messages stay English: the administration API forwards
    // them to `dhw`.
    publicFailure: (cause, locale) =>
      Match.value(cause).pipe(
        Match.tag("InvoiceAdministrationCustomerError", ({ reason }) =>
          getInvoiceCustomerErrorMessage(reason, locale)
        ),
        Match.tag("InvoiceAdministrationInProgressError", () =>
          m.accountingInvoiceCreateInProgress({}, { locale })
        ),
        Match.orElse(() => undefined)
      ),
    revalidates: (_input, { invoiceId }: { readonly invoiceId: string }) =>
      invoicePaths(invoiceId),
  },
  Effect.fn(function* (input) {
    const { actor, source } = yield* currentAdministrationProvenance;
    const administration = yield* InvoiceAdministrationService;
    return yield* administration.create(input, {
      source,
      administrator: actor,
    });
  })
);

const previewInvoiceAction = defineAdministrationAction(
  {
    operation: "invoice-administration.preview",
    failureCopy,
    schema: invoiceCreateInputSchema,
    logInput: false,
    fallback: m.accountingInvoiceFormPreviewError,
    capabilities: InvoiceAdministrationService.Live,
  },
  Effect.fn(function* (input) {
    const { actor, source } = yield* currentAdministrationProvenance;
    const administration = yield* InvoiceAdministrationService;
    const pdf = yield* administration.preview(input, {
      source,
      administrator: actor,
    });
    return {
      dataUrl: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
    };
  })
);

const searchCustomersAction = defineAdministrationAction(
  {
    operation: "invoice-administration.search-customers",
    failureCopy,
    schema: customerSearchQuerySchema,
    logInput: false,
    fallback: m.accountingInvoiceCustomerSearchUnavailable,
    capabilities: InvoiceAdministrationService.Live,
  },
  Effect.fn(function* (input) {
    const administration = yield* InvoiceAdministrationService;
    return yield* administration.searchCustomers(input.query);
  })
);

const retryInvoiceAction = defineAdministrationAction(
  {
    operation: "invoice-administration.retry-delivery",
    failureCopy,
    schema: invoiceIdInputSchema,
    fallback: m.accountingInvoiceRetryDeliveryError,
    capabilities: InvoiceAdministrationService.Live,
    revalidates: (
      { invoiceId },
      { reservationId }: { readonly reservationId: string | null }
    ) => [...invoicePaths(invoiceId), ...reservationPaths(reservationId)],
  },
  Effect.fn(function* (input) {
    const administration = yield* InvoiceAdministrationService;
    return yield* administration.retry(input.invoiceId);
  })
);

const invoiceCancellationInputSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    invoiceId: AdministrationInvoiceId,
    ...AdministrationInvoiceCancellationInput.fields,
  }),
  { parseOptions: strict }
);

const previewInvoiceCancellationAction = defineAdministrationAction(
  {
    operation: "invoice-administration.cancellation-preview",
    failureCopy,
    schema: invoiceIdInputSchema,
    fallback: m.accountingInvoiceCancelPreviewFailed,
    capabilities: Layer.mergeAll(
      InvoiceAdministrationService.Live,
      AdministrationService.Live
    ),
    publicFailure: (cause, locale) =>
      Match.value(cause).pipe(
        Match.tag("InvoiceAdministrationNotFoundError", () =>
          m.accountingInvoiceNotFound({}, { locale })
        ),
        Match.tag("InvoiceCancellationError", ({ code }) =>
          getInvoiceCancellationErrorMessage(code, locale)
        ),
        Match.orElse(() => undefined)
      ),
  },
  Effect.fn(function* ({ invoiceId }, { locale }) {
    return yield* readInvoiceCancellationPreview(invoiceId, locale);
  })
);

type CancelledReservation = NonNullable<
  InvoiceAdministrationCancelResult["reservation"]
>;

/** What the cancel dialog reports once the invoice is cancelled. */
type InvoiceCancellationActionResult = {
  readonly outcome: InvoiceAdministrationCancelResult["outcome"];
  readonly correctiveDocumentNumber: string;
  /** Set when the invoice's reservation was cancelled with it. */
  readonly reservationId: CancelledReservation["reservationId"] | null;
  readonly reservationEmail: CancelledReservation["email"] | null;
};

const cancelInvoiceAction = defineAdministrationAction(
  {
    operation: "invoice-administration.cancel",
    failureCopy,
    schema: invoiceCancellationInputSchema,
    fallback: m.accountingInvoiceCancelFailed,
    capabilities: InvoiceAdministrationService.Live,
    // The service messages stay English: the administration API forwards
    // them to `dhw`.
    publicFailure: (cause, locale) =>
      Match.value(cause).pipe(
        Match.tag("InvoiceAdministrationNotFoundError", () =>
          m.accountingInvoiceNotFound({}, { locale })
        ),
        Match.tag("InvoiceCancellationError", ({ code }) =>
          getInvoiceCancellationErrorMessage(code, locale)
        ),
        Match.tag("ReservationAdministrationError", ({ reason }) =>
          getReservationCancellationErrorMessage(reason, locale)
        ),
        Match.orElse(() => undefined)
      ),
    revalidates: (
      { invoiceId },
      { reservationId }: InvoiceCancellationActionResult
    ) => [...invoicePaths(invoiceId), ...reservationPaths(reservationId)],
  },
  Effect.fn(function* ({ invoiceId, ...confirmation }) {
    const { actor, source } = yield* currentAdministrationProvenance;
    const administration = yield* InvoiceAdministrationService;
    const result = yield* administration.cancel({
      ...confirmation,
      invoiceId,
      actor: { source, administrator: actor },
    });
    const outcome: InvoiceCancellationActionResult = {
      outcome: result.outcome,
      correctiveDocumentNumber: result.cancellation.correctiveDocumentNumber,
      reservationId: result.reservation?.reservationId ?? null,
      reservationEmail: result.reservation?.email ?? null,
    };
    return outcome;
  })
);

const archiveInvoiceAction = defineAdministrationAction(
  {
    operation: "invoice-administration.archive",
    failureCopy,
    schema: invoiceIdInputSchema,
    fallback: m.accountingInvoiceHideFailed,
    capabilities: InvoiceAdministrationService.Live,
    publicFailure: (cause, locale) =>
      Match.value(cause).pipe(
        Match.tag("InvoiceAdministrationNotFoundError", () =>
          m.accountingInvoiceNotFound({}, { locale })
        ),
        Match.tag("InvoiceArchiveError", ({ code }) =>
          getInvoiceArchiveErrorMessage(code, locale)
        ),
        Match.orElse(() => undefined)
      ),
    revalidates: ({ invoiceId }) => invoicePaths(invoiceId),
  },
  Effect.fn(function* ({ invoiceId }) {
    const { actor, source } = yield* currentAdministrationProvenance;
    const administration = yield* InvoiceAdministrationService;
    return yield* administration.archive({
      invoiceId,
      actor: { source, administrator: actor },
    });
  })
);

export const createAdministrationInvoice: typeof createInvoiceAction = async (
  ...args: Parameters<typeof createInvoiceAction>
) => {
  "use server";
  return await createInvoiceAction(...args);
};

export const previewAdministrationInvoice: typeof previewInvoiceAction = async (
  ...args: Parameters<typeof previewInvoiceAction>
) => {
  "use server";
  return await previewInvoiceAction(...args);
};

export const searchAdministrationInvoiceCustomers: typeof searchCustomersAction =
  async (...args: Parameters<typeof searchCustomersAction>) => {
    "use server";
    return await searchCustomersAction(...args);
  };

export const retryAdministrationInvoice: typeof retryInvoiceAction = async (
  ...args: Parameters<typeof retryInvoiceAction>
) => {
  "use server";
  return await retryInvoiceAction(...args);
};

export const previewAdministrationInvoiceCancellation: typeof previewInvoiceCancellationAction =
  async (...args: Parameters<typeof previewInvoiceCancellationAction>) => {
    "use server";
    return await previewInvoiceCancellationAction(...args);
  };

export const cancelAdministrationInvoice: typeof cancelInvoiceAction = async (
  ...args: Parameters<typeof cancelInvoiceAction>
) => {
  "use server";
  return await cancelInvoiceAction(...args);
};

export const archiveAdministrationInvoice: typeof archiveInvoiceAction = async (
  ...args: Parameters<typeof archiveInvoiceAction>
) => {
  "use server";
  return await archiveInvoiceAction(...args);
};
