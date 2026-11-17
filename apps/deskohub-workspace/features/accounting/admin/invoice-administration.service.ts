import {
  type DotyposCustomer,
  type DotyposCustomerDetails,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { parsePhoneNumber } from "@deskohub/phone-number";
import type {
  AdministrationDotyposCustomerIdType,
  AdministrationInvoiceCreateInputType,
  AdministrationInvoiceCustomerDetailsType,
  AdministrationInvoiceIdType,
  AdministrationInvoicePaymentStatusType,
  AdministrationWorkspaceReservationIdType,
} from "@deskohub/workspace-admin-api";
import {
  AdministrationDotyposCustomerId,
  AdministrationInvoiceId,
  AdministrationWorkspaceReservationId,
} from "@deskohub/workspace-admin-api";
import {
  BigDecimal,
  Context,
  Data,
  DateTime,
  Effect,
  Layer,
  Match,
  Option,
  Schema,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceLocks } from "@/db/workspace-locks";
import { toDotyposCustomerBillingDetails } from "@/features/accounting/billing-identity";
import {
  type InvoiceBuyer,
  invoiceBuyerSchema,
  invoiceNumberSchema,
  isManualInvoiceDocument,
  makeManualInvoiceDocument,
} from "@/features/accounting/invoice";
import { InvoiceArchiveError } from "@/features/accounting/invoice-archive";
import {
  type InvoiceCancellationCause,
  InvoiceCancellationError,
  type InvoiceCancellationRecord,
  type InvoiceNoticeSummary,
} from "@/features/accounting/invoice-cancellation";
import type {
  InvoiceDeliveryStatus,
  InvoiceDeliverySummary,
} from "@/features/accounting/invoice-email-delivery";
import { getInvoicePresentation } from "@/features/accounting/invoice-presentation";
import {
  getInvoicePaymentStatus,
  getInvoiceSettlement,
  getInvoiceTotal,
  type InvoiceSettlement,
} from "@/features/accounting/invoice-settlement";
import {
  type InvoiceId,
  invoiceEnabledCurrencyDefinitions,
  invoiceIdSchema,
  invoiceVariableSymbolSchema,
  isInvoiceCurrencyPayable,
  type ManualInvoiceIssuer,
  type ManualInvoiceProvenance,
  normalizeManualInvoiceInput,
  normalizeManualInvoiceLines,
  toManualInvoiceProvenance,
} from "@/features/accounting/manual-invoice";
import {
  type AdministrationHref,
  administrationHref,
} from "@/features/administration/administration-href";
import { AdministrationCustomerDirectory } from "@/features/administration/customer-directory.service";
import {
  describeAdministrationCustomer,
  isFindableAdministrationCustomer,
} from "@/features/administration/customer-identity";
import type { AdministrationCustomerName } from "@/features/administration/customer-name";
import { getAdministrationPagination } from "@/features/administration/listing";
import { ReservationAdministrationService } from "@/features/administration/reservation-administration.service";
import type {
  AdministrationActor,
  AdministrationSource,
} from "@/features/administrators/administration-source";
import { baseLocale, defaultPhoneRegion, type Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  defaultWorkspaceCurrencyCode,
  findWorkspaceCurrencyDefinition,
} from "@/shared/money/currencies";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  currentPlainDate,
  type PlainDate,
  plainDateStringSchema,
  temporalInstantToPlainDate,
} from "@/shared/utils/temporal";
import { AccountingStorage } from "../backend/accounting-storage";
import { renderCorrectiveDocumentPdfFile } from "../backend/corrective-document-pdf";
import {
  type Invoice,
  InvoiceRepository,
  type UnreadableInvoice,
} from "../backend/invoice.repository";
import { InvoiceArchiveRepository } from "../backend/invoice-archive.repository";
import { InvoiceCancellationRepository } from "../backend/invoice-cancellation.repository";
import {
  type InvoiceCancellationOutcome,
  type InvoiceCancellationPlan,
  InvoiceCancellationService,
} from "../backend/invoice-cancellation.service";
import { InvoiceEmailDeliveryRepository } from "../backend/invoice-email-delivery.repository";
import { InvoiceEmailDeliveryService } from "../backend/invoice-email-delivery.service";
import { renderInvoicePdf, renderInvoicePdfFile } from "../backend/invoice-pdf";
import {
  decodeInvoiceAdministrationId,
  InvoiceAdministrationNotFoundError,
} from "./invoice-administration-identifier";
import { isUnreadableInvoiceListEntry } from "./invoice-list-entry";
import {
  ManualInvoiceCreationRequestError,
  ManualInvoiceCreationRequests,
} from "./manual-invoice-creation-requests.service";

export type InvoiceAdministrationListQuery = {
  readonly sort?:
    | "invoiceNumber"
    | "issuedAt"
    | "customer"
    | "total"
    | "paymentStatus"
    | "source"
    | "delivery";
  readonly direction?: "asc" | "desc";
  readonly page?: number;
  /** Also list archived invoices; the Admin UI never does. */
  readonly includeArchived?: boolean;
};

/**
 * Whether a single-invoice read serves an archived invoice. The Admin UI
 * reads with `false`, so an archived invoice is the admin 404 there; the
 * administration API, `dhw` and agent tools read with `true`.
 */
type InvoiceAdministrationReadScope = {
  readonly includeArchived: boolean;
};

type InvoiceAdministrationPage<
  Item extends InvoiceAdministrationListEntry = InvoiceAdministrationListItem,
