import type { AdministrationOperationReference } from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Option, Schema } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { InvoicePreviews } from "@/features/accounting/admin/invoice-previews.service";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { administrationHref } from "@/features/administration/administration-href";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";

/** Where the administrator can open a document a tool answered with. */
export interface AdministrationDocumentLink {
  readonly url: string;
  readonly expiresAt: Temporal.Instant;
}

/** A binary result of one administration operation, for the account it was read for. */
export interface AdministrationDocument {
  readonly reference: string;
  readonly args: Schema.JsonObject;
  readonly bytes: Uint8Array;
  readonly administratorAccountId: CustomerAccountId;
}

const previewInvoiceReference =
  "administration.previewInvoice" satisfies AdministrationOperationReference;

/**
 * Links binary results to a page of the Admin UI, for agents whose hosts
 * can't show an embedded document. An invoice preview exists nowhere else,
 * so it is kept, encrypted and owner-bound, for a short while. Other
 * documents get no link. Keeping a preview can fail without failing the
 * call: the document is still attached.
 */
export class AdministrationAgentDocuments extends Context.Service<
  AdministrationAgentDocuments,
  {
    readonly link: (
      document: AdministrationDocument
    ) => Effect.Effect<Option.Option<AdministrationDocumentLink>>;
  }
>()(
  "@deskohub-workspace/administration-agent-tools/AdministrationAgentDocuments"
) {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const previews = yield* InvoicePreviews;
      const keepPreview = Effect.fn("AdministrationAgentDocuments.keepPreview")(
        function* (document: AdministrationDocument) {
          const invoiceId = yield* Schema.decodeUnknownEffect(invoiceIdSchema)(
            document.args.invoiceId
          );
          const kept = yield* previews.keep({
            invoiceId,
            administratorAccountId: document.administratorAccountId,
            document: document.bytes,
          });
          const origin = yield* getWorkspaceRuntimeCallbackOrigin;
          const path = administrationHref(
            "/[locale]/admin/invoice-previews/[previewId]",
            { previewId: kept.id }
          );
          return Option.some<AdministrationDocumentLink>({
            url: new URL(path, origin).toString(),
            expiresAt: kept.expiresAt,
          });
        },
        Effect.catch((error) =>
          Effect.logWarning("Could not keep an invoice preview to link", {
            error,
          }).pipe(Effect.as(Option.none<AdministrationDocumentLink>()))
        )
      );
      return {
        link: (document) =>
          document.reference === previewInvoiceReference
            ? keepPreview(document)
            : Effect.succeedNone,
      };
    })
  );
  static Live = this.Default.pipe(Layer.provide(InvoicePreviews.Live));
}
