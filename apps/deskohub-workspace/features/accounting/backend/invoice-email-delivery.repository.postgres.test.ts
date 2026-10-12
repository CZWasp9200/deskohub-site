import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { InvoiceEmailDeliveryAudience } from "@/features/accounting/invoice-email-delivery";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type IInvoiceEmailDeliveryRepository,
  InvoiceEmailDeliveryRepository,
} from "./invoice-email-delivery.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const runRepository = <A>(
  operation: (
    repository: IInvoiceEmailDeliveryRepository
  ) => Effect.Effect<A, EffectDrizzleQueryError>
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const repository = yield* InvoiceEmailDeliveryRepository;
      return yield* operation(repository);
    }).pipe(
      Effect.provide(
        InvoiceEmailDeliveryRepository.Default.pipe(
          Layer.provide(
            Layer.succeed(
              WorkspaceDatabase,
              WorkspaceDatabase.of({ db: testDatabase!.db })
            )
          )
        )
      )
    )
  );

// A manual invoice row carries no reservation reference; the encrypted
// document is opaque to delivery claims.
const insertInvoice = async () => {
  const sequence = 100_000 + Math.floor(Math.random() * 2_000_000_000);
  const result = await testDatabase!.pool.query<{ id: string }>(
    `insert into invoices
       (dotypos_customer_id, invoice_number, numbering_year, numbering_sequence,
        key_id, encrypted_document, issued_at)
     values ('delivery-claim-customer', $1, 2026, $2, 'K202608', '\\x00', '2026-06-01T10:00:00Z')
     returning id`,
    [`WS-FV-TEST-${crypto.randomUUID()}`, sequence]
  );
  return result.rows[0]!.id;
};

const readDelivery = async (
  invoiceId: string,
  audience: InvoiceEmailDeliveryAudience
) => {
  const result = await testDatabase!.pool.query<{
    state: string;
    attempt_count: number;
  }>(
    `select state, attempt_count from invoice_email_deliveries
     where invoice_id = $1 and audience = $2`,
    [invoiceId, audience]
  );
  return result.rows[0];
};

const freshProcessingBefore = () =>
  Temporal.Now.instant().subtract({ minutes: 1 });
const staleProcessingBefore = () => Temporal.Now.instant().add({ minutes: 1 });
const acceptedAt = Temporal.Instant.from("2026-06-01T10:05:00Z");

