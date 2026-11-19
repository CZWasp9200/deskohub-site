import { reservationOrderId } from "@/features/reservation/persistence-contracts";
import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { testEmailAddress } from "@deskohub/test-email";
import { eq, sql } from "drizzle-orm";
import { Data, Effect, Layer } from "effect";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import { accountingDocumentSnapshots, paymentAttempts } from "@/db/schema";
import {
  type AccountingDocumentSnapshot,
  accountingSnapshotKeyIdSchema,
  encodeStoredAccountingDocumentSnapshot,
  makeAccountingDocumentSnapshot,
} from "@/features/accounting/accounting-document-snapshot";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { moneyWithValue } from "@/shared/money/money";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  AccountingDocumentSnapshots,
  type AccountingRecordReference,
} from "./accounting-document-snapshots";
import { recordAccountingDocumentSnapshot } from "./accounting-document-snapshots.test-utils";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyError,
  AccountingSnapshotKeyService,
  type IAccountingSnapshotKeyService,
} from "./accounting-snapshot-key.service";
import { testAccountingStorage } from "./accounting-storage.test-utils";

// The suite owns its database: paid snapshots it records can't be deleted.
const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "accounting_document_snapshots"
);
afterAll(() => testDatabase?.close());

const testKey: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K202608"),
  secret: "SYNTHETIC-ACCOUNTING-SNAPSHOTS-KEY",
};

const makeKeys = (
  overrides: Partial<IAccountingSnapshotKeyService> = {}
): IAccountingSnapshotKeyService => ({
  getActive: Effect.succeed(testKey),
  getById: () => Effect.succeed(testKey),
  ...overrides,
});

const run = <A, E>(
  effect: Effect.Effect<A, E, AccountingDocumentSnapshots | WorkspaceDatabase>,
  keys: IAccountingSnapshotKeyService = makeKeys()
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.merge(
          testDatabase!.layer,
          testAccountingStorage(
            testDatabase!.layer,
            Layer.succeed(
              AccountingSnapshotKeyService,
              AccountingSnapshotKeyService.of(keys)
            )
          )
        )
      )
    )
  );

const inTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(WorkspaceDatabase, ({ transaction }) => transaction(effect));

const coworkOrder = { entryTier: "open-space", coffee: true } as const;

/** A held reservation and the snapshot checkout would freeze for it. */
const createReservation = async () => {
  const dotyposCustomerId = DotyposCustomerIdSchema.make(
    `accounting-snapshots-customer-${randomUUID()}`
  );
  const dotyposReservationId = DotyposReservationIdSchema.make(
    `accounting-snapshots-reservation-${randomUUID()}`
  );
  const reservation = await Effect.runPromise(
    workspaceFixtures(testDatabase!.db).reservation({
      stage: { reservation: "held", payment: "not_started" },
      customer: dotyposCustomerId,
      overrides: { dotyposReservationId },
    })
  );
  const snapshot = makeAccountingDocumentSnapshot({
    workspaceReservationId: reservation.id,
    dotyposReservationId,
    dotyposCustomerId,
    locale: "en-US",
    prepared: {
      kind: "cowork",
      reservation: {
        kind: "cowork",
        ...coworkOrder,
        date: "2099-01-01",
        name: "Synthetic Snapshot Customer",
        email: testEmailAddress("accounting-document-snapshots"),
        phone: "+420 700 000 000",
      },
      quote: buildCoworkReservationQuote(coworkOrder),
    } as PreparedCustomerQuote,
  });
  return { reservationId: reservation.id, snapshot };
};

const providerOrderReference = (): AccountingRecordReference => ({
  type: "providerOrderId",
  id: NexiOrderIdSchema.make(`synthetic-order-${randomUUID()}`),
});

