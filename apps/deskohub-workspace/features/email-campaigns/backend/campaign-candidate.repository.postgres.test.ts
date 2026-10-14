import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import {
  customerAccountLinks,
  customerMarketingConsents,
  workspaceReservations,
} from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  CampaignCandidateRepository,
  type CampaignReservationCustomerQuery,
} from "./campaign-candidate.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID();
const customerId = (role: string) =>
  DotyposCustomerIdSchema.make(`campaign-${role}-${run}`);
const reserved = customerId("reserved");
const linked = customerId("linked");
const consented = customerId("consented");
const withdrawn = customerId("withdrawn");
const seeded = [reserved, linked, consented, withdrawn];
const visitedReservation = DotyposReservationIdSchema.make(`booking-${run}`);
const accountId = `campaign-account-${run}`;
const bookedAt = Temporal.Instant.from("2026-03-10T12:00:00Z");

describe.skipIf(!testDatabase)(
  "CampaignCandidateRepository on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db } = testDatabase;

    beforeAll(async () => {
      await Effect.runPromise(
        Effect.all([
          db.insert(workspaceReservations).values([
            {
              checkoutAttemptKey: checkoutAttemptKeySchema.make(`old-${run}`),
              dotyposCustomerId: reserved,
              dotyposReservationId: DotyposReservationIdSchema.make(
                `old-booking-${run}`
              ),
              reservationState: "cancelled",
              paymentState: "cancelled",
              fulfillmentState: "not_started",
              reservationDetails: {
                kind: "cowork",
                entryTier: "open-space",
                coffee: false,
              },
              locale: "cs-CZ",
              createdAt: bookedAt.subtract({ hours: 240 }),
            },
            {
              checkoutAttemptKey: checkoutAttemptKeySchema.make(`new-${run}`),
              dotyposCustomerId: reserved,
              dotyposReservationId: visitedReservation,
              reservationState: "confirmed",
              paymentState: "paid",
              paidAt: bookedAt,
              fulfillmentState: "fulfilled",
              fulfilledAt: bookedAt,
              reservationDetails: {
                kind: "cowork",
                entryTier: "open-space",
                coffee: false,
              },
              locale: "en-US",
              createdAt: bookedAt,
            },
          ]),
          db.insert(authUser).values({
            id: accountId,
            name: "Campaign test",
            email: testEmailAddress(`campaign-${run}`),
            locale: "en-US",
          }),
          db.insert(customerMarketingConsents).values([
            {
              dotyposCustomerId: consented,
              documentHash: "hash",
              locale: "en-US",
              grantedAt: bookedAt,
            },
            {
              dotyposCustomerId: withdrawn,
              documentHash: "hash",
              locale: "en-US",
              grantedAt: bookedAt,
              withdrawnAt: bookedAt,
            },
          ]),
        ])
      );
      await Effect.runPromise(
        db
          .insert(customerAccountLinks)
          .values({ customerAccountId: accountId, dotyposCustomerId: linked })
      );
    });

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from workspace_reservations where dotypos_customer_id = any($1)",
        [seeded]
      );
      await testDatabase.pool.query(
        "delete from customer_marketing_consents where dotypos_customer_id = any($1)",
        [seeded]
      );
      await testDatabase.pool.query('delete from auth."user" where id = $1', [
        accountId,
      ]);
    });

    const repository = <A, E>(
      use: (
        repository: CampaignCandidateRepository["Service"]
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        CampaignCandidateRepository.pipe(Effect.flatMap(use)).pipe(
          Effect.provide(CampaignCandidateRepository.Default),
          Effect.provide(testDatabase.layer)
        )
      );

    const seededCandidates = async (purpose: "marketing" | "operational") =>
      (await repository((candidates) => candidates.listCandidates({ purpose })))
        .filter(({ dotyposCustomerId }) => seeded.includes(dotyposCustomerId))
        .sort((left, right) =>
          left.dotyposCustomerId.localeCompare(right.dotyposCustomerId)
        );

    test("limits marketing candidates to active consents", async () => {
      expect(
        (await seededCandidates("marketing")).map(
          ({ dotyposCustomerId }) => dotyposCustomerId
        )
      ).toEqual([consented]);
    });

    test("collects every known customer with their locale sources", async () => {
      const candidates = await seededCandidates("operational");
      expect(candidates).toEqual(
        expect.arrayContaining([
          {
            dotyposCustomerId: reserved,
            hasAccount: false,
            accountLocale: null,
            latestReservationLocale: "en-US",
            latestReservationAt: bookedAt,
            consentLocale: null,
          },
          {
            dotyposCustomerId: linked,
            hasAccount: true,
            accountLocale: "en-US",
            latestReservationLocale: null,
            latestReservationAt: null,
            consentLocale: null,
          },
          expect.objectContaining({
            dotyposCustomerId: withdrawn,
            consentLocale: "en-US",
          }),
        ])
      );
      expect(candidates).toHaveLength(4);
    });

    const matches = async (query: CampaignReservationCustomerQuery) =>
      (
        await repository((candidates) =>
          candidates.listReservationCustomers(query)
        )
      ).has(reserved);

    test("matches reservations by booking instant and admin status", async () => {
      expect(
        await matches({
          bookedAtOrAfter: bookedAt.subtract({ hours: 1 }),
          bookedBefore: bookedAt.add({ hours: 1 }),
          status: "complete",
        })
      ).toBe(true);
      expect(
        await matches({ bookedAtOrAfter: bookedAt.add({ hours: 1 }) })
      ).toBe(false);
      expect(
        await matches({
          bookedBefore: bookedAt,
          status: "complete",
        })
      ).toBe(false);
    });

    test("matches reservations by their Dotypos reservation", async () => {
      expect(
        await matches({ dotyposReservationIds: [visitedReservation] })
      ).toBe(true);
      expect(await matches({ dotyposReservationIds: [] })).toBe(false);
    });
  }
);