> = {
  readonly items: readonly Item[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
};

type InvoiceAdministrationDelivery = Readonly<
  Record<"customer" | "internal", InvoiceDeliveryStatus>
>;

type InvoiceAdministrationSource =
  | "reservation-request"
  | "post-order-link"
  | "admin-ui"
  | "dhw-cli"
  | "assistant"
  | "legacy";

export type InvoiceAdministrationListItem = {
  readonly id: AdministrationInvoiceIdType;
  readonly invoiceNumber: string;
  readonly issuedAt: string;
  readonly customerId: AdministrationDotyposCustomerIdType;
  readonly customerName: string;
  readonly reservationId: AdministrationWorkspaceReservationIdType | null;
  readonly total: string;
  readonly currency: string;
  readonly paymentStatus: AdministrationInvoicePaymentStatusType;
  readonly source: InvoiceAdministrationSource;
  readonly actor: string | null;
  readonly delivery: InvoiceAdministrationDelivery;
  readonly needsAttention: boolean;
  /** `null` while the invoice is live. */
  readonly cancellation: InvoiceAdministrationCancellation | null;
  /** When the cancelled invoice was hidden from the Admin UI. */
  readonly archivedAt: string | null;
  readonly replacesInvoiceId: AdministrationInvoiceIdType | null;
  readonly replacedByInvoiceId: AdministrationInvoiceIdType | null;
};

/**
 * An invoice whose document could not be read, listed only from its
 * unencrypted columns: it has no customer, total, payment status, source or
 * delivery, and offers no action that needs the document.
 */
export type InvoiceAdministrationUnreadableListItem = {
  readonly documentUnavailable: true;
  readonly id: AdministrationInvoiceIdType;
  readonly invoiceNumber: string;
  readonly issuedAt: string;
  /** When the invoice was cancelled; `null` while it is live. */
  readonly cancelledAt: string | null;
  readonly archivedAt: string | null;
  readonly replacesInvoiceId: AdministrationInvoiceIdType | null;
  readonly replacedByInvoiceId: AdministrationInvoiceIdType | null;
};

/** A row of the Admin UI's invoice list. */
export type InvoiceAdministrationListEntry =
  | InvoiceAdministrationListItem
  | InvoiceAdministrationUnreadableListItem;

/** Who cancelled the invoice, when, how and why, and its corrective document. */
export type InvoiceAdministrationCancellation = {
  readonly cancelledAt: string;
  readonly cause: InvoiceCancellationCause;
  readonly source: AdministrationSource;
  /** The administrator's login email when they cancelled. */
  readonly actor: string;
  readonly correctiveDocumentNumber: string;
  readonly correctiveDocumentIssuedAt: string;
  readonly correctiveDocumentPdfUrl: AdministrationHref;
  readonly notices: InvoiceNoticeSummary;
};

/** What cancelling the live invoice would do: the confirmation's warnings. */
export type InvoiceAdministrationCancellationPlan = Pick<
  InvoiceCancellationPlan,
  "customerNotice" | "reservation"
>;

export type InvoiceAdministrationDetail = InvoiceAdministrationListItem & {
  /** `null` once the invoice is cancelled. */
  readonly cancellationPlan: InvoiceAdministrationCancellationPlan | null;
  readonly locale: Locale;
  readonly serviceDate: string | null;
  readonly dueDate: string | null;
  readonly paidOn: string | null;
  readonly variableSymbol: string | null;
  readonly lines: readonly {
    readonly description: string;
    readonly price: string;
  }[];
  readonly buyer: InvoiceBuyer;
  readonly pdfUrl: AdministrationHref;
  /** For the Admin UI; the administration API contract does not carry it. */
  readonly settlement: InvoiceSettlement;
};

export type InvoiceAdministrationCustomer = AdministrationCustomerName & {
  readonly id: string;
  readonly email: string | null;
  readonly details: AdministrationInvoiceCustomerDetailsType;
};

type InvoiceAdministrationCreateResult = {
  readonly invoiceId: AdministrationInvoiceIdType;
  readonly invoiceNumber: string;
  readonly changed: boolean;
  readonly needsAttention: boolean;
};

type InvoiceAdministrationRetryResult = {
  readonly invoiceId: AdministrationInvoiceIdType;
  readonly changed: boolean;
  readonly needsAttention: boolean;
  /** A cancelled invoice's notices, which were retried instead of its email. */
  readonly notices: InvoiceNoticeSummary | null;
  /**
   * The reservation the invoice bills, whose cancellation shows the notice a
   * delivered invoice email owes. For the Admin UI; the administration API
   * contract does not carry it.
   */
  readonly reservationId: AdministrationWorkspaceReservationIdType | null;
};

type InvoiceAdministrationCancelInput = {
  readonly invoiceId: string;
  readonly actor: AdministrationActor;
  /** The operator saw that the customer will be emailed a cancellation notice. */
  readonly confirmedCustomerNotice: boolean;
  /**
   * The reservation cancellation the operator confirmed, required when the
   * invoice bills a live reservation: both are cancelled together.
   */
  readonly reservation?: {
    readonly sendCancellationEmail: boolean;
  };
};

export type InvoiceAdministrationCancelResult = {
  readonly invoiceId: AdministrationInvoiceIdType;
  readonly outcome: "cancelled" | "already_cancelled";
  readonly cancellation: InvoiceAdministrationCancellation;
  /** Set when the invoice's reservation was cancelled with it. */
  readonly reservation: {
    readonly reservationId: AdministrationWorkspaceReservationIdType;
    readonly outcome: "cancelled" | "already_cancelled";
    readonly email: "not_requested" | "sent" | "failed";
  } | null;
};

type InvoiceAdministrationArchiveResult = {
  readonly invoiceId: AdministrationInvoiceIdType;
  readonly archivedAt: string;
  /** False when the invoice was already archived. */
  readonly changed: boolean;
};

export type InvoiceAdministrationCustomerErrorReason =
  | "billing-details-invalid"
  | "currency-not-payable"
  | "customer-deleted"
  | "customer-email-ambiguous"
  | "customer-id-invalid"
  | "customer-id-missing"
  | "invoice-id-reused";

class InvoiceAdministrationCustomerError extends Data.TaggedError(
  "InvoiceAdministrationCustomerError"
)<{
  readonly reason: InvoiceAdministrationCustomerErrorReason;
  readonly message: string;
}> {}

export class InvoiceAdministrationInProgressError extends Data.TaggedError(
  "InvoiceAdministrationInProgressError"
)<{
  readonly invoiceId: AdministrationInvoiceIdType;
  readonly message: string;
}> {}

type ManualInvoiceCreationClaim = Effect.Success<
  ReturnType<ManualInvoiceCreationRequests["Service"]["claim"]>
>;

const makeInvoiceAdministrationService = Effect.gen(function* () {
  const { transaction } = yield* WorkspaceDatabase;
  const invoices = yield* InvoiceRepository;
  const deliveries = yield* InvoiceEmailDeliveryService;
  const deliveryLedger = yield* InvoiceEmailDeliveryRepository;
  const dotypos = yield* DotyposService;
  const customerDirectory = yield* AdministrationCustomerDirectory;
  const creationRequests = yield* ManualInvoiceCreationRequests;
  const cancellation = yield* InvoiceCancellationService;
  const cancellationRecords = yield* InvoiceCancellationRepository;
  const archives = yield* InvoiceArchiveRepository;
  const reservationAdministration = yield* ReservationAdministrationService;

  const prepare = Effect.fn("InvoiceAdministrationService.prepare")(function* (
    input: AdministrationInvoiceCreateInputType,
    issuer: ManualInvoiceIssuer
  ) {
    const provenance = toManualInvoiceProvenance(issuer);
    const currency = findWorkspaceCurrencyDefinition(input.currency);
    if (!currency || !isInvoiceCurrencyPayable(currency.code)) {
      return yield* new InvoiceAdministrationCustomerError({
        reason: "currency-not-payable",
        message: "No receiving account is configured for the invoice currency.",
      });
    }
    const buyer = yield* toBuyer(input.customer.details);
    yield* normalizeManualInvoiceLines({
      currency: currency.code,
      lines: input.lines,
    });
    const invoiceId = invoiceIdSchema.make(input.invoiceId);
    return {
      invoiceId,
      provenance,
      buyer,
      forCustomer: (dotyposCustomerId: DotyposCustomerId) => ({
        invoiceId,
        dotyposCustomerId,
        buyer,
        deliveryEmail: input.customer.details.email,
        locale: input.locale,
        serviceDate: plainDateStringSchema.make(input.serviceDate),
        payment: {
          ...input.payment,
          date: plainDateStringSchema.make(input.payment.date),
        },
        currency: currency.code,
        ...(input.variableSymbol && {
          variableSymbol: invoiceVariableSymbolSchema.make(
            input.variableSymbol
          ),
        }),
        lines: input.lines,
        provenance,
      }),
    };
  });

  /** The invoices with their delivery and cancellation standing, as the list shows them. */
  const toListItems = (stored: readonly Invoice[]) => {
    const ids = stored.map(({ id }) => id);
    return Effect.all([
      deliveryLedger.status(ids),
      cancellationRecords.findMany(
        stored.flatMap(({ cancellation, id }) => (cancellation ? [id] : []))
      ),
      currentPragueDate,
    ]).pipe(
      Effect.map(([statuses, cancellations, today]) =>
        stored.map((invoice) =>
          toListItem(
            invoice,
            statuses.get(invoice.id)!,
            cancellations.get(invoice.id) ?? null,
            today
          )
        )
      )
    );
  };

  /** Strict: an invoice whose document cannot be read fails the listing. */
  const list = Effect.fn("InvoiceAdministrationService.list")(
    (query: InvoiceAdministrationListQuery = {}) =>
      invoices.list().pipe(
        Effect.flatMap((stored) => toListItems(stored.filter(isListed(query)))),
        Effect.map((items) => toPage(items, query))
      )
  );

  /**
   * The Admin UI's list: `list`, except that an invoice whose document
   * cannot be read is listed from its unencrypted columns, and the read logs
   * them once. The administration API keeps the strict `list`.
   */
  const listWithUnreadable = Effect.fn(
    "InvoiceAdministrationService.listWithUnreadable"
  )((query: InvoiceAdministrationListQuery = {}) =>
    invoices.listWithUnreadable().pipe(
      Effect.tap(({ unreadable }) =>
        unreadable.length === 0
          ? Effect.void
          : Effect.logWarning("Invoice documents unavailable", {
              count: unreadable.length,
              invoiceIds: unreadable.map(({ id }) => id),
            })
      ),
      Effect.flatMap(({ readable, unreadable }) =>
        toListItems(readable.filter(isListed(query))).pipe(
          Effect.map((items): readonly InvoiceAdministrationListEntry[] => [
            ...items,
            ...unreadable.filter(isListed(query)).map(toUnreadableListItem),
          ])
        )
      ),
      Effect.map((entries) => toPage(entries, query))
    )
  );

  /** The invoice the scope may read; an archived one is not found for the Admin UI. */
  const findReadable = Effect.fn("InvoiceAdministrationService.findReadable")(
    function* (invoiceId: string, scope: InvoiceAdministrationReadScope) {
      const id = yield* decodeInvoiceAdministrationId(invoiceId);
      const stored = yield* invoices.findById(id);
      if (!stored || (stored.archivedAt !== null && !scope.includeArchived))
        return yield* new InvoiceAdministrationNotFoundError({ invoiceId });
      return stored;
    }
  );

  const get = Effect.fn("InvoiceAdministrationService.get")(function* (
    invoiceId: string,
    scope: InvoiceAdministrationReadScope
  ) {
    const stored = yield* findReadable(invoiceId, scope);
    const statuses = yield* deliveryLedger.status([stored.id]);
    const record = stored.cancellation
      ? yield* cancellationRecords.find(stored.id)
      : null;
    const plan = stored.cancellation
      ? null
      : yield* cancellation.plan(stored.id);
    return toDetail(
      stored,
      statuses.get(stored.id)!,
      record,
      plan && {
        customerNotice: plan.customerNotice,
        reservation: plan.reservation,
      },
      yield* currentPragueDate
    );
  });

  const needsAttention = Effect.fn(
    "InvoiceAdministrationService.needsAttention"
  )(function* (invoiceId: InvoiceId) {
    const statuses = yield* deliveryLedger.status([invoiceId]);
    return statuses.get(invoiceId)!.needsAttention;
  });

  const getPdf = Effect.fn("InvoiceAdministrationService.getPdf")(function* (
    invoiceId: string,
    scope: InvoiceAdministrationReadScope
  ) {
    const stored = yield* findReadable(invoiceId, scope);
    return yield* renderInvoicePdfFile(stored.document);
  });

  /**
   * The corrective document of a cancelled invoice, rendered from its stored
   * snapshot. An invoice that isn't cancelled has none and is not found, like
   * an archived one outside the scope.
   */
  const getCorrectiveDocumentPdf = Effect.fn(
    "InvoiceAdministrationService.getCorrectiveDocumentPdf"
  )(function* (invoiceId: string, scope: InvoiceAdministrationReadScope) {
    const stored = yield* findReadable(invoiceId, scope);
    if (!stored.cancellation)
      return yield* new InvoiceAdministrationNotFoundError({ invoiceId });
    const document = yield* cancellationRecords.loadCorrectiveDocument(
      stored.id
    );
    // A cancellation always records its corrective document.
    if (!document) {
      return yield* new InvoiceCancellationError({
        code: "document_unavailable",
        invoiceId: stored.id,
        message: "The invoice's corrective document could not be loaded.",
      });
    }
    return yield* renderCorrectiveDocumentPdfFile(document);
  });

  const searchCustomers = Effect.fn(
    "InvoiceAdministrationService.searchCustomers"
  )(function* (query: string) {
    const { customers } = yield* customerDirectory.search(query);
    const now = yield* DateTime.nowAsDate;
    return customers.map((customer) => toCustomer(customer, now));
  });

  const preview = Effect.fn("InvoiceAdministrationService.preview")(function* (
    input: AdministrationInvoiceCreateInputType,
    issuer: ManualInvoiceIssuer
  ) {
    const prepared = yield* prepare(input, issuer);
    const normalized = yield* normalizeManualInvoiceInput(
      prepared.forCustomer(DotyposCustomerIdSchema.make("preview"))
    );
    return yield* renderInvoicePdf(
      makeManualInvoiceDocument({
        normalized,
        invoiceNumber: invoiceNumberSchema.make("PREVIEW-0000000000"),
        issuedAt: Temporal.Now.instant(),
      })
    );
  });

  const create = Effect.fn("InvoiceAdministrationService.create")(function* (
    input: AdministrationInvoiceCreateInputType,
    issuer: ManualInvoiceIssuer
  ) {
    const prepared = yield* prepare(input, issuer);
    const { invoiceId, provenance } = prepared;
    const issueForCustomer = (dotyposCustomerId: DotyposCustomerId) =>
      invoices.issueManual({
        ...prepared.forCustomer(dotyposCustomerId),
        issuedBy: issuer.administrator,
      });
    // The claim decides whether this request may issue: different input or
    // an unfinished concurrent creation refuses it, and a completed one must
    // still have its invoice.
    const findClaimedInvoice = Effect.fnUntraced(function* (
      claim: ManualInvoiceCreationClaim
    ) {
      if (claim.kind === "mismatch") {
        return yield* new InvoiceAdministrationCustomerError({
          reason: "invoice-id-reused",
          message: "Invoice id was already used with different input.",
        });
      }
      if (claim.kind === "in-progress") {
        return yield* new InvoiceAdministrationInProgressError({
          invoiceId: input.invoiceId,
          message:
            "This invoice is already being created. Try the same request again shortly.",
        });
      }
      const existing = yield* invoices.findById(input.invoiceId);
      if (claim.kind === "completed" && !existing) {
        return yield* new ManualInvoiceCreationRequestError({
          message: "The completed invoice creation request has no invoice.",
        });
      }
      return existing;
    });
    // An invoice issued before keeps its customer unless the request names
    // one; otherwise the request's customer is resolved first.
    const issueLocked = Effect.fnUntraced(function* (existing: Invoice | null) {
      if (existing) {
        return yield* issueForCustomer(
          input.customer.kind === "existing"
            ? yield* decodeDotyposCustomerId(input.customer.customerId)
            : DotyposCustomerIdSchema.make(existing.dotyposCustomerId)
        );
      }
      const customerResolution = resolveCustomer(
        dotypos,
        input.customer,
        prepared.buyer
      );
      return yield* (
        input.customer.kind === "new"
          ? // ponytail: one global new-customer lock avoids putting email
            // PII in SQL; shard by a keyed normalized-email digest if
            // admin throughput matters.
            transaction(
              WorkspaceLocks.manualInvoiceNewCustomer().pipe(
                Effect.andThen(customerResolution)
              )
            )
          : customerResolution
      ).pipe(
        Effect.flatMap((customer) => decodeDotyposCustomerId(customer.id)),
        Effect.flatMap(issueForCustomer)
      );
    });
    const issuance = yield* transaction(
      WorkspaceLocks.manualInvoiceCreation(invoiceId).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const claim = yield* creationRequests.claim({
              invoiceId,
              normalizedRequestJson: getManualInvoiceCreationRequestJson(
                input,
                provenance
              ),
            });
            const lockedIssuance = yield* issueLocked(
              yield* findClaimedInvoice(claim)
            );
            if (claim.kind === "claimed") {
              yield* creationRequests.complete(invoiceId);
            }
            return lockedIssuance;
          })
        )
      )
    );
    yield* deliveries
      .deliverByInvoiceId({ invoiceId: issuance.invoice.id })
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Invoice email delivery needs attention", {
            cause,
            invoiceId: issuance.invoice.id,
          })
        )
      );
    return {
      invoiceId: AdministrationInvoiceId.make(issuance.invoice.id),
      invoiceNumber: issuance.invoice.invoiceNumber,
      changed: issuance.changed,
      needsAttention: yield* needsAttention(issuance.invoice.id),
    } satisfies InvoiceAdministrationCreateResult;
  });

  /**
   * Retries what the invoice still owes: the original invoice email of a
   * live invoice, or the cancellation notices of a cancelled one. A
   * cancelled invoice's original email is never sent again.
   */
  const retry = Effect.fn("InvoiceAdministrationService.retry")(function* (
    invoiceId: string
  ) {
    const id = yield* decodeInvoiceAdministrationId(invoiceId);
    const stored = yield* invoices.findById(id);
    if (!stored)
      return yield* new InvoiceAdministrationNotFoundError({ invoiceId });
    const reservationId = stored.workspaceReservationId
      ? AdministrationWorkspaceReservationId.make(stored.workspaceReservationId)
      : null;
    if (stored.cancellation) {
      const delivery = yield* cancellation.retryNotices(stored.id);
      return {
        invoiceId: AdministrationInvoiceId.make(id),
        changed: delivery.changed,
        needsAttention: delivery.notices.needsAttention,
        notices: delivery.notices,
        reservationId,
      } satisfies InvoiceAdministrationRetryResult;
    }
    const result = yield* deliveries.deliverByInvoiceId({ invoiceId: id });
    return {
      invoiceId: AdministrationInvoiceId.make(id),
      changed: result.status === "delivered" && result.changed,
      needsAttention: yield* needsAttention(stored.id),
      notices: null,
      reservationId,
    } satisfies InvoiceAdministrationRetryResult;
  });

  const toCancelResult = (
    outcome: InvoiceCancellationOutcome,
    reservation: InvoiceAdministrationCancelResult["reservation"]
  ): InvoiceAdministrationCancelResult => ({
    invoiceId: AdministrationInvoiceId.make(outcome.cancellation.invoiceId),
    outcome: outcome.outcome,
    cancellation: toCancellation(outcome.cancellation),
    reservation,
  });

  /**
   * Cancels the invoice with a corrective document. An invoice that bills a
   * live reservation is cancelled only with it, through the reservation's
   * cancellation, so the reservation's confirmation is required; every other
   * invoice is cancelled alone. A replay answers `already_cancelled`.
   */
  const cancel = Effect.fn("InvoiceAdministrationService.cancel")(function* (
    input: InvoiceAdministrationCancelInput
  ) {
    const id = invoiceIdSchema.make(
      yield* decodeInvoiceAdministrationId(input.invoiceId)
    );
    const plan = yield* cancellation.plan(id).pipe(
      Effect.catchIf(
        (cause) => cause.code === "not_found",
        () =>
          Effect.fail(
            new InvoiceAdministrationNotFoundError({
              invoiceId: input.invoiceId,
            })
          )
      )
    );
    const cancelAlone = () =>
      cancellation
        .cancelStandalone({
          invoiceId: id,
          actor: input.actor,
          confirmedCustomerNotice: input.confirmedCustomerNotice,
        })
        .pipe(Effect.map((outcome) => toCancelResult(outcome, null)));
    if (plan.invoice.cancelled) return yield* cancelAlone();
    if (plan.reservation === "cancellation_in_progress") {
      return yield* new InvoiceCancellationError({
        code: "reservation_cancellation_in_progress",
        invoiceId: id,
        message:
          "The invoice's reservation is being cancelled. Try again once that finishes.",
      });
    }
    if (
      plan.reservation !== "cancels_reservation" ||
      !plan.invoice.reservationId
    )
      return yield* cancelAlone();
    if (!input.reservation) {
      return yield* new InvoiceCancellationError({
        code: "reservation_confirmation_required",
        invoiceId: id,
        message:
          "Cancelling this invoice also cancels its reservation. Confirm the reservation cancellation too.",
      });
    }
    const reservationId: WorkspaceReservationId = plan.invoice.reservationId;
    const cancelled = yield* reservationAdministration.cancel({
      ...input.reservation,
      reservationId,
      actor: input.actor,
      confirmedConsequences: {
        invoice: true,
        customerNotice: input.confirmedCustomerNotice,
      },
    });
    const reservation = {
      reservationId: AdministrationWorkspaceReservationId.make(reservationId),
      outcome: cancelled.outcome,
      email: cancelled.email,
    };
    const record = yield* cancellationRecords.find(id);
    // The reservation was cancelled meanwhile without this invoice, as a
    // legacy cancellation left it: it is cancelled alone now.
    if (!record) {
      return yield* cancelAlone().pipe(
        Effect.map((result) => ({ ...result, reservation }))
      );
    }
    return toCancelResult(
      {
        outcome:
          cancelled.invoice?.invoiceId === id
            ? cancelled.invoice.outcome
            : "already_cancelled",
        cancellation: record,
      },
      reservation
    );
  });

  /**
   * Hides a cancelled invoice from the Admin UI. It stays retained and
   * readable through the administration API. A live invoice is refused;
   * archiving again changes nothing and keeps the first actor.
   */
  const archive = Effect.fn("InvoiceAdministrationService.archive")(
    function* (input: {
      readonly invoiceId: string;
      readonly actor: AdministrationActor;
    }) {
      const id = invoiceIdSchema.make(
        yield* decodeInvoiceAdministrationId(input.invoiceId)
      );
      const archived = yield* archives
        .archive({ invoiceId: id, actor: input.actor })
        .pipe(
          Effect.catchIf(
            (cause) =>
              cause instanceof InvoiceArchiveError &&
              cause.code === "not_found",
            () =>
              Effect.fail(
                new InvoiceAdministrationNotFoundError({
                  invoiceId: input.invoiceId,
                })
              )
          )
        );
      return {
        invoiceId: AdministrationInvoiceId.make(id),
        archivedAt: archived.archive.archivedAt.toString(),
        changed: archived.changed,
      } satisfies InvoiceAdministrationArchiveResult;
    }
  );

  const getCreationDefaults = Effect.fn(
    "InvoiceAdministrationService.getCreationDefaults"
  )(function* () {
    const today = Temporal.Now.zonedDateTimeISO(
      workspaceSiteConstants.location.timeZone
    ).toPlainDate();
    return {
      currencies: invoiceEnabledCurrencyDefinitions,
      defaultCurrency: defaultWorkspaceCurrencyCode,
      defaultServiceDate: today.toString(),
      defaultDueDate: today.add({ days: 14 }).toString(),
      suggestedVariableSymbol: yield* invoices.getSuggestedVariableSymbol(),
    };
  });

  return {
    archive,
    cancel,
    create,
    get,
    getCorrectiveDocumentPdf,
    getCreationDefaults,
    getPdf,
    list,
    listWithUnreadable,
    preview,
    retry,
    searchCustomers,
  };
});

