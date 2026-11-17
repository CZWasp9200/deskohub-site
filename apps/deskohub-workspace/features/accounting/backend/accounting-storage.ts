import { Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { AccountingDocumentSnapshots } from "./accounting-document-snapshots";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import { InvoiceRepository } from "./invoice.repository";

/** Both accounting record modules, over the caller's database and keys. */
const accountingRecordModules = InvoiceRepository.Default.pipe(
  Layer.provideMerge(AccountingDocumentSnapshots.Default)
);

/**
 * The accounting records: invoices and payment-time source snapshots, sealed
 * under one key registry over one database client. It bundles layers and has
 * no operations of its own, so each module keeps its interface and invoices
 * keep their numbering transaction. Provide `Live` wherever either module is
 * needed; being one value, it is built once per layer build however many
 * consumers share it.
 */
export const AccountingStorage = {
  /** Both modules, requiring the database and the key registry. */
  Default: accountingRecordModules,
  /** Both modules over the Workspace database and the environment's keys. */
  Live: accountingRecordModules.pipe(
    Layer.provide(
      Layer.merge(
        WorkspaceDatabase.Default,
        AccountingSnapshotKeyService.Default
      )
    )
  ),
} as const;
