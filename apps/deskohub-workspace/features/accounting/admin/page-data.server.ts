import "server-only";

import { Effect } from "effect";
import {
  AdministrationRecordNotFound,
  runAdministrationPage,
} from "@/features/administrators/server/administration-request.server";
import type { SearchParamsRecord } from "@/shared/utils/search-params";
import {
  type InvoiceAdministrationDetail,
  InvoiceAdministrationService,
} from "./invoice-administration.service";
import { invoiceListQuery } from "./invoice-list-query";

export type InvoiceAdministrationSearchParams = Promise<SearchParamsRecord>;

const invoiceNotFound = () => Effect.fail(new AdministrationRecordNotFound());

export const loadInvoiceAdministrationList = (
  searchParams: InvoiceAdministrationSearchParams
) =>
  runAdministrationPage(
    "invoice-administration.list",
    Effect.gen(function* () {
      const query = invoiceListQuery.parse(
        yield* Effect.promise(() => searchParams)
      );
      const administration = yield* InvoiceAdministrationService;
      return {
        items: yield* administration.listWithUnreadable(query),
        query,
      };
    }),
    InvoiceAdministrationService.Live
  );

export const loadInvoiceCreationPage = () =>
  runAdministrationPage(
    "invoice-administration.creation-defaults",
    Effect.gen(function* () {
      const administration = yield* InvoiceAdministrationService;
      return yield* administration.getCreationDefaults();
    }),
    InvoiceAdministrationService.Live
  );

export const loadInvoiceAdministrationDetail = (invoiceId: string) =>
  runAdministrationPage(
    "invoice-administration.get",
    Effect.gen(function* () {
      const administration = yield* InvoiceAdministrationService;
      return yield* administration.get(invoiceId, { includeArchived: false });
    }).pipe(
      Effect.catchTag("InvoiceAdministrationNotFoundError", invoiceNotFound)
    ),
    InvoiceAdministrationService.Live
  );

export const loadInvoiceAdministrationPdf = (invoiceId: string) =>
  runAdministrationPage(
    "invoice-administration.pdf",
    Effect.gen(function* () {
      const administration = yield* InvoiceAdministrationService;
      return yield* administration.getPdf(invoiceId, {
        includeArchived: false,
      });
    }).pipe(
      Effect.catchTag("InvoiceAdministrationNotFoundError", invoiceNotFound)
    ),
    InvoiceAdministrationService.Live
  );

export const loadInvoiceAdministrationCorrectiveDocumentPdf = (
  invoiceId: string
) =>
  runAdministrationPage(
    "invoice-administration.corrective-document-pdf",
    Effect.gen(function* () {
      const administration = yield* InvoiceAdministrationService;
      return yield* administration.getCorrectiveDocumentPdf(invoiceId, {
        includeArchived: false,
      });
    }).pipe(
      Effect.catchTag("InvoiceAdministrationNotFoundError", invoiceNotFound)
    ),
    InvoiceAdministrationService.Live
  );

/** An invoice the detail page links to, by its number. */
export type InvoiceAdministrationChainLink = Pick<
  InvoiceAdministrationDetail,
  "id" | "invoiceNumber"
>;

/**
 * The invoice this one replaces and the one replacing it, as the Admin UI
 * links them: a hidden invoice is left out.
 */
export const loadInvoiceAdministrationChainLinks = (
  invoice: Pick<
    InvoiceAdministrationDetail,
    "replacesInvoiceId" | "replacedByInvoiceId"
  >
) =>
  runAdministrationPage(
    "invoice-administration.chain-links",
    Effect.gen(function* () {
      const administration = yield* InvoiceAdministrationService;
      const readLink = (invoiceId: string | null) =>
        invoiceId
          ? administration.get(invoiceId, { includeArchived: false }).pipe(
              Effect.map(
                ({ id, invoiceNumber }): InvoiceAdministrationChainLink => ({
                  id,
                  invoiceNumber,
                })
              ),
              Effect.catchTag("InvoiceAdministrationNotFoundError", () =>
                Effect.succeed(null)
              )
            )
          : Effect.succeed(null);
      const [replaces, replacedBy] = yield* Effect.all(
        [
          readLink(invoice.replacesInvoiceId),
          readLink(invoice.replacedByInvoiceId),
        ],
        { concurrency: "unbounded" }
      );
      return { replaces, replacedBy };
    }),
    InvoiceAdministrationService.Live
  );
