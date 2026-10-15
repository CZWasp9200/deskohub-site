import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Option } from "effect";
import {
  customerAccountLinks,
  customerMarketingConsents,
  workspaceReservations,
} from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type AudienceFilter,
  evaluateAudienceFilter,
  reservationConditionKey,
} from "../audience-filter";
import {
  CampaignCandidateRepository,
  type CampaignReservationCustomerQuery,
} from "./campaign-candidate.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID();
const customerId = (role: string) =>
  DotyposCustomerIdSchema.make(`campaign-${role}-${run}`);
const reserved = customerId("reserved");
const abandoned = customerId("abandoned");
const unfulfilled = customerId("unfulfilled");
const linked = customerId("linked");
const consented = customerId("consented");
const withdrawn = customerId("withdrawn");
const seeded = [reserved, abandoned, unfulfilled, linked, consented, withdrawn];
const visitedReservation = DotyposReservationIdSchema.make(`booking-${run}`);
const abandonedReservation = DotyposReservationIdSchema.make(
  `abandoned-${run}`
);
const accountId = `campaign-account-${run}`;
/** 23:50 on March 10 in Prague. */
const createdAt = Temporal.Instant.from("2026-03-10T22:50:00Z");
/** 00:30 on March 11 in Prague. */
const confirmedAt = Temporal.Instant.from("2026-03-10T23:30:00Z");
/** Booking-date bounds of one Prague calendar day (CET, UTC+1). */
const bookedOnPragueDay = (day: string) => ({
  bookedAtOrAfter: Temporal.PlainDate.from(day)
    .toZonedDateTime("Europe/Prague")
    .toInstant(),
  bookedBefore: Temporal.PlainDate.from(day)
    .add({ days: 1 })
    .toZonedDateTime("Europe/Prague")
    .toInstant(),
});
const reservationDetails = {
  kind: "cowork",
  entryTier: "open-space",
  coffee: false,
} as const;

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
              reservationDetails,
              locale: "cs-CZ",
              createdAt: createdAt.subtract({ hours: 240 }),
            },
            {
              checkoutAttemptKey: checkoutAttemptKeySchema.make(`new-${run}`),
              dotyposCustomerId: reserved,
              dotyposReservationId: visitedReservation,
              reservationState: "confirmed",
              reservationConfirmedAt: confirmedAt,
              paymentState: "paid",
              paidAt: confirmedAt,
              fulfillmentState: "fulfilled",
              fulfilledAt: confirmedAt,
              reservationDetails,
              locale: "en-US",
              createdAt,
            },
            {
              checkoutAttemptKey: checkoutAttemptKeySchema.make(
                `abandoned-${run}`
              ),
              dotyposCustomerId: abandoned,
              dotyposReservationId: abandonedReservation,
              reservationState: "hold_expired",
              paymentState: "expired",
              fulfillmentState: "not_started",
              reservationDetails,
              locale: "en-US",
              createdAt,
            },
            {
              checkoutAttemptKey: checkoutAttemptKeySchema.make(
                `unfulfilled-${run}`
              ),
              dotyposCustomerId: unfulfilled,
              dotyposReservationId: DotyposReservationIdSchema.make(
                `unfulfilled-${run}`
              ),
              reservationState: "confirmed",
              reservationConfirmedAt: confirmedAt,
              paymentState: "paid",
              paidAt: confirmedAt,
              fulfillmentState: "failed",
              fulfillmentFailedAt: confirmedAt,
              fulfillmentFailureCode: "fulfillment_email_failed",
              reservationDetails,
              locale: "en-US",
              createdAt,
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
              grantedAt: createdAt,
            },
            {
              dotyposCustomerId: withdrawn,
              documentHash: "hash",
              locale: "en-US",
              grantedAt: createdAt,
              withdrawnAt: createdAt,
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
            latestReservationAt: createdAt,
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
      expect(candidates).toHaveLength(6);
    });

    const reservationCustomers = (query: CampaignReservationCustomerQuery) =>
      repository((candidates) => candidates.listReservationCustomers(query));
    const matches = async (
      query: CampaignReservationCustomerQuery,
      customer = reserved
    ) => (await reservationCustomers(query)).has(customer);

    test("counts only booked reservations when no status is chosen", async () => {
      const booked = await reservationCustomers({});
      expect(booked.has(reserved)).toBe(true);
      expect(booked.has(unfulfilled)).toBe(true);
      expect(booked.has(abandoned)).toBe(false);
      expect(
        await matches(
          { dotyposReservationIds: [abandonedReservation] },
          abandoned
        )
      ).toBe(false);
      expect(await matches({ status: "cancelled" }, abandoned)).toBe(true);
    });

    test("treats an abandoned checkout as no reservation", async () => {
      const reservationMatches = new Map([
        [
          reservationConditionKey({ dateBasis: "booking" }),
          await reservationCustomers({}),
        ],
      ]);
      const evaluate = (presence: "has" | "hasNot") =>
        evaluateAudienceFilter({
          filter: {
            _tag: "Reservation",
            presence,
            dateBasis: "booking",
          } satisfies AudienceFilter,
          candidate: {
            dotyposCustomerId: abandoned,
            locale: "en-US",
            hasAccount: false,
          },
          reservationMatches,
          profile: Option.none(),
        });
      expect(evaluate("has")).toBe("noMatch");
      expect(evaluate("hasNot")).toBe("match");
    });

    test("dates bookings by their confirmation on the Prague calendar day", async () => {
      expect(await matches(bookedOnPragueDay("2026-03-11"))).toBe(true);
      expect(await matches(bookedOnPragueDay("2026-03-10"))).toBe(false);
      expect(
        await matches({
          ...bookedOnPragueDay("2026-03-11"),
          status: "complete",
        })
      ).toBe(true);
      expect(
        await matches({
          ...bookedOnPragueDay("2026-03-11"),
          status: "cancelled",
        })
      ).toBe(false);
      expect(
        await matches(
          { ...bookedOnPragueDay("2026-03-10"), status: "cancelled" },
          abandoned
        )
      ).toBe(false);
      expect(await matches({ bookedBefore: confirmedAt })).toBe(false);
      expect(
        await matches({ bookedBefore: confirmedAt.add({ seconds: 1 }) })
      ).toBe(true);
    });

    test("matches reservations by their Dotypos reservation", async () => {
      expect(
        await matches({ dotyposReservationIds: [visitedReservation] })
      ).toBe(true);
      expect(await matches({ dotyposReservationIds: [] })).toBe(false);
    });
  }
);