const prepareFor = (
  snapshot: AccountingDocumentSnapshot,
  reference: AccountingRecordReference,
  overrides: Partial<{
    readonly snapshot: AccountingDocumentSnapshot;
    readonly orderId: ReturnType<typeof reservationOrderId>;
    readonly amount: AccountingDocumentSnapshot["quote"]["payment"]["expectedPrice"];
    readonly locale: AccountingDocumentSnapshot["locale"];
  }> = {}
) =>
  Effect.flatMap(AccountingDocumentSnapshots, (snapshots) =>
    snapshots.prepare({
      snapshot,
      orderId: reservationOrderId(snapshot.workspaceReservationId),
      amount: snapshot.quote.payment.expectedPrice,
      locale: snapshot.locale,
      reference,
      ...overrides,
    })
  );

/** Inserts the attempt a snapshot is recorded for, in the caller's transaction. */
const insertAttempt = (snapshot: AccountingDocumentSnapshot) =>
  Effect.gen(function* () {
    const { db } = yield* WorkspaceTransaction;
    const id = paymentAttemptIdSchema.make(randomUUID());
    yield* db.insert(paymentAttempts).values({
      id,
      workspaceReservationId: snapshot.workspaceReservationId,
      provider: "nexi",
      providerOrderId: NexiOrderIdSchema.make(`synthetic-order-${id}`),
      state: "created",
      amountValue: snapshot.quote.payment.expectedPrice.value,
      amountExponent: snapshot.quote.payment.expectedPrice.exponent,
      currency: snapshot.quote.payment.expectedPrice.currency,
    });
    return id;
  });

const providerIdentity = (snapshot: AccountingDocumentSnapshot) => ({
  dotyposCustomerId: snapshot.dotyposCustomerId,
  dotyposReservationId: snapshot.dotyposReservationId,
});

const storedRows = async (
  workspaceReservationId: AccountingDocumentSnapshot["workspaceReservationId"]
) => {
  const [attempts, snapshots] = await Promise.all([
    Effect.runPromise(
      testDatabase!.db
        .select({ id: paymentAttempts.id })
        .from(paymentAttempts)
        .where(
          eq(paymentAttempts.workspaceReservationId, workspaceReservationId)
        )
    ),
    Effect.runPromise(
      testDatabase!.db
        .select({
          paymentAttemptId: accountingDocumentSnapshots.paymentAttemptId,
          keyId: accountingDocumentSnapshots.keyId,
        })
        .from(accountingDocumentSnapshots)
        .where(
          eq(
            accountingDocumentSnapshots.workspaceReservationId,
            workspaceReservationId
          )
        )
    ),
  ]);
  return { attempts, snapshots };
};

class CallerFailure extends Data.TaggedError("CallerFailure") {}

