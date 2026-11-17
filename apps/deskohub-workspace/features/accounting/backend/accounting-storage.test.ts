import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { AccountingDocumentSnapshots } from "./accounting-document-snapshots";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import { testAccountingStorage } from "./accounting-storage.test-utils";
import { InvoiceRepository } from "./invoice.repository";

const testKey = {
  id: accountingSnapshotKeyIdSchema.make("K202611"),
  secret: "SYNTHETIC-ACCOUNTING-STORAGE-KEY",
};

/** A database and a key registry that count how often they are built. */
const makeCountingDependencies = async () => {
  const recording = await makeRecordingWorkspaceDatabase();
  const builds = { database: 0, keys: 0 };
  const database = Layer.effect(
    WorkspaceDatabase,
    Effect.sync(() => {
      builds.database += 1;
      return WorkspaceDatabase.make(recording.db);
    })
  );
  const keys = Layer.effect(
    AccountingSnapshotKeyService,
    Effect.sync(() => {
      builds.keys += 1;
      return AccountingSnapshotKeyService.of({
        getActive: Effect.succeed(testKey),
        getById: () => Effect.succeed(testKey),
      });
    })
  );
  return { builds, database, keys };
};

const usesInvoices = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* InvoiceRepository;
  })
);
const usesSnapshots = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* AccountingDocumentSnapshots;
  })
);
const usesDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* WorkspaceDatabase;
  })
);

const buildOnce = <E>(graph: Layer.Layer<never, E>) =>
  Effect.runPromise(Effect.scoped(Layer.build(graph)));

describe("AccountingStorage", () => {
  test("one build of a graph using both modules builds the database client and the key registry once", async () => {
    const { builds, database, keys } = await makeCountingDependencies();
    const storage = testAccountingStorage(database, keys);

    await buildOnce(
      Layer.mergeAll(
        usesInvoices.pipe(Layer.provide(storage)),
        usesSnapshots.pipe(Layer.provide(storage)),
        usesDatabase.pipe(Layer.provide(database))
      )
    );

    expect(builds).toEqual({ database: 1, keys: 1 });
  });

  test("a storage built apart from the graph builds its own client and registry", async () => {
    const { builds, database, keys } = await makeCountingDependencies();
    const storage = testAccountingStorage(database, keys);

    await buildOnce(
      Layer.mergeAll(
        usesInvoices.pipe(Layer.provide(storage)),
        usesSnapshots.pipe(Layer.provide(Layer.fresh(storage)))
      )
    );

    expect(builds).toEqual({ database: 2, keys: 2 });
  });
});