export class InvoiceAdministrationService extends Context.Service<
  InvoiceAdministrationService,
  Effect.Success<typeof makeInvoiceAdministrationService>
>()("@deskohub-workspace/accounting/InvoiceAdministrationService") {
  static Default = Layer.effect(this, makeInvoiceAdministrationService).pipe(
    // The directory has one implementation: tests substitute `DotyposService` beneath it.
    Layer.provide(AdministrationCustomerDirectory.Default)
  );
  static Live = this.Default.pipe(Layer.provide(getDependencies()));
}

const decodeDotyposCustomerId = (customerId: string | undefined) =>
  Schema.decodeUnknownEffect(DotyposCustomerIdSchema)(customerId).pipe(
    Effect.mapError(
      () =>
        new InvoiceAdministrationCustomerError({
          reason: "customer-id-missing",
          message: "Dotypos returned a customer without an id.",
        })
    )
  );

const resolveCustomer = Effect.fn(
  "InvoiceAdministrationService.resolveCustomer"
)(function* (
  dotypos: Context.Service.Shape<typeof DotyposService>,
  input: AdministrationInvoiceCreateInputType["customer"],
  buyer: InvoiceBuyer
) {
  const details = toDotyposDetails(input.details, buyer);
  if (input.kind === "existing") {
    const customerId = yield* Schema.decodeUnknownEffect(
      DotyposCustomerIdSchema
    )(input.customerId).pipe(
      Effect.mapError(
        () =>
          new InvoiceAdministrationCustomerError({
            reason: "customer-id-invalid",
            message: "The selected customer id is invalid.",
          })
      )
    );
    const customer = yield* dotypos.getCustomer(customerId);
    const now = yield* DateTime.nowAsDate;
    // A customer Dotypos no longer has gets the same answer as a deleted or
    // expired one; neither has its details updated.
    if (
      Option.isNone(customer) ||
      !isFindableAdministrationCustomer(customer.value, now)
    )
      return yield* new InvoiceAdministrationCustomerError({
        reason: "customer-deleted",
        message: "The selected customer is deleted or expired.",
      });
    return yield* dotypos.updateCustomerDetails(customerId, details);
  }

  // The lookup compares whole addresses case-insensitively and leaves out
  // deleted customers only when an active one matches, so lifecycle is
  // decided here, as administration's customer search decides it.
  const found = yield* dotypos.findCustomer(
    { firstName: details.firstName, email: details.email },
    { lookupFields: ["email"] }
  );
  if (found._tag === "NotFound") return yield* dotypos.createCustomer(details);
  const now = yield* DateTime.nowAsDate;
  const [customer, ...others] = found.matches.filter((match) =>
    isFindableAdministrationCustomer(match, now)
  );
  // An email held only by deleted or expired customers creates no duplicate:
  // an expired customer may still reactivate its account by that email.
  if (!customer)
    return yield* new InvoiceAdministrationCustomerError({
      reason: "customer-deleted",
      message: "Every customer with this email is deleted or expired.",
    });
  if (others.length > 0)
    return yield* new InvoiceAdministrationCustomerError({
      reason: "customer-email-ambiguous",
      message:
        "Multiple Dotypos customers use this email. Select the correct existing customer.",
    });
  return yield* dotypos.updateCustomerDetails(customer.id, details);
});