describe("AccountingDocumentSnapshots.prepare", () => {
  test("accepts a snapshot that matches its attempt, and record seals it under the active key", async () => {
    const { reservationId, snapshot } = await createReservation();

    const paymentAttemptId = await run(
      Effect.gen(function* () {
        const prepared = yield* prepareFor(snapshot, providerOrderReference());
        expect(prepared.snapshot).toEqual(snapshot);
        return yield* inTransaction(
          Effect.gen(function* () {
            const id = yield* insertAttempt(snapshot);
            yield* prepared.record({
              paymentAttemptId: id,
              ...providerIdentity(snapshot),
            });
            return id;
          })
        );
      })
    );

    expect(await storedRows(reservationId)).toEqual({
      attempts: [{ id: paymentAttemptId }],
      snapshots: [{ paymentAttemptId, keyId: testKey.id }],
    });
    const [stored] = await Effect.runPromise(
      testDatabase!.db
        .select({
          json: sql<string>`pgp_sym_decrypt(${accountingDocumentSnapshots.encryptedSnapshot}, ${testKey.secret})`,
        })
        .from(accountingDocumentSnapshots)
        .where(
          eq(accountingDocumentSnapshots.paymentAttemptId, paymentAttemptId)
        )
    );
    expect(stored?.json).toBe(
      JSON.stringify(encodeStoredAccountingDocumentSnapshot(snapshot))
    );
  });

  const mismatches: readonly {
    readonly name: string;
    readonly change: (
      snapshot: AccountingDocumentSnapshot
    ) => Parameters<typeof prepareFor>[2];
  }[] = [
    {
      name: "a snapshot with a property its schema doesn't declare",
      change: (snapshot) => ({
        snapshot: { ...snapshot, unexpected: true } as never,
      }),
    },
    {
      name: "another reservation's snapshot",
      change: () => ({
        orderId: reservationOrderId(
          workspaceReservationIdSchema.make(randomUUID())
        ),
      }),
    },
    {
      name: "a snapshot in another locale",
      change: () => ({ locale: "cs-CZ" }),
    },
    {
      name: "a snapshot for another amount",
      change: (snapshot) => ({
        amount: moneyWithValue(
          snapshot.quote.payment.expectedPrice.value + 1,
          snapshot.quote.payment.expectedPrice
        ),
      }),
    },
    {
      name: "a snapshot whose items don't add up to its price",
      change: (snapshot) => {
        const [first, ...rest] = snapshot.quote.items;
        return {
          snapshot: {
            ...snapshot,
            quote: {
              ...snapshot.quote,
              items: [
                {
                  ...first!,
                  amount: moneyWithValue(
                    first!.amount.value + 1,
                    first!.amount
                  ),
                },
                ...rest,
              ],
            },
          } as AccountingDocumentSnapshot,
        };
      },
    },
    {
      name: "a snapshot priced in another currency than its items",
      change: (snapshot) => ({
        snapshot: {
          ...snapshot,
          quote: {
            ...snapshot.quote,
            payment: {
              ...snapshot.quote.payment,
              undiscountedPrice: {
                ...snapshot.quote.payment.undiscountedPrice,
                exponent: snapshot.quote.payment.undiscountedPrice.exponent + 1,
              },
            },
          },
        } as AccountingDocumentSnapshot,
      }),
    },
  ];

  for (const mismatch of mismatches) {
    test(`refuses ${mismatch.name} without taking a key`, async () => {
      const { snapshot } = await createReservation();
      const reference = providerOrderReference();
      const getActive = mock(() => Effect.succeed(testKey));

      const failure = await run(
        Effect.flip(prepareFor(snapshot, reference, mismatch.change(snapshot))),
        makeKeys({ getActive: Effect.suspend(getActive) })
      );

      expect(failure).toEqual(
        expect.objectContaining({
          _tag: "AccountingRecordUnavailable",
          operation: "validate",
          reference,
        })
      );
      expect(failure.cause).toBeUndefined();
      expect(getActive).not.toHaveBeenCalled();
    });
  }
});

