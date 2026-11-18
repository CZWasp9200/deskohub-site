import "server-only";

import { Effect, Option, Schema } from "effect";
import { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
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
import { invoicePreviewIdSchema } from "./invoice-preview-id";
import { InvoicePreviews } from "./invoice-previews.service";

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

/**
 * A preview an administrator's AI agent kept, for that administrator only
 * and until it expires; anything else answers the administration 404.
 */
export const loadInvoicePreviewPdf = (previewId: string) =>
  runAdministrationPage(
    "invoice-administration.preview-pdf",
    Effect.gen(function* () {
      const id = yield* Schema.decodeUnknownEffect(invoicePreviewIdSchema)(
        previewId
      ).pipe(Effect.mapError(() => new AdministrationRecordNotFound()));
      const administrator = yield* CurrentAdministrator;
      const previews = yield* InvoicePreviews;
      const preview = yield* previews.open({
        id,
        administratorAccountId: administrator.accountId,
      });
      return yield* Option.match(preview, {
        onNone: invoiceNotFound,
        onSome: Effect.succeed,
      });
    }),
    InvoicePreviews.Live
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