const toDotyposDetails = (
  details: AdministrationInvoiceCustomerDetailsType,
  buyer: InvoiceBuyer
): DotyposCustomerDetails => ({
  firstName: details.firstName ?? "",
  lastName: details.lastName ?? "",
  email: details.email,
  // Not a visitor's input: the phone is the Dotypos customer's stored one or
  // what an administrator enters for the business's own customer, so a number
  // without a country calling code is a national one of the business's
  // market, the base locale's region, whatever the Admin's language.
  phone: Option.getOrUndefined(
    parsePhoneNumber(details.phone ?? "", defaultPhoneRegion(baseLocale))
  ),
  ...toDotyposCustomerBillingDetails(buyer),
});

const toBuyer = Effect.fn("InvoiceAdministrationService.toBuyer")(
  (details: AdministrationInvoiceCustomerDetailsType) =>
    Schema.decodeUnknownEffect(invoiceBuyerSchema, {
      onExcessProperty: "error",
    })({
      kind: details.kind,
      legalName:
        details.kind === "business"
          ? details.companyName
          : `${details.firstName} ${details.lastName}`.trim(),
      ...(details.kind === "business" && {
        companyId: details.companyId,
        ...(details.vatId && { vatId: details.vatId }),
      }),
      address: details.address,
    }).pipe(
      Effect.mapError(
        () =>
          new InvoiceAdministrationCustomerError({
            reason: "billing-details-invalid",
            message: "Complete valid billing details are required.",
          })
      )
    )
);