describe("AccountingDocumentSnapshots.record", () => {
  const identityMismatches = [
    {
      name: "customer",
      change: (snapshot: AccountingDocumentSnapshot) => ({
        ...providerIdentity(snapshot),
        dotyposCustomerId: DotyposCustomerIdSchema.make(randomUUID()),
      }),
    },
    {
      name: "Dotypos reservation",
      change: (snapshot: AccountingDocumentSnapshot) => ({
        ...providerIdentity(snapshot),
        dotyposReservationId: null,
      }),
    },
  ] as const;

  for (const mismatch of identityMismatches) {
    test(`refuses a reservation with another ${mismatch.name} and rolls the caller's attempt back`, async () => {
      const { reservationId, snapshot } = await createReservation();
      const reference = providerOrderReference();

      const failure = await run(
        Effect.flip(
          Effect.gen(function* () {
            const prepared = yield* prepareFor(snapshot, reference);
            yield* inTransaction(
              Effect.gen(function* () {
                const paymentAttemptId = yield* insertAttempt(snapshot);
                yield* prepared.record({
                  paymentAttemptId,
                  ...mismatch.change(snapshot),
                });
              })
            );
          })
        )
      );

      expect(failure).toEqual(
        expect.objectContaining({
          _tag: "AccountingRecordUnavailable",
          operation: "validate",
          reference,
        })
      );
      expect(await storedRows(reservationId)).toEqual({
        attempts: [],
        snapshots: [],
      });
    });
  }

  test("needs no key to prepare; record refuses without one, naming the attempt by the prepared reference, and rolls the attempt back", async () => {
    const { reservationId, snapshot } = await createReservation();
    const reference = providerOrderReference();
    const noKey = makeKeys({
      getActive: Effect.fail(
        new AccountingSnapshotKeyError({
          keyId: testKey.id,
          message: "Synthetic key is unavailable.",
        })
      ),
    });

    const failure = await run(
      Effect.flip(
        Effect.gen(function* () {
          const prepared = yield* prepareFor(snapshot, reference);
          expect(prepared.snapshot).toEqual(snapshot);
          yield* inTransaction(
            Effect.gen(function* () {
              const paymentAttemptId = yield* insertAttempt(snapshot);
              yield* prepared.record({
                paymentAttemptId,
                ...providerIdentity(snapshot),
              });
            })
          );
        })
      ),
      noKey
    );

    expect(failure).toMatchObject({
      _tag: "AccountingRecordUnavailable",
      operation: "encrypt",
      reference,
    });
    expect(JSON.stringify(failure)).not.toContain(testKey.secret);
    expect(await storedRows(reservationId)).toEqual({
      attempts: [],
      snapshots: [],
    });
  });

  test("rolls back with the caller's transaction", async () => {
    const { reservationId, snapshot } = await createReservation();

    const failure = await run(
      Effect.flip(
        Effect.gen(function* () {
          const prepared = yield* prepareFor(
            snapshot,
            providerOrderReference()
          );
          yield* inTransaction(
            Effect.gen(function* () {
              const paymentAttemptId = yield* insertAttempt(snapshot);
              yield* prepared.record({
                paymentAttemptId,
                ...providerIdentity(snapshot),
              });
              return yield* new CallerFailure();
            })
          );
        })
      )
    );

    expect(failure).toBeInstanceOf(CallerFailure);
    expect(await storedRows(reservationId)).toEqual({
      attempts: [],
      snapshots: [],
    });
  });

  test("reports a failed insert as an encrypt failure of the attempt, without its statement", async () => {
    const { snapshot } = await createReservation();
    const paymentAttemptId = await run(
      inTransaction(
        Effect.gen(function* () {
          const id = yield* insertAttempt(snapshot);
          yield* recordAccountingDocumentSnapshot({
            paymentAttemptId: id,
            snapshot,
          });
          return id;
        })
      )
    );

    // A second snapshot for the same attempt violates its unique key.
    const failure = await run(
      Effect.flip(
        inTransaction(
          recordAccountingDocumentSnapshot({ paymentAttemptId, snapshot })
        )
      )
    );

    expect(failure).toMatchObject({
      _tag: "AccountingRecordUnavailable",
      operation: "encrypt",
      reference: { type: "paymentAttemptId", id: paymentAttemptId },
    });
    const serialized = JSON.stringify(failure);
    expect(serialized).not.toContain(testKey.secret);
    expect(serialized).not.toContain("pgp_sym_encrypt");
    expect(serialized).not.toContain("Synthetic Snapshot Customer");
  });
});

describe("AccountingDocumentSnapshots.find", () => {
  test("reads the recorded snapshot back", async () => {
    const { snapshot } = await createReservation();

    const found = await run(
      Effect.gen(function* () {
        const paymentAttemptId = yield* inTransaction(
          Effect.gen(function* () {
            const id = yield* insertAttempt(snapshot);
            yield* recordAccountingDocumentSnapshot({
              paymentAttemptId: id,
              snapshot,
            });
            return id;
          })
        );
        const snapshots = yield* AccountingDocumentSnapshots;
        return yield* snapshots.find(paymentAttemptId);
      })
    );

    expect(found).toEqual(snapshot);
  });

  test("finds nothing for an attempt without a snapshot", async () => {
    const found = await run(
      Effect.flatMap(AccountingDocumentSnapshots, (snapshots) =>
        snapshots.find(paymentAttemptIdSchema.make(randomUUID()))
      )
    );

    expect(found).toBeNull();
  });
});
