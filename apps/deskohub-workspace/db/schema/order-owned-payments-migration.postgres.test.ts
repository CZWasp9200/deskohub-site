import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Effect } from "effect";
import type { Pool } from "pg";
import {
  type DatabasePool,
  makeDatabaseClient,
  makeDatabasePool,
} from "@/db/database-client";
import { createScratchPostgresDatabase } from "@/shared/testing/postgres-scratch-database.test-utils";
import { openDatabasePool } from "@/shared/testing/workspace-database-pool.test-utils";
import {
  fixtureReservationAuthorId,
  type ReservationFixtureInput,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import {
  linkMigrationsBefore,
  workspaceMigrationsFolder,
} from "../migration-scratch-database.test-utils";

const MIGRATION_DIR = "20261118122220_order_owned_payments";

const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

const heldReservation = {
  stage: { reservation: "held", payment: "pending" },
} as const satisfies ReservationFixtureInput;

type ScratchDatabase = {
  readonly pool: Pool;
  /** Seeds a reservation held for payment and returns its ID. */
  readonly reservation: () => Promise<string>;
  readonly migrateRemaining: () => Promise<void>;
};

/**
 * Brings a scratch database to the state production is in before the
 * migration and hands it to `run`, which seeds it and applies the rest.
 */
const beforeMigration = async (
  run: (database: ScratchDatabase) => Promise<void>
) => {
  const earlierMigrations = await linkMigrationsBefore(MIGRATION_DIR);
  const scratch = await createScratchPostgresDatabase(
    testDatabaseUrl!,
    "order_owned_payments"
  );
  const pool = makeDatabasePool({ connectionString: scratch.url, max: 4 });
  let databasePool: DatabasePool | undefined;
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: earlierMigrations,
    });
    await pool.query("insert into customer_accounts (id) values ($1)", [
      fixtureReservationAuthorId,
    ]);
    databasePool = await openDatabasePool({
      connectionString: scratch.url,
      maxConnections: 4,
    });
    const fixtures = workspaceFixtures(
      await Effect.runPromise(makeDatabaseClient(databasePool))
    );
    await run({
      pool,
      reservation: async () =>
        (await Effect.runPromise(fixtures.reservation(heldReservation))).id,
      migrateRemaining: () =>
        migrate(drizzle({ client: pool }), {
          migrationsFolder: workspaceMigrationsFolder,
        }),
    });
  } finally {
    await databasePool?.close();
    await pool.end();
    await scratch.drop();
    await rm(earlierMigrations, { recursive: true, force: true });
  }
};

/** Records legal evidence as writers from before the order key do. */
const insertLegalEvidence = async (
  pool: Pool,
  reservationId: string | null,
  { orderId }: { readonly orderId?: string } = {}
) => {
  const id = crypto.randomUUID();
  await pool.query(
    `insert into legal_evidence_events
       (id, workspace_reservation_id, ${orderId === undefined ? "" : "order_id,"}
        document_key, document_path, document_hash, hash_algorithm, accepted,
        accepted_at, locale, source, acknowledgements)
     values ($1, $2, ${orderId === undefined ? "" : "$3,"}
       'terms', '/legal/terms/v1', 'hash', 'sha256', true, now(), 'en-US',
       'checkout', '{}')`,
    orderId === undefined ? [id, reservationId] : [id, reservationId, orderId]
  );
  return id;
};

const insertAttempt = async (
  pool: Pool,
  reservationId: string | null,
  orderId?: string
) => {
  const id = `attempt-${crypto.randomUUID()}`;
  await pool.query(
    `insert into payment_attempts
       (id, workspace_reservation_id, ${orderId === undefined ? "" : "order_id,"}
        provider, provider_order_id, state,
        amount_value, amount_exponent, currency)
     values ($1, $2, ${orderId === undefined ? "" : "$4,"}
       'nexi', $3, 'pending', 29000, 2, 'CZK')`,
    [
      id,
      reservationId,
      `order-${crypto.randomUUID()}`,
      ...(orderId === undefined ? [] : [orderId]),
    ]
  );
  return id;
};

const legalEvidenceOrder = async (pool: Pool, id: string) =>
  (
    await pool.query<{
      readonly order_id: string | null;
      readonly workspace_reservation_id: string | null;
    }>(
      "select order_id, workspace_reservation_id from legal_evidence_events where id = $1",
      [id]
    )
  ).rows[0];