/** A Dotypos text field without surrounding whitespace; absent reads as "". */
const customerText = (value: string | null | undefined) => value?.trim() ?? "";

const toCustomerAddress = (customer: DotyposCustomer) => {
  const line2 = customerText(customer.addressLine2);
  return {
    line1: customerText(customer.addressLine1),
    ...(line2 && { line2 }),
    city: customerText(customer.city),
    postalCode: customerText(customer.zip),
    country: customerText(customer.country).toUpperCase() || "CZ",
  };
};

/**
 * The billing details a Dotypos customer prefills: a business when it has a
 * company name, otherwise a person.
 */
const toCustomerDetails = (
  customer: DotyposCustomer
): AdministrationInvoiceCustomerDetailsType => {
  const phone = customerText(customer.phone);
  const common = {
    email: customerText(customer.email),
    ...(phone && { phone }),
    firstName: customerText(customer.firstName) || undefined,
    lastName: customerText(customer.lastName) || undefined,
    address: toCustomerAddress(customer),
  };
  const companyName = customerText(customer.companyName);
  if (!companyName) {
    return {
      ...common,
      kind: "person",
      firstName: customerText(customer.firstName),
      lastName: customerText(customer.lastName),
    };
  }
  const vatId = customerText(customer.vatId);
  return {
    ...common,
    kind: "business",
    companyName,
    companyId: customerText(customer.companyId),
    ...(vatId && { vatId }),
  };
};

