import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { testEmailAddress } from "@deskohub/test-email";
import { eq, sql } from "drizzle-orm";
import {
  Effect,
  Layer,
  Logger,
  Option,
  References,
  Result,
  Tracer,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  accountingDocumentSnapshots,
  invoices,
  paymentAttempts,
} from "@/db/schema";
import { type DatabaseQueryError, findSqlState } from "@/db/sql-constraint";
import {
  type AccountingDocumentSnapshot,
  accountingSnapshotKeyIdSchema,
  encodeStoredAccountingDocumentSnapshot,
  makeAccountingDocumentSnapshot,
} from "@/features/accounting/accounting-document-snapshot";
import { makeTestManualInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import {
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote.test-utils";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { censorDatabaseQueryParams } from "@/shared/backend/logging/censorship";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { CENSORED_LOG_VALUE } from "@/shared/utils/log-classification";
import { sealedAccountingDocumentSnapshots } from "./accounting-document-snapshots";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyError,
  AccountingSnapshotKeyService,
  type IAccountingSnapshotKeyService,
} from "./accounting-snapshot-key.service";
import { sealedInvoiceDocuments } from "./invoice-reads";
import {
  type AccountingRecordReference,
  isUndecryptableRecord,
} from "./sealed-accounting-json";

// The suite owns its database, so raw rows it plants never reach other suites.
const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "sealed_accounting_json"
);
afterAll(() => testDatabase?.close());

const keySecret = "SYNTHETIC-SEALED-ACCOUNTING-KEY-SENTINEL";
const testKey: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K202608"),
  secret: keySecret,
};
const otherKey: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K209912"),
  secret: "SYNTHETIC-OTHER-ACCOUNTING-KEY-SENTINEL",
};
const pgcryptoOptions = "cipher-algo=aes256,compress-algo=1,unicode-mode=1";
// Appears in every sealed document, so a leak of the plaintext is visible.
const plaintextSentinel = "SYNTHETIC-SEALED-PLAINTEXT-SENTINEL";

const makeKeys = (
  overrides: Partial<IAccountingSnapshotKeyService> = {}
): IAccountingSnapshotKeyService => ({
  getActive: Effect.succeed(testKey),
  getById: (keyId) =>
    keyId === testKey.id
      ? Effect.succeed(testKey)
      : Effect.fail(
          new AccountingSnapshotKeyError({
            keyId,
            message: "Synthetic key is unavailable.",
          })
        ),
  ...overrides,
});

const coworkOrder = {
  entryTier: "open-space",
  coffee: true,
} satisfies CoworkReservationQuoteOrder;
const prepared = {
  kind: "cowork",
  reservation: {
    kind: "cowork",
    ...coworkOrder,
    date: "2099-01-01",
    name: plaintextSentinel,
    email: testEmailAddress("sealed-accounting-json"),
    phone: "+420 700 000 000",
  },
  quote: buildCoworkReservationQuote(coworkOrder),
} as PreparedCustomerQuote;

const snapshotReference = (
  id: PaymentAttemptId
): AccountingRecordReference => ({ type: "paymentAttemptId", id });

const withKeys = <A, E>(
  effect: Effect.Effect<A, E, WorkspaceDatabase | AccountingSnapshotKeyService>,
  database: Layer.Layer<WorkspaceDatabase>,
  keys: IAccountingSnapshotKeyService = makeKeys()
) =>
  effect.pipe(
    Effect.provide(
      Layer.merge(
        database,
        Layer.succeed(
          AccountingSnapshotKeyService,
          AccountingSnapshotKeyService.of(keys)
        )
      )
    )
  );

const sealSnapshot = (input: {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: AccountingDocumentSnapshot["workspaceReservationId"];
  readonly snapshot: AccountingDocumentSnapshot;
}) =>
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;
    const snapshots = yield* sealedAccountingDocumentSnapshots;
    const reference = snapshotReference(input.paymentAttemptId);
    const sealer = yield* snapshots.sealer(reference);
    yield* sealer.seal({
      reference,
      value: input.snapshot,
      insert: (sealed) =>
        db.insert(accountingDocumentSnapshots).values({
          paymentAttemptId: input.paymentAttemptId,
          workspaceReservationId: input.workspaceReservationId,
          keyId: sealed.keyId,
          encryptedSnapshot: sealed.ciphertext,
        }),
    });
  });

const openSnapshot = (paymentAttemptId: PaymentAttemptId) =>
  Effect.gen(function* () {
    const snapshots = yield* sealedAccountingDocumentSnapshots;
    return yield* snapshots.open({
      reference: snapshotReference(paymentAttemptId),
      where: eq(accountingDocumentSnapshots.paymentAttemptId, paymentAttemptId),
    });
  });