const attemptOrder = async (pool: Pool, id: string) =>
  (
    await pool.query<{ readonly order_id: string | null }>(
      "select order_id from payment_attempts where id = $1",
      [id]
    )
  ).rows[0]?.order_id;

const failure = async (statement: Promise<unknown>) => {
  try {
    await statement;
  } catch (cause) {
    return cause;
  }
  throw new Error("Expected the statement to fail.");
};

describe.skipIf(!testDatabaseUrl)(
  "order owned payments migration on disposable Postgres",
  () => {
    test("links existing legal evidence and payment attempts to their reservation's order", async () => {
      await beforeMigration(async ({ pool, reservation, migrateRemaining }) => {
        const reservationId = await reservation();
        const evidenceId = await insertLegalEvidence(pool, reservationId);
        const detachedEvidenceId = await insertLegalEvidence(pool, null);
        // An attempt the earlier insert trigger missed.
        await pool.query(
          "alter table payment_attempts disable trigger payment_attempts_order_link"
        );
        const unlinkedAttemptId = await insertAttempt(pool, reservationId);
        await pool.query(
          "alter table payment_attempts enable trigger payment_attempts_order_link"
        );

        await migrateRemaining();

        expect(await legalEvidenceOrder(pool, evidenceId)).toEqual({
          order_id: reservationId,
          workspace_reservation_id: reservationId,
        });
        expect(await legalEvidenceOrder(pool, detachedEvidenceId)).toEqual({
          order_id: null,
          workspace_reservation_id: null,
        });
        expect(await attemptOrder(pool, unlinkedAttemptId)).toBe(reservationId);
      });
    });

    test("links rows that writers from before the order key insert afterwards", async () => {
      await beforeMigration(async ({ pool, reservation, migrateRemaining }) => {
        await migrateRemaining();
        const reservationId = await reservation();

        const evidenceId = await insertLegalEvidence(pool, reservationId);
        const attemptId = await insertAttempt(pool, reservationId);

        expect((await legalEvidenceOrder(pool, evidenceId))?.order_id).toBe(
          reservationId
        );
        expect(await attemptOrder(pool, attemptId)).toBe(reservationId);
      });
    });

    test("rejects legal evidence that names another reservation's order", async () => {
      await beforeMigration(async ({ pool, reservation, migrateRemaining }) => {
        await migrateRemaining();
        const reservationId = await reservation();
        const otherReservationId = await reservation();

        expect(
          await failure(
            insertLegalEvidence(pool, reservationId, {
              orderId: otherReservationId,
            })
          )
        ).toMatchObject({
          code: "23514",
          constraint: "legal_evidence_events_reservation_order_match_check",
        });
      });
    });

    test("keeps legal evidence when its reservation and order are deleted", async () => {
      await beforeMigration(async ({ pool, reservation, migrateRemaining }) => {
        await migrateRemaining();
        const reservationId = await reservation();
        const evidenceId = await insertLegalEvidence(pool, reservationId);

        await pool.query("delete from workspace_reservations where id = $1", [
          reservationId,
        ]);

        expect(await legalEvidenceOrder(pool, evidenceId)).toEqual({
          order_id: null,
          workspace_reservation_id: null,
        });
      });
    });

    test("accepts payment attempts for an order without a reservation", async () => {
      await beforeMigration(async ({ pool, reservation, migrateRemaining }) => {
        await migrateRemaining();
        const reservationId = await reservation();

        const orderId = (
          await pool.query<{ id: string }>(
            `insert into orders (kind, dotypos_customer_id, payment_state, fulfillment_state)
           values ('pass-purchase', 'fixture-customer', 'not_started', 'not_started')
           returning id`
          )
        ).rows[0]!.id;
        const attemptId = await insertAttempt(pool, null, orderId);

        expect(await attemptOrder(pool, attemptId)).toBe(orderId);
        const matchViolation = {
          code: "23514",
          constraint: "payment_attempts_reservation_order_match_check",
        };
        expect(
          await failure(insertAttempt(pool, null, reservationId))
        ).toMatchObject(matchViolation);
        expect(
          await failure(insertAttempt(pool, reservationId, orderId))
        ).toMatchObject(matchViolation);
        expect(
          await failure(
            pool.query(
              "update payment_attempts set order_id = $1 where id = $2",
              [reservationId, attemptId]
            )
          )
        ).toMatchObject(matchViolation);
      });
    });
  }
);