/** A searched customer, named at `now`, the time it was read. */
const toCustomer = (
  customer: DotyposCustomer,
  now: Date
): InvoiceAdministrationCustomer => {
  const { phone: _phone, ...described } = describeAdministrationCustomer(
    customer,
    now
  );
  return { ...described, details: toCustomerDetails(customer) };
};

const toCancellation = (
  record: InvoiceCancellationRecord
): InvoiceAdministrationCancellation => ({
  cancelledAt: record.cancelledAt.toString(),
  cause: record.cause,
  source: record.source,
  actor: record.actor.email,
  correctiveDocumentNumber: record.correctiveDocumentNumber,
  correctiveDocumentIssuedAt: record.correctiveDocumentIssuedAt.toString(),
  correctiveDocumentPdfUrl: administrationHref(
    "/[locale]/admin/invoices/[invoiceId]/corrective-document",
    { invoiceId: record.invoiceId }
  ),
  notices: record.notices,
});

/** Whether the list query shows the invoice: the Admin UI never lists a hidden one. */
const isListed =
  (query: InvoiceAdministrationListQuery) =>
  (invoice: { readonly archivedAt: Temporal.Instant | null }) =>
    query.includeArchived || invoice.archivedAt === null;

const toPage = <Item extends InvoiceAdministrationListEntry>(
  items: readonly Item[],
  query: InvoiceAdministrationListQuery
): InvoiceAdministrationPage<Item> => {
  const sorted = sortInvoiceAdministrationItems(items, query);
  const pageSize = 24;
  const pagination = getAdministrationPagination({
    pageSize,
    requestedPage: query.page,
    total: sorted.length,
  });
  return {
    items: sorted.slice(pagination.offset, pagination.offset + pageSize),
    total: sorted.length,
    page: pagination.page,
    pageSize,
    pageCount: pagination.pageCount,
  };
};

