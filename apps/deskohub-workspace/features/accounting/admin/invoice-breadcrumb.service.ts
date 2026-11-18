import type { AdministrationInvoiceIdType } from "@deskohub/workspace-admin-api";
import { and, eq, isNull } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoiceArchives, invoices } from "@/db/schema";

interface IInvoiceBreadcrumbService {
  /**
   * The invoice's number, or `null` for an unknown invoice or one hidden from
   * the Admin UI, which the breadcrumb never names.
   */
  readonly getInvoiceNumber: (
    invoiceId: AdministrationInvoiceIdType
  ) => Effect.Effect<string | null, EffectDrizzleQueryError>;
}

export class InvoiceBreadcrumbService extends Context.Service<
  InvoiceBreadcrumbService,
  IInvoiceBreadcrumbService
>()("@deskohub-workspace/accounting/InvoiceBreadcrumbService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const getInvoiceNumber = Effect.fn(
        "InvoiceBreadcrumbService.getInvoiceNumber"
      )(function* (invoiceId: AdministrationInvoiceIdType) {
        const [row] = yield* db
          .select({ invoiceNumber: invoices.invoiceNumber })
          .from(invoices)
          .leftJoin(invoiceArchives, eq(invoiceArchives.invoiceId, invoices.id))
          .where(
            and(eq(invoices.id, invoiceId), isNull(invoiceArchives.invoiceId))
          )
          .limit(1);
        return row?.invoiceNumber ?? null;
      });

      return { getInvoiceNumber } satisfies IInvoiceBreadcrumbService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