describe.skipIf(!testDatabase)(
  "InvoiceEmailDeliveryRepository on disposable Postgres",
  () => {
    test("claims a new or failed delivery but not an accepted or in-flight one", async () => {
      const invoiceId = await insertInvoice();
      const claim = (repository: IInvoiceEmailDeliveryRepository) =>
        repository.claim({
          invoiceId,
          audience: "customer",
          staleProcessingBefore: freshProcessingBefore(),
        });

      const outcomes = await runRepository((repository) =>
        Effect.gen(function* () {
          const first = yield* claim(repository);
          const whileProcessing = yield* claim(repository);
          yield* repository.markFailed({
            invoiceId,
            audience: "customer",
            attemptNumber: 1,
            failureCode: "email_send_failed",
          });
          const afterFailure = yield* claim(repository);
          yield* repository.markAccepted({
            invoiceId,
            audience: "customer",
            attemptNumber: 2,
            providerDeliveryId: EmailDeliveryIdSchema.make("email-1"),
            acceptedAt,
          });
          const afterAcceptance = yield* claim(repository);
          return { first, whileProcessing, afterFailure, afterAcceptance };
        })
      );

      expect(outcomes).toEqual({
        first: { attemptNumber: 1 },
        whileProcessing: null,
        afterFailure: { attemptNumber: 2 },
        afterAcceptance: null,
      });
      expect(await readDelivery(invoiceId, "customer")).toEqual({
        state: "accepted",
        attempt_count: 2,
      });
    });

    test("delivers both audiences of one invoice independently", async () => {
      const invoiceId = await insertInvoice();

      const claims = await Promise.all(
        Array.from({ length: 10 }, () =>
          runRepository((repository) =>
            repository.claim({
              invoiceId,
              audience: "customer",
              staleProcessingBefore: freshProcessingBefore(),
            })
          )
        )
      );
      const outcomes = await runRepository((repository) =>
        Effect.gen(function* () {
          yield* repository.markAccepted({
            invoiceId,
            audience: "customer",
            attemptNumber: 1,
            providerDeliveryId: EmailDeliveryIdSchema.make("customer-email"),
            acceptedAt,
          });
          const customerAfterAcceptance = yield* repository.claim({
            invoiceId,
            audience: "customer",
            staleProcessingBefore: freshProcessingBefore(),
          });
          const internal = yield* repository.claim({
            invoiceId,
            audience: "internal",
            staleProcessingBefore: freshProcessingBefore(),
          });
          yield* repository.markFailed({
            invoiceId,
            audience: "internal",
            attemptNumber: 1,
            failureCode: "email_send_failed",
          });
          const internalRetry = yield* repository.claim({
            invoiceId,
            audience: "internal",
            staleProcessingBefore: freshProcessingBefore(),
          });
          yield* repository.markAccepted({
            invoiceId,
            audience: "internal",
            attemptNumber: 2,
            providerDeliveryId: EmailDeliveryIdSchema.make("internal-email"),
            acceptedAt,
          });
          return { customerAfterAcceptance, internal, internalRetry };
        })
      );

      expect(claims.filter((claim) => claim !== null)).toEqual([
        { attemptNumber: 1 },
      ]);
      expect(outcomes).toEqual({
        customerAfterAcceptance: null,
        internal: { attemptNumber: 1 },
        internalRetry: { attemptNumber: 2 },
      });
      const rows = await testDatabase!.pool.query<{
        audience: InvoiceEmailDeliveryAudience;
        state: string;
        attempt_count: number;
      }>(
        `select audience, state, attempt_count from invoice_email_deliveries
         where invoice_id = $1 order by audience`,
        [invoiceId]
      );
      expect(rows.rows).toEqual([
        { audience: "customer", state: "accepted", attempt_count: 1 },
        { audience: "internal", state: "accepted", attempt_count: 2 },
      ]);
    });

    test("reclaims a stale processing delivery as the next attempt", async () => {
      const invoiceId = await insertInvoice();

      const outcomes = await runRepository((repository) =>
        Effect.gen(function* () {
          const first = yield* repository.claim({
            invoiceId,
            audience: "internal",
            staleProcessingBefore: freshProcessingBefore(),
          });
          const stale = yield* repository.claim({
            invoiceId,
            audience: "internal",
            staleProcessingBefore: staleProcessingBefore(),
          });
          return { first, stale };
        })
      );

      expect(outcomes).toEqual({
        first: { attemptNumber: 1 },
        stale: { attemptNumber: 2 },
      });
    });

    test("an explicit resend reclaims an accepted customer delivery", async () => {
      const invoiceId = await insertInvoice();

      const outcomes = await runRepository((repository) =>
        Effect.gen(function* () {
          yield* repository.claim({
            invoiceId,
            audience: "customer",
            staleProcessingBefore: freshProcessingBefore(),
          });
          yield* repository.markAccepted({
            invoiceId,
            audience: "customer",
            attemptNumber: 1,
            providerDeliveryId: EmailDeliveryIdSchema.make("email-1"),
            acceptedAt,
          });
          const resend = yield* repository.claimResend({
            invoiceId,
            staleProcessingBefore: freshProcessingBefore(),
          });
          const whileResending = yield* repository.claimResend({
            invoiceId,
            staleProcessingBefore: freshProcessingBefore(),
          });
          const staleResend = yield* repository.claimResend({
            invoiceId,
            staleProcessingBefore: staleProcessingBefore(),
          });
          return { resend, whileResending, staleResend };
        })
      );

      // A stale resend keeps its attempt number, so the retried send reuses
      // the provider idempotency key derived from it.
      expect(outcomes).toEqual({
        resend: { attemptNumber: 2 },
        whileResending: null,
        staleResend: { attemptNumber: 2 },
      });
      expect(await readDelivery(invoiceId, "customer")).toEqual({
        state: "processing",
        attempt_count: 2,
      });
    });

    test("ignores terminal updates from a superseded attempt", async () => {
      const invoiceId = await insertInvoice();

      await runRepository((repository) =>
        Effect.gen(function* () {
          yield* repository.claim({
            invoiceId,
            audience: "customer",
            staleProcessingBefore: freshProcessingBefore(),
          });
          yield* repository.claim({
            invoiceId,
            audience: "customer",
            staleProcessingBefore: staleProcessingBefore(),
          });
          yield* repository.markAccepted({
            invoiceId,
            audience: "customer",
            attemptNumber: 1,
            providerDeliveryId: EmailDeliveryIdSchema.make("email-1"),
            acceptedAt,
          });
          yield* repository.markFailed({
            invoiceId,
            audience: "customer",
            attemptNumber: 1,
            failureCode: "email_send_failed",
          });
        })
      );

      expect(await readDelivery(invoiceId, "customer")).toEqual({
        state: "processing",
        attempt_count: 2,
      });
    });
  }
);
