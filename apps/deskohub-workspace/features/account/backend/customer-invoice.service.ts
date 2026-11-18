import { Context, Data, Effect, Layer } from "effect";
import { AccountingStorage } from "@/features/accounting/backend/accounting-storage";
import {
  type CorrectiveDocumentPdfFile,
  renderCorrectiveDocumentPdfFile,
} from "@/features/accounting/backend/corrective-document-pdf";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import { InvoiceCancellationRepository } from "@/features/accounting/backend/invoice-cancellation.repository";
import {
  type InvoicePdfFile,
  renderInvoicePdfFile,
} from "@/features/accounting/backend/invoice-pdf";
import {
  type CustomerInvoiceSummary,
  getCustomerInvoiceCsvColumns,
  getCustomerInvoiceSummary,
  type InvoicedReservation,
} from "@/features/accounting/customer-invoice";
import type { Locale } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils";
import type { CsvColumn } from "@/shared/utils/csv";
import { currentPlainDate, type PlainDate } from "@/shared/utils/temporal";
import {
  type CustomerAccountAccessError,
  isCustomerAccountAccessDenial,
  type LinkedCustomerAccount,
} from "../customer-account";
import { getReservationProductName } from "../reservation-product-name";
import { CurrentCustomerAccount } from "./current-customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { requireLinkedCustomerAccount } from "./linked-customer-account";

/**
 * The session has no active account whose invoices it may see: signed out,
 * no linked Dotypos customer, a review account, or deletion pending.
 * `account` is the refusal, for callers that say why.
 */
export class CustomerInvoicesUnavailableError extends Data.TaggedError(
  "CustomerInvoicesUnavailableError"
)<{
  readonly account: CustomerAccountAccessError;
}> {}

/**
 * No invoice of the account's customer has this id, or, for its corrective
 * document, the invoice isn't cancelled.
 */
export class CustomerInvoiceNotFoundError extends Data.TaggedError(
  "CustomerInvoiceNotFoundError"
) {}

/** Which step failed; the only detail a load failure keeps or logs. */
export type CustomerInvoiceLoadFailureCode =
  | "account.authority"
  | "invoice.read"
  | "invoice.pdf"
  | "corrective-document.read"
  | "corrective-document.pdf";

/**
 * The account or its invoices couldn't be read. It keeps a fixed code, never
 * the database, decryption, or renderer cause.
 */
export class CustomerInvoicesLoadError extends Data.TaggedError(
  "CustomerInvoicesLoadError"
)<{
  readonly code: CustomerInvoiceLoadFailureCode;
}> {}

/**
 * An invoice in the account's list: its summary, with the product an order's
 * invoice booked named from the catalog in the list's locale, as the
 * reservation history names it.
 */
export interface CustomerInvoiceListing
  extends Omit<CustomerInvoiceSummary, "reservation"> {
  readonly reservation:
    | (InvoicedReservation & { readonly productName: string })
    | null;
}

/** The account's invoice export, ready for `createCsvDownloadResponse`. */
interface CustomerInvoiceExport {
  readonly filename: string;
  readonly columns: readonly CsvColumn<CustomerInvoiceSummary>[];
  readonly rows: readonly CustomerInvoiceSummary[];
}

interface ICustomerInvoiceService {
  /**
   * The account's issued invoices, newest issue first, each invoiced
   * product named in `locale`.
   */
  readonly list: (options: {
    readonly locale: Locale;
  }) => Effect.Effect<
    readonly CustomerInvoiceListing[],
    CustomerInvoicesUnavailableError | CustomerInvoicesLoadError
  >;
  /**
   * One of the account's invoices as a PDF file. Another customer's invoice,
   * an unknown id, and text that is no invoice id are all not found.
   */
  readonly pdf: (
    invoiceId: string
  ) => Effect.Effect<
    InvoicePdfFile,
    | CustomerInvoiceNotFoundError
    | CustomerInvoicesUnavailableError
    | CustomerInvoicesLoadError
  >;
  /**
   * The corrective document that cancelled one of the account's invoices, as
   * a PDF file. It answers like `pdf`, and an invoice that isn't cancelled is
   * not found too.
   */
  readonly correctiveDocumentPdf: (
    invoiceId: string
  ) => Effect.Effect<
    CorrectiveDocumentPdfFile,
    | CustomerInvoiceNotFoundError
    | CustomerInvoicesUnavailableError
    | CustomerInvoicesLoadError
  >;
  /** The account's invoices as CSV rows with headers in `locale`. */
  readonly csv: (
    locale: Locale
  ) => Effect.Effect<
    CustomerInvoiceExport,
    CustomerInvoicesUnavailableError | CustomerInvoicesLoadError
  >;
}

/**
 * A signed-in customer's own issued invoices. Every operation re-authorizes
 * from the authoritative session: it resolves the account's Dotypos customer
 * and re-reads the account's activity, so a deletion request or a removed
 * login stops it, and reads only that customer's invoices.
 */
export class CustomerInvoiceService extends Context.Service<
  CustomerInvoiceService,
  ICustomerInvoiceService