const toUnreadableListItem = (
  invoice: UnreadableInvoice
): InvoiceAdministrationUnreadableListItem => ({
  documentUnavailable: true,
  id: AdministrationInvoiceId.make(invoice.id),
  invoiceNumber: invoice.invoiceNumber,
  issuedAt: invoice.issuedAt.toString(),
  cancelledAt: invoice.cancellation?.cancelledAt.toString() ?? null,
  archivedAt: invoice.archivedAt?.toString() ?? null,
  replacesInvoiceId: invoice.replacesInvoiceId
    ? AdministrationInvoiceId.make(invoice.replacesInvoiceId)
    : null,
  replacedByInvoiceId: invoice.replacedByInvoiceId
    ? AdministrationInvoiceId.make(invoice.replacedByInvoiceId)
    : null,
});

const toListItem = (
  invoice: Invoice,
  { customer, internal, needsAttention }: InvoiceDeliverySummary,
  cancellationRecord: InvoiceCancellationRecord | null,
  today: PlainDate
): InvoiceAdministrationListItem => {
  const document = invoice.document;
  const manual = isManualInvoiceDocument(document);
  const total = getInvoiceTotal(document);
  return {
    id: AdministrationInvoiceId.make(invoice.id),
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: invoice.issuedAt.toString(),
    customerId: AdministrationDotyposCustomerId.make(invoice.dotyposCustomerId),
    customerName: document.buyer.legalName,
    reservationId: invoice.workspaceReservationId
      ? AdministrationWorkspaceReservationId.make(
          invoice.workspaceReservationId
        )
      : null,
    total: total.amount,
    currency: total.currency,
    paymentStatus: getInvoicePaymentStatus(document, today),
    source: manual
      ? document.provenance.source
      : (document.provenance?.source ?? "legacy"),
    actor: manual ? document.provenance.actor : null,
    delivery: { customer, internal },
    // A cancelled invoice's own email no longer needs attention; its
    // notices may.
    needsAttention: cancellationRecord
      ? cancellationRecord.notices.needsAttention
      : needsAttention,
    cancellation: cancellationRecord && toCancellation(cancellationRecord),
    archivedAt: invoice.archivedAt?.toString() ?? null,
    replacesInvoiceId: invoice.replacesInvoiceId
      ? AdministrationInvoiceId.make(invoice.replacesInvoiceId)
      : null,
    replacedByInvoiceId: invoice.replacedByInvoiceId
      ? AdministrationInvoiceId.make(invoice.replacedByInvoiceId)
      : null,
  };
};

