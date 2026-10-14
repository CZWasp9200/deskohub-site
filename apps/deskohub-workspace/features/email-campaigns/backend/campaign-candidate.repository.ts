import "server-only";

import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { and, eq, gte, inArray, lt, max, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  customerAccountLinks,
  customerMarketingConsents,
  workspaceReservations,
} from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import type { AdministrationReservationStatusFilter } from "@/features/administration/administration.service";
import { reservationStatusCondition } from "@/features/administration/reservation-status-condition";
import type { CampaignPurpose } from "../body/campaign-content";

/** What Workspace stores about one customer it knows. */
export type CampaignCandidateFacts = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly hasAccount: boolean;
  readonly accountLocale: string | null;
  readonly latestReservationLocale: string | null;
  readonly latestReservationAt: Temporal.Instant | null;
  readonly consentLocale: string | null;
};

export type CampaignReservationCustomerQuery = {
  readonly status?: AdministrationReservationStatusFilter;
  /** Booking (Workspace creation) instant bounds; the end is exclusive. */
  readonly bookedAtOrAfter?: Temporal.Instant;
  readonly bookedBefore?: Temporal.Instant;
  /** Limits the match to these Dotypos reservations (visit-date filters). */
  readonly dotyposReservationIds?: readonly DotyposReservationId[];
};

export interface ICampaignCandidateRepository {
  /**
   * The customers Workspace knows: everyone with a reservation, a linked
   * account, or a marketing consent row. Marketing campaigns reach only
   * customers whose consent is active.
   */
  readonly listCandidates: (input: {
    readonly purpose: CampaignPurpose;
  }) => Effect.Effect<
    readonly CampaignCandidateFacts[],
    EffectDrizzleQueryError
  >;
  /** Customers with at least one Workspace reservation matching the query. */
  readonly listReservationCustomers: (
    query: CampaignReservationCustomerQuery
  ) => Effect.Effect<ReadonlySet<DotyposCustomerId>, EffectDrizzleQueryError>;
}

export class CampaignCandidateRepository extends Context.Service<
  CampaignCandidateRepository,
  ICampaignCandidateRepository
>()("@deskohub-workspace/email-campaigns/CampaignCandidateRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const latestReservations = db
        .select({
          dotyposCustomerId: workspaceReservations.dotyposCustomerId,
          locale: sql<string>`(array_agg(${workspaceReservations.locale} order by ${workspaceReservations.createdAt} desc))[1]`,
          createdAt: max(workspaceReservations.createdAt),
        })
        .from(workspaceReservations)
        .groupBy(workspaceReservations.dotyposCustomerId);

      const accounts = db
        .select({
          dotyposCustomerId: customerAccountLinks.dotyposCustomerId,
          locale: authUser.locale,
        })
        .from(customerAccountLinks)
        .innerJoin(
          authUser,
          eq(authUser.id, customerAccountLinks.customerAccountId)
        );

      const consents = db
        .select({
          dotyposCustomerId: customerMarketingConsents.dotyposCustomerId,
          locale: customerMarketingConsents.locale,
          active: sql<boolean>`${customerMarketingConsents.withdrawnAt} is null`,
        })
        .from(customerMarketingConsents);

      return {
        listCandidates: Effect.fn("CampaignCandidateRepository.listCandidates")(
          function* ({ purpose }) {
            const [reservationRows, accountRows, consentRows] =
              yield* Effect.all([latestReservations, accounts, consents], {
                concurrency: "inherit",
              });
            const reservationsById = new Map(
              reservationRows.map((row) => [row.dotyposCustomerId, row])
            );
            const accountsById = new Map(
              accountRows.map((row) => [row.dotyposCustomerId, row])
            );
            const consentsById = new Map(
              consentRows.map((row) => [row.dotyposCustomerId, row])
            );
            const pool =
              purpose === "marketing"
                ? consentRows
                    .filter(({ active }) => active)
                    .map(({ dotyposCustomerId }) => dotyposCustomerId)
                : [
                    ...new Set([
                      ...reservationsById.keys(),
                      ...accountsById.keys(),
                      ...consentsById.keys(),
                    ]),
                  ];

            return pool.map((dotyposCustomerId): CampaignCandidateFacts => {
              const reservation = reservationsById.get(dotyposCustomerId);
              const account = accountsById.get(dotyposCustomerId);
              return {
                dotyposCustomerId,
                hasAccount: account !== undefined,
                accountLocale: account?.locale ?? null,
                latestReservationLocale: reservation?.locale ?? null,
                latestReservationAt: reservation?.createdAt ?? null,
                consentLocale:
                  consentsById.get(dotyposCustomerId)?.locale ?? null,
              };
            });
          }
        ),
        listReservationCustomers: Effect.fn(
          "CampaignCandidateRepository.listReservationCustomers"
        )(function* (query) {
          if (query.dotyposReservationIds?.length === 0) {
            return new Set<DotyposCustomerId>();
          }
          const rows = yield* db
            .selectDistinct({
              dotyposCustomerId: workspaceReservations.dotyposCustomerId,
            })
            .from(workspaceReservations)
            .where(
              and(
                query.status && reservationStatusCondition(query.status),
                query.bookedAtOrAfter &&
                  gte(workspaceReservations.createdAt, query.bookedAtOrAfter),
                query.bookedBefore &&
                  lt(workspaceReservations.createdAt, query.bookedBefore),
                query.dotyposReservationIds &&
                  inArray(workspaceReservations.dotyposReservationId, [
                    ...query.dotyposReservationIds,
                  ])
              )
            );
          return new Set(
            rows.map(({ dotyposCustomerId }) => dotyposCustomerId)
          );
        }),
      } satisfies ICampaignCandidateRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
