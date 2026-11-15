import { Layer } from "effect";
import type { WorkspaceDatabase } from "@/db/database.service";
import type { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import { AccountingStorage } from "./accounting-storage";

/**
 * Both accounting record modules over a test database and test keys,
 * composed as `AccountingStorage.Live` composes them in production. Pass the
 * suite's own database layer so the modules share its client.
 */
export const testAccountingStorage = <E1, R1, E2, R2>(
  database: Layer.Layer<WorkspaceDatabase, E1, R1>,
  keys: Layer.Layer<AccountingSnapshotKeyService, E2, R2>
) => AccountingStorage.Default.pipe(Layer.provide(Layer.merge(database, keys)));