const toDetail = (
  invoice: Invoice,
  delivery: InvoiceDeliverySummary,
  cancellationRecord: InvoiceCancellationRecord | null,
  cancellationPlan: InvoiceAdministrationCancellationPlan | null,
  today: PlainDate
): InvoiceAdministrationDetail => {
  const summary = {
    ...toListItem(invoice, delivery, cancellationRecord, today),
    cancellationPlan,
  };
  const document = invoice.document;
  const settlement = getInvoiceSettlement(document);
  // The contract reports the due date a manual invoice states even when
  // nothing is due; the Admin UI shows it only when payment is requested.
  const terms = Match.value(settlement).pipe(
    Match.tagsExhaustive({
      Paid: ({ paidOn }) => ({ dueDate: null, paidOn }),
      PaymentRequested: ({ dueDate }) => ({ dueDate, paidOn: null }),
      NothingDue: ({ statedDueDate }) => ({
        dueDate: statedDueDate,
        paidOn: null,
      }),
    })
  );
  if (isManualInvoiceDocument(document)) {
    return {
      ...summary,
      locale: document.locale,
      serviceDate: document.serviceDate,
      ...terms,
      variableSymbol: document.variableSymbol,
      lines: document.lines,
      buyer: document.buyer,
      // The API keeps this unprefixed; the proxy opens it in the operator's language.
      pdfUrl: administrationHref("/[locale]/admin/invoices/[invoiceId]/pdf", {
        invoiceId: invoice.id,
      }),
      settlement,
    };
  }
  const presentation = getInvoicePresentation(document);
  return {
    ...summary,
    locale: document.locale,
    // The administration contract carries a calendar date; the service date
    // of a reservation invoice is the Prague date of its fulfillment instant.
    serviceDate: document.fulfilledAt
      ? temporalInstantToPlainDate({
          instant: Temporal.Instant.from(document.fulfilledAt),
          timeZone: workspaceSiteConstants.location.timeZone,
        }).toString()
      : null,
    ...terms,
    variableSymbol: null,
    lines: presentation.lines.map(({ description, amount }) => ({
      description,
      price: amount,
    })),
    buyer: document.buyer,
    // The API keeps this unprefixed; the proxy opens it in the operator's language.
    pdfUrl: administrationHref("/[locale]/admin/invoices/[invoiceId]/pdf", {
      invoiceId: invoice.id,
    }),
    settlement,
  };
};

const currentPragueDate = currentPlainDate(
  workspaceSiteConstants.location.timeZone
);

/**
 * Orders the list. An unreadable invoice sorts by its issue time and number
 * like any other; it has no customer, total, payment status, source or
 * delivery, so by those it follows every readable invoice, newest first.
 */
export const sortInvoiceAdministrationItems = <
  Item extends InvoiceAdministrationListEntry,
>(
  items: readonly Item[],
  query: InvoiceAdministrationListQuery
) => {
  const direction = query.direction === "asc" ? 1 : -1;
  const needsAttention = (item: InvoiceAdministrationListEntry) =>
    !isUnreadableInvoiceListEntry(item) && item.needsAttention;
  return items.toSorted((left, right) => {
    if (!query.sort) {
      return (
        Number(needsAttention(right)) - Number(needsAttention(left)) ||
        right.issuedAt.localeCompare(left.issuedAt)
      );
    }
    if (query.sort === "invoiceNumber" || query.sort === "issuedAt") {
      return (
        left[query.sort].localeCompare(right[query.sort]) * direction ||
        left.id.localeCompare(right.id)
      );
    }
    if (
      isUnreadableInvoiceListEntry(left) ||
      isUnreadableInvoiceListEntry(right)
    ) {
      return (
        Number(isUnreadableInvoiceListEntry(left)) -
          Number(isUnreadableInvoiceListEntry(right)) ||
        right.issuedAt.localeCompare(left.issuedAt) ||
        left.id.localeCompare(right.id)
      );
    }
    const compared = {
      customer: left.customerName.localeCompare(right.customerName),
      total: BigDecimal.Order(
        BigDecimal.fromStringUnsafe(left.total),
        BigDecimal.fromStringUnsafe(right.total)
      ),
      paymentStatus: left.paymentStatus.localeCompare(right.paymentStatus),
      source: left.source.localeCompare(right.source),
      delivery: Number(left.needsAttention) - Number(right.needsAttention),
    }[query.sort];
    return compared * direction || left.id.localeCompare(right.id);
  });
};

function getDependencies() {
  return Layer.mergeAll(
    WorkspaceDatabase.Default,
    AccountingStorage.Live,
    InvoiceEmailDeliveryRepository.Live,
    InvoiceArchiveRepository.Live,
    InvoiceCancellationService.Live,
    ReservationAdministrationService.Live,
    ManualInvoiceCreationRequests.Live,
    InvoiceEmailDeliveryService.Live,
    WorkspaceDotyposLayer
  );
}

export const getManualInvoiceCreationRequestJson = (
  input: AdministrationInvoiceCreateInputType,
  provenance: ManualInvoiceProvenance
) =>
  JSON.stringify({
    invoiceId: input.invoiceId,
    customer:
      input.customer.kind === "existing"
        ? {
            kind: input.customer.kind,
            customerId: input.customer.customerId.trim(),
            details: getNormalizedCustomerDetails(input.customer.details),
          }
        : {
            kind: input.customer.kind,
            details: getNormalizedCustomerDetails(input.customer.details),
          },
    locale: input.locale,
    serviceDate: input.serviceDate,
    ...(input.payment.status === "paid"
      ? { paidOn: input.payment.date }
      : { dueDate: input.payment.date }),
    currency: input.currency,
    variableSymbol: input.variableSymbol?.trim() ?? null,
    lines: input.lines.map((line) => ({
      description: line.description.trim(),
      price: BigDecimal.format(
        BigDecimal.normalize(BigDecimal.fromStringUnsafe(line.price))
      ),
    })),
    provenance: {
      source: provenance.source,
      actor: provenance.actor.trim(),
    },
  });

const getNormalizedCustomerDetails = (
  details: AdministrationInvoiceCustomerDetailsType
) => {
  const common = {
    email: details.email.trim(),
    phone: details.phone?.trim() ?? null,
    address: {
      line1: details.address.line1.trim(),
      line2: details.address.line2?.trim() ?? null,
      city: details.address.city.trim(),
      postalCode: details.address.postalCode.trim(),
      country: details.address.country.trim(),
    },
  };
  return details.kind === "business"
    ? {
        ...common,
        kind: details.kind,
        companyName: details.companyName.trim(),
        companyId: details.companyId.trim(),
        vatId: details.vatId?.trim() ?? null,
        firstName: details.firstName?.trim() ?? null,
        lastName: details.lastName?.trim() ?? null,
      }
    : {
        ...common,
        kind: details.kind,
        firstName: details.firstName.trim(),
        lastName: details.lastName.trim(),
      };
};