describe("sealed accounting JSON statements", () => {
  test("binds the plaintext and every key only as sensitive parameters", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    const paymentAttemptId = paymentAttemptIdSchema.make("attempt-1");
    const snapshot = makeAccountingDocumentSnapshot({
      workspaceReservationId:
        workspaceReservationIdSchema.make("reservation-1"),
      dotyposReservationId: DotyposReservationIdSchema.make("dotypos-1"),
      dotyposCustomerId: DotyposCustomerIdSchema.make("customer-1"),
      locale: "en-US",
      prepared,
    });
    recording.setRows([[], [[testKey.id]], []]);

    const opened = await Effect.runPromise(
      withKeys(
        Effect.gen(function* () {
          yield* sealSnapshot({
            paymentAttemptId,
            workspaceReservationId: snapshot.workspaceReservationId,
            snapshot,
          });
          return yield* Effect.flip(openSnapshot(paymentAttemptId));
        }),
        recording.layer
      )
    );

    const storedJson = JSON.stringify(
      encodeStoredAccountingDocumentSnapshot(snapshot)
    );
    expect(recording.statements).toEqual([
      {
        sql: 'insert into "accounting_document_snapshots" ("payment_attempt_id", "workspace_reservation_id", "key_id", "encrypted_snapshot", "created_at") values ($1, $2, $3, pgp_sym_encrypt(/* deskohub:sensitive */ $4, /* deskohub:sensitive */ $5, $6), default)',
        params: [
          paymentAttemptId,
          snapshot.workspaceReservationId,
          testKey.id,
          storedJson,
          keySecret,
          pgcryptoOptions,
        ],
      },
      {
        sql: 'select "key_id" from "accounting_document_snapshots" where "accounting_document_snapshots"."payment_attempt_id" = $1 limit $2',
        params: [paymentAttemptId, 1],
      },
      {
        sql: 'select pgp_sym_decrypt("encrypted_snapshot", /* deskohub:sensitive */ $1) from "accounting_document_snapshots" where "accounting_document_snapshots"."payment_attempt_id" = $2 limit $3',
        params: [keySecret, paymentAttemptId, 1],
      },
    ]);
    expect(
      recording.statements.map(({ sql, params }) =>
        censorDatabaseQueryParams(sql, params)
      )
    ).toEqual([
      [
        paymentAttemptId,
        snapshot.workspaceReservationId,
        testKey.id,
        CENSORED_LOG_VALUE,
        CENSORED_LOG_VALUE,
        pgcryptoOptions,
      ],
      [paymentAttemptId, 1],
      [CENSORED_LOG_VALUE, paymentAttemptId, 1],
    ]);
    // The row went missing between the key lookup and the decryption.
    expect(opened).toMatchObject({
      _tag: "AccountingRecordUnavailable",
      operation: "load",
      reference: { type: "paymentAttemptId", id: paymentAttemptId },
    });
  });

  test("reads the invoice's plaintext columns in the decrypting statement", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    const invoiceId = "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23";
    recording.setRows([[[testKey.id]], []]);

    await Effect.runPromise(
      withKeys(
        Effect.gen(function* () {
          const documents = yield* sealedInvoiceDocuments;
          return yield* documents.open({
            reference: {
              type: "invoiceId",
              id: invoiceIdSchema.make(invoiceId),
            },
            where: eq(invoices.id, invoiceId),
          });
        }).pipe(Effect.flip),
        recording.layer
      )
    );

    expect(recording.statements.map(({ sql }) => sql)).toEqual([
      'select "key_id" from "invoices" where "invoices"."id" = $1 limit $2',
      'select "id", "workspace_reservation_id", "payment_attempt_id", "dotypos_customer_id", "invoice_number", "issued_at"::text, pgp_sym_decrypt("encrypted_document", /* deskohub:sensitive */ $1) from "invoices" where "invoices"."id" = $2 limit $3',
    ]);
  });
});