>()("@deskohub-workspace/account/CustomerInvoiceService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const currentAccount = yield* CurrentCustomerAccount;
      const links = yield* CustomerAccountLinkRepository;
      const invoices = yield* InvoiceRepository;
      const cancellations = yield* InvoiceCancellationRepository;

      const authorize: Effect.Effect<
        LinkedCustomerAccount,
        CustomerInvoicesUnavailableError | CustomerInvoicesLoadError
      > = requireLinkedCustomerAccount.pipe(
        Effect.provideService(CurrentCustomerAccount, currentAccount),
        Effect.tap((account) =>
          requireAccountActivity(links, account.accountId)
        ),
        Effect.catchTag(
          "CustomerAccountAccessError",
          (
            error
          ): Effect.Effect<
            never,
            CustomerInvoicesUnavailableError | CustomerInvoicesLoadError
          > =>
            isCustomerAccountAccessDenial(error)
              ? Effect.fail(
                  new CustomerInvoicesUnavailableError({ account: error })
                )
              : failLoad("account.authority")
        )
      );

      const listWithToday = (
        account: LinkedCustomerAccount
      ): Effect.Effect<
        {
          readonly today: PlainDate;
          readonly summaries: readonly CustomerInvoiceSummary[];
        },
        CustomerInvoicesLoadError
      > =>
        Effect.Do.pipe(
          Effect.bind("issued", () =>
            invoices
              .listForCustomer(account.dotyposCustomerId)
              .pipe(Effect.catch(() => failLoad("invoice.read")))
          ),
          Effect.bind("today", () => currentPlainDate(workspaceTimeZone)),
          Effect.map(({ issued, today }) => ({
            today,
            summaries: issued.map((invoice) =>
              getCustomerInvoiceSummary(invoice, today)
            ),
          }))
        );

      const list = ({ locale }: { readonly locale: Locale }) =>
        authorize.pipe(
          Effect.flatMap(listWithToday),
          Effect.map(({ summaries }) =>
            summaries.map(
              ({ reservation, ...summary }): CustomerInvoiceListing => ({
                ...summary,
                reservation: reservation && {
                  ...reservation,
                  productName: getReservationProductName(
                    reservation.product,
                    locale
                  ),
                },
              })
            )
          ),
          Effect.withSpan("CustomerInvoiceService.list")
        );

      /** One of the account's invoices, after re-authorizing the session. */
      const findOwnInvoice = Effect.fnUntraced(function* (invoiceId: string) {
        const account = yield* authorize;
        const invoice = yield* invoices
          .findForCustomer(account.dotyposCustomerId, invoiceId)
          .pipe(Effect.catch(() => failLoad("invoice.read")));
        if (!invoice) return yield* new CustomerInvoiceNotFoundError();
        return invoice;
      });

      const pdf = Effect.fn("CustomerInvoiceService.pdf")(function* (
        invoiceId: string
      ) {
        const invoice = yield* findOwnInvoice(invoiceId);
        return yield* renderInvoicePdfFile(invoice.document).pipe(
          Effect.catch(() => failLoad("invoice.pdf"))
        );
      });

      const correctiveDocumentPdf = Effect.fn(
        "CustomerInvoiceService.correctiveDocumentPdf"
      )(function* (invoiceId: string) {
        const invoice = yield* findOwnInvoice(invoiceId);
        if (!invoice.cancellation) {
          return yield* new CustomerInvoiceNotFoundError();
        }
        const document = yield* cancellations
          .loadCorrectiveDocument(invoice.id)
          .pipe(Effect.catch(() => failLoad("corrective-document.read")));
        // A cancellation always has its corrective document; a missing one
        // can't be served, so it fails like an unreadable one.
        if (!document) return yield* failLoad("corrective-document.read");
        return yield* renderCorrectiveDocumentPdfFile(document).pipe(
          Effect.catch(() => failLoad("corrective-document.pdf"))
        );
      });

      const csv = Effect.fn("CustomerInvoiceService.csv")(function* (
        locale: Locale
      ) {
        const { today, summaries } = yield* authorize.pipe(
          Effect.flatMap(listWithToday)
        );
        return {
          filename: `invoices-${today}.csv`,
          columns: getCustomerInvoiceCsvColumns(locale),
          rows: summaries,
        } satisfies CustomerInvoiceExport;
      });

      return {
        list,
        pdf,
        correctiveDocumentPdf,
        csv,
      } satisfies ICustomerInvoiceService;
    })
  );

  /**
   * For the account the caller's `CurrentCustomerAccount` reads, such as one
   * built from a customer API request's own authentication.
   */
  static ForCurrentAccount = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(CustomerAccountLinkRepository.Live, AccountingStorage.Live)
    )
  );

  static Live = this.ForCurrentAccount.pipe(
    Layer.provide(CurrentCustomerAccount.Live)
  );
}

const workspaceTimeZone = workspaceSiteConstants.location.timeZone;

/** Logs the step's fixed code, never its cause, and fails with it. */
const failLoad = (code: CustomerInvoiceLoadFailureCode) =>
  Effect.logError("Customer invoices could not be loaded", {
    failureCode: code,
  }).pipe(Effect.andThen(Effect.fail(new CustomerInvoicesLoadError({ code }))));