describe.skipIf(!testDatabase)("sealed accounting JSON in PostgreSQL", () => {
  const postgres = testDatabase!;
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      WorkspaceDatabase | AccountingSnapshotKeyService
    >,
    keys?: IAccountingSnapshotKeyService
  ) => Effect.runPromise(withKeys(effect, postgres.layer, keys));

  const createAttempt = async () => {
    const paymentAttemptId = paymentAttemptIdSchema.make(randomUUID());
    const dotyposCustomerId = DotyposCustomerIdSchema.make(
      `sealed-accounting-customer-${randomUUID()}`
    );
    const dotyposReservationId = DotyposReservationIdSchema.make(
      `sealed-accounting-reservation-${randomUUID()}`
    );
    const reservation = await Effect.runPromise(
      workspaceFixtures(postgres.db).reservation({
        stage: { reservation: "held", payment: "pending" },
        customer: dotyposCustomerId,
        overrides: { dotyposReservationId },
      })
    );
    const snapshot = makeAccountingDocumentSnapshot({
      workspaceReservationId: reservation.id,
      dotyposReservationId,
      dotyposCustomerId,
      locale: "en-US",
      prepared,
    });
    await Effect.runPromise(
      postgres.db.insert(paymentAttempts).values({
        id: paymentAttemptId,
        workspaceReservationId: reservation.id,
        provider: "nexi",
        providerOrderId: NexiOrderIdSchema.make(
          `synthetic-order-${randomUUID()}`
        ),
        state: "pending",
        amountValue: snapshot.quote.payment.expectedPrice.value,
        amountExponent: snapshot.quote.payment.expectedPrice.exponent,
        currency: snapshot.quote.payment.expectedPrice.currency,
      })
    );
    return { paymentAttemptId, reservationId: reservation.id, snapshot };
  };

  const createSealedSnapshot = async () => {
    const attempt = await createAttempt();
    await run(
      sealSnapshot({
        paymentAttemptId: attempt.paymentAttemptId,
        workspaceReservationId: attempt.reservationId,
        snapshot: attempt.snapshot,
      })
    );
    return attempt;
  };

  // Decrypts with the test key in SQL, outside the codec.
  const readStoredSnapshotJson = (paymentAttemptId: PaymentAttemptId) =>
    Effect.runPromise(
      postgres.db
        .select({
          json: sql<string>`pgp_sym_decrypt(${accountingDocumentSnapshots.encryptedSnapshot}, ${keySecret})`,
        })
        .from(accountingDocumentSnapshots)
        .where(
          eq(accountingDocumentSnapshots.paymentAttemptId, paymentAttemptId)
        )
    ).then(([row]) => row?.json);

  // Plants a row whose ciphertext holds `json`, as no codec would seal it.
  const plantSnapshotJson = async (json: string) => {
    const attempt = await createAttempt();
    await Effect.runPromise(
      postgres.db.insert(accountingDocumentSnapshots).values({
        paymentAttemptId: attempt.paymentAttemptId,
        workspaceReservationId: attempt.reservationId,
        keyId: testKey.id,
        encryptedSnapshot: sql`pgp_sym_encrypt(${json}, ${keySecret}, ${pgcryptoOptions})`,
      })
    );
    return attempt.paymentAttemptId;
  };

  const expectNoSecrets = <T>(value: T) => {
    const text = JSON.stringify(value);
    expect(text).not.toContain(keySecret);
    expect(text).not.toContain(plaintextSentinel);
    expect(text).not.toContain("pgp_sym");
  };

  test("opens a snapshot it sealed and stores the snapshot's JSON as written", async () => {
    const attempt = await createSealedSnapshot();

    const opened = await run(openSnapshot(attempt.paymentAttemptId));

    expect(opened).toEqual({ value: attempt.snapshot, plaintext: {} });
    expect(await readStoredSnapshotJson(attempt.paymentAttemptId)).toBe(
      JSON.stringify(encodeStoredAccountingDocumentSnapshot(attempt.snapshot))
    );
  });

  test("opens an invoice document it sealed with the row's plaintext columns", async () => {
    const document = makeTestManualInvoiceDocument("en-US");
    const invoiceId = document.invoiceId;
    const reference = { type: "invoiceId", id: invoiceId } as const;
    const issuedAt = Temporal.Instant.from(document.issuedAt);

    const opened = await run(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const documents = yield* sealedInvoiceDocuments;
        const sealer = yield* documents.sealer(reference);
        yield* sealer.seal({
          reference,
          value: document,
          insert: (sealed) =>
            db.insert(invoices).values({
              id: invoiceId,
              workspaceReservationId: null,
              paymentAttemptId: null,
              dotyposCustomerId: document.dotyposCustomerId,
              invoiceNumber: document.invoiceNumber,
              numberingYear: 2026,
              numberingSequence: 42,
              keyId: sealed.keyId,
              encryptedDocument: sealed.ciphertext,
              issuedAt,
            }),
        });
        return yield* documents.open({
          reference,
          where: eq(invoices.id, invoiceId),
        });
      })
    );

    expect(opened).toEqual({
      value: document,
      plaintext: {
        id: invoiceId,
        workspaceReservationId: null,
        paymentAttemptId: null,
        dotyposCustomerId: document.dotyposCustomerId,
        invoiceNumber: document.invoiceNumber,
        issuedAt,
      },
    });
    const [stored] = await Effect.runPromise(
      postgres.db
        .select({
          json: sql<string>`pgp_sym_decrypt(${invoices.encryptedDocument}, ${keySecret})`,
        })
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
    );
    expect(stored?.json).toBe(JSON.stringify(document));
  });

  test("reads a missing record as null", async () => {
    expect(
      await run(openSnapshot(paymentAttemptIdSchema.make(randomUUID())))
    ).toBeNull();
  });

  test("runs the encrypting and decrypting statements untraced", async () => {
    const attempt = await createAttempt();
    const spans: Tracer.Span[] = [];
    const nativeTracer = Tracer.Tracer.defaultValue();
    const tracer = Tracer.make({
      span: (options) => {
        const span = nativeTracer.span(options);
        if (span._tag === "Span") spans.push(span);
        return span;
      },
    });

    await run(
      Effect.gen(function* () {
        yield* sealSnapshot({
          paymentAttemptId: attempt.paymentAttemptId,
          workspaceReservationId: attempt.reservationId,
          snapshot: attempt.snapshot,
        });
        return yield* openSnapshot(attempt.paymentAttemptId);
      }).pipe(Effect.withTracer(tracer))
    );

    const traced = spans.map((span) => ({
      name: span.name,
      attributes: Object.fromEntries(span.attributes),
    }));
    // The key lookup is traced, so tracing was on.
    expect(JSON.stringify(traced)).toContain("key_id");
    expectNoSecrets(traced);
  });

  test("logs the statements with the plaintext and keys censored", async () => {
    const attempt = await createAttempt();
    const logged: unknown[] = [];
    const captureLogger = Logger.make(({ fiber, message }) => {
      logged.push({
        message,
        annotations: fiber.getRef(References.CurrentLogAnnotations),
      });
    });

    await run(
      Effect.gen(function* () {
        yield* sealSnapshot({
          paymentAttemptId: attempt.paymentAttemptId,
          workspaceReservationId: attempt.reservationId,
          snapshot: attempt.snapshot,
        });
        return yield* openSnapshot(attempt.paymentAttemptId);
      }).pipe(
        Effect.provideService(References.MinimumLogLevel, "All"),
        Effect.provide(Logger.layer([captureLogger]))
      )
    );

    const text = JSON.stringify(logged);
    // Debug query rows carry the SQL text, so both statements were logged.
    expect(text).toContain("pgp_sym_encrypt");
    expect(text).toContain("pgp_sym_decrypt");
    expect(text).toContain(CENSORED_LOG_VALUE);
    expect(text).not.toContain(keySecret);
    expect(text).not.toContain(plaintextSentinel);
  });

  test("refuses a record sealed under another key without leaking the cause", async () => {
    const attempt = await createSealedSnapshot();

    const error = await run(
      Effect.flip(openSnapshot(attempt.paymentAttemptId)),
      makeKeys({
        getById: () =>
          Effect.succeed({ id: testKey.id, secret: otherKey.secret }),
      })
    );

    expect(error).toMatchObject({
      _tag: "AccountingRecordUnavailable",
      operation: "decrypt",
      reference: { type: "paymentAttemptId", id: attempt.paymentAttemptId },
      cause: { _tag: "EffectDrizzleQueryError" },
    });
    expect(error.cause).not.toHaveProperty("query");
    expect(error.cause).not.toHaveProperty("params");
    expectNoSecrets(error);
    expect(JSON.stringify(error)).not.toContain(otherKey.secret);
  });

  test("refuses a record whose key is unknown", async () => {
    const attempt = await createSealedSnapshot();

    const error = await run(
      Effect.flip(openSnapshot(attempt.paymentAttemptId)),
      makeKeys({
        getById: (keyId) =>
          Effect.fail(
            new AccountingSnapshotKeyError({
              keyId,
              message: "Synthetic key is unknown.",
            })
          ),
      })
    );

    expect(error).toMatchObject({
      _tag: "AccountingRecordUnavailable",
      operation: "decrypt",
      cause: { _tag: "AccountingSnapshotKeyError" },
    });
    expectNoSecrets(error);
  });

  test.each([
    ["malformed JSON", "{not json"],
    [
      "an unknown property",
      JSON.stringify({
        ...encodeStoredAccountingDocumentSnapshot(
          makeAccountingDocumentSnapshot({
            workspaceReservationId:
              workspaceReservationIdSchema.make("reservation-1"),
            dotyposReservationId: DotyposReservationIdSchema.make("d-1"),
            dotyposCustomerId: DotyposCustomerIdSchema.make("c-1"),
            locale: "en-US",
            prepared,
          })
        ),
        schemaVersion: 1,
      }),
    ],
  ] as const)("refuses a record holding %s", async (_, json) => {
    const paymentAttemptId = await plantSnapshotJson(json);

    const error = await run(Effect.flip(openSnapshot(paymentAttemptId)));

    expect(error).toMatchObject({
      _tag: "AccountingRecordUnavailable",
      operation: "parse",
      reference: { type: "paymentAttemptId", id: paymentAttemptId },
    });
    expect(error).not.toHaveProperty("cause");
    expectNoSecrets(error);
  });

  test("refuses to seal without an active key and writes nothing", async () => {
    const attempt = await createAttempt();

    const error = await run(
      Effect.flip(
        sealSnapshot({
          paymentAttemptId: attempt.paymentAttemptId,
          workspaceReservationId: attempt.reservationId,
          snapshot: attempt.snapshot,
        })
      ),
      makeKeys({
        getActive: Effect.fail(
          new AccountingSnapshotKeyError({
            keyId: testKey.id,
            message: "Synthetic active key is unavailable.",
          })
        ),
      })
    );

    expect(error).toMatchObject({
      _tag: "AccountingRecordUnavailable",
      operation: "encrypt",
      cause: { _tag: "AccountingSnapshotKeyError" },
    });
    expect(await run(openSnapshot(attempt.paymentAttemptId))).toBeNull();
  });

  test("reports a failed insert as an encrypt failure without leaking the cause", async () => {
    // No payment attempt row, so the snapshot's foreign key refuses it.
    const paymentAttemptId = paymentAttemptIdSchema.make(randomUUID());
    const attempt = await createAttempt();

    const result = await run(
      Effect.result(
        sealSnapshot({
          paymentAttemptId,
          workspaceReservationId: attempt.reservationId,
          snapshot: attempt.snapshot,
        })
      )
    );

    expect(Result.isFailure(result)).toBe(true);
    const error = Result.isFailure(result) ? result.failure : undefined;
    expect(error).toMatchObject({
      _tag: "AccountingRecordUnavailable",
      operation: "encrypt",
      reference: { type: "paymentAttemptId", id: paymentAttemptId },
      cause: { _tag: "EffectDrizzleQueryError" },
    });
    expectNoSecrets(error);
  });

  test("tells a record pgcrypto cannot decrypt from a failure of the database", async () => {
    const attempt = await createSealedSnapshot();
    const decryptWith = (secret: string) =>
      postgres.db
        .select({
          json: sql<string>`pgp_sym_decrypt(${accountingDocumentSnapshots.encryptedSnapshot}, ${secret})`,
        })
        .from(accountingDocumentSnapshots)
        .where(
          eq(
            accountingDocumentSnapshots.paymentAttemptId,
            attempt.paymentAttemptId
          )
        );
    const classify = <A>(
      statement: Effect.Effect<A, DatabaseQueryError, WorkspaceDatabase>
    ) =>
      run(
        statement.pipe(
          Effect.flip,
          Effect.map((error) => ({
            sqlState: findSqlState(error),
            undecryptable: isUndecryptableRecord(error),
          }))
        )
      );

    // A wrong key.
    expect(await classify(decryptWith(otherKey.secret))).toEqual({
      sqlState: Option.some("39000"),
      undecryptable: true,
    });
    // Text that isn't valid UTF-8, as invalid decrypted text would fail; the
    // message quotes its bytes. pgcrypto refuses such a message first, so
    // `convert_from` stands in for it.
    expect(
      await classify(
        Effect.flatMap(WorkspaceDatabase, ({ db }) =>
          db.execute(sql`select convert_from('\\xc328'::bytea, 'UTF8')`)
        )
      )
    ).toEqual({ sqlState: Option.some("22021"), undecryptable: true });
    // A statement timeout while decrypting with the right key.
    expect(
      await classify(
        Effect.gen(function* () {
          const { db, transaction } = yield* WorkspaceDatabase;
          return yield* transaction(
            Effect.gen(function* () {
              yield* db.execute(sql`set local statement_timeout = 1`);
              return yield* db.execute(
                sql`select pgp_sym_decrypt(${accountingDocumentSnapshots.encryptedSnapshot}, ${keySecret}), pg_sleep(1) from ${accountingDocumentSnapshots}`
              );
            })
          );
        })
      )
    ).toEqual({ sqlState: Option.some("57014"), undecryptable: false });
  });
});
