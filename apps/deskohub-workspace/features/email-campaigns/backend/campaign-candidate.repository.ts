import "server-only";

import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import {
  and,
  count,
  eq,
  gte,
  inArray,
  lt,
  max,
  min,
  type SQL,
  sql,
} from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  customerAccountLinks,
  customerMarketingConsents,
  emailCampaignDeliveryBatches,
  emailCampaignRecipients,
  emailCampaignSends,
  emailCampaigns,
  workspaceReservations,
} from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import type { AdministrationReservationStatusFilter } from "@/features/administration/administration.service";
import {
  bookedReservationCondition,
  reservationStatusCondition,
} from "@/features/administration/reservation-status-condition";
import { temporalInstantToDate } from "@/shared/utils/temporal";
import type { AudienceDateFacts } from "../audience-filter";
import type { CampaignPurpose } from "../body/campaign-content";
import type { DatePeriodBounds } from "../date-period";

/** What Workspace stores about one customer it knows. */
export type CampaignCandidateFacts = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly hasAccount: boolean;
  readonly accountLocale: string | null;
  readonly latestReservationLocale: string | null;
  readonly latestReservationAt: Temporal.Instant | null;
  readonly consentLocale: string | null;
};

/**
 * Which Workspace reservations a reservation count includes. Each field adds
 * one SQL condition in {@link reservationSelection}; a new reservation
 * property filter slots in the same way.
 */
export type CampaignReservationSelection = {
  /** Admin status group; without one, only booked reservations count. */
  readonly status?: AdministrationReservationStatusFilter;
  /** Booking (confirmation) instant bounds; the end is exclusive. */
  readonly booked?: DatePeriodBounds;
  /** Limits the count to these Dotypos reservations (visit-date periods). */
  readonly dotyposReservationIds?: readonly DotyposReservationId[];
};

/** A booked reservation's Dotypos ID and customer. */
export type CampaignBookedReservation = {
  readonly dotyposReservationId: DotyposReservationId;
  readonly dotyposCustomerId: DotyposCustomerId;
};

/**
 * Recipient statuses that mean Resend accepted the email for the customer.
 * `unconfirmed` counts too: the email may well have gone out.
 */
export const receivedCampaignEmailStatuses = [
  "sent",
  "delivered",
  "complained",
  "unconfirmed",
] as const;

const reservationSelection = ({
  status,
  booked,
  dotyposReservationIds,
}: CampaignReservationSelection): SQL | undefined =>
  and(
    status ? reservationStatusCondition(status) : bookedReservationCondition,
    booked?.startsAtOrAfter &&
      gte(workspaceReservations.reservationConfirmedAt, booked.startsAtOrAfter),
    booked?.startsBefore &&
      lt(workspaceReservations.reservationConfirmedAt, booked.startsBefore),
    dotyposReservationIds &&
      inArray(workspaceReservations.dotyposReservationId, [
        ...dotyposReservationIds,
      ])
  );

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
  /**
   * Reservations per customer among those the selection includes. Customers
   * without any are absent. Booking-date bounds apply to the confirmation
   * instant, so reservations that never confirmed fall outside every
   * booking-date period.
   */
  readonly countReservations: (
    selection: CampaignReservationSelection
  ) => Effect.Effect<
    ReadonlyMap<DotyposCustomerId, number>,
    EffectDrizzleQueryError
  >;
  /**
   * Campaign emails Resend accepted per customer, dated by the first request
   * of the batch that carried them. Customers without any are absent.
   */
  readonly countReceivedCampaignEmails: (query: {
    /** Without a purpose every campaign counts. */
    readonly purpose?: CampaignPurpose;
    readonly dispatched: DatePeriodBounds;
  }) => Effect.Effect<
    ReadonlyMap<DotyposCustomerId, number>,
    EffectDrizzleQueryError
  >;
  /** Customers with a linked account, and those whose account was created in the bounds. */
  readonly accountCreations: (
    created: DatePeriodBounds
  ) => Effect.Effect<AudienceDateFacts, EffectDrizzleQueryError>;
  /**
   * When the earliest Workspace reservation was created, if there is one. No
   * Workspace reservation starts long before it, so it bounds visit queries.
   */
  readonly earliestReservationAt: Effect.Effect<
    Temporal.Instant | null,
    EffectDrizzleQueryError
  >;
  /** The booked reservations among these Dotypos reservations. */
  readonly listBookedReservations: (
    dotyposReservationIds: readonly DotyposReservationId[]
  ) => Effect.Effect<
    readonly CampaignBookedReservation[],
    EffectDrizzleQueryError
  >;
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
        countReservations: Effect.fn(
          "CampaignCandidateRepository.countReservations"
        )(function* (selection) {
          if (selection.dotyposReservationIds?.length === 0) {
            return new Map<DotyposCustomerId, number>();
          }
          const rows = yield* db
            .select({
              dotyposCustomerId: workspaceReservations.dotyposCustomerId,
              count: count(),
            })
            .from(workspaceReservations)
            .where(reservationSelection(selection))
            .groupBy(workspaceReservations.dotyposCustomerId);
          return new Map(
            rows.map((row) => [row.dotyposCustomerId, row.count] as const)
          );
        }),
        countReceivedCampaignEmails: Effect.fn(
          "CampaignCandidateRepository.countReceivedCampaignEmails"
        )(function* ({ purpose, dispatched }) {
          const recipients = emailCampaignRecipients;
          const batches = emailCampaignDeliveryBatches;
          // A recipient a webhook settled without a batch in its current
          // attempt is dated by its status change instead.
          const dispatchedAt = sql`coalesce(${batches.requestedAt}, ${recipients.statusUpdatedAt})`;
          const rows = yield* db
            .select({
              dotyposCustomerId: recipients.dotyposCustomerId,
              count: count(),
            })
            .from(recipients)
            .innerJoin(
              emailCampaignSends,
              eq(emailCampaignSends.id, recipients.sendId)
            )
            .innerJoin(
              emailCampaigns,
              eq(emailCampaigns.id, emailCampaignSends.campaignId)
            )
            .leftJoin(
              batches,
              and(
                eq(batches.sendId, recipients.sendId),
                eq(batches.deliveryAttempt, recipients.deliveryAttempt),
                sql`${recipients.dotyposCustomerId} = any(${batches.dotyposCustomerIds})`
              )
            )
            .where(
              and(
                inArray(recipients.status, [...receivedCampaignEmailStatuses]),
                purpose && eq(emailCampaigns.purpose, purpose),
                dispatched.startsAtOrAfter &&
                  sql`${dispatchedAt} >= ${temporalInstantToDate(dispatched.startsAtOrAfter)}`,
                dispatched.startsBefore &&
                  sql`${dispatchedAt} < ${temporalInstantToDate(dispatched.startsBefore)}`
              )
            )
            .groupBy(recipients.dotyposCustomerId);
          return new Map(
            rows.map((row) => [row.dotyposCustomerId, row.count] as const)
          );
        }),
        accountCreations: Effect.fn(
          "CampaignCandidateRepository.accountCreations"
        )(function* (created) {
          const rows = yield* db
            .select({
              dotyposCustomerId: customerAccountLinks.dotyposCustomerId,
              inPeriod: sql<boolean>`${and(
                sql`true`,
                created.startsAtOrAfter &&
                  gte(
                    authUser.createdAt,
                    temporalInstantToDate(created.startsAtOrAfter)
                  ),
                created.startsBefore &&
                  lt(
                    authUser.createdAt,
                    temporalInstantToDate(created.startsBefore)
                  )
              )}`,
            })
            .from(customerAccountLinks)
            .innerJoin(
              authUser,
              eq(authUser.id, customerAccountLinks.customerAccountId)
            );
          return {
            withValue: new Set(rows.map((row) => row.dotyposCustomerId)),
            inPeriod: new Set(
              rows.flatMap((row) =>
                row.inPeriod ? [row.dotyposCustomerId] : []
              )
            ),
          };
        }),
        earliestReservationAt: db
          .select({ createdAt: min(workspaceReservations.createdAt) })
          .from(workspaceReservations)
          .pipe(Effect.map(([row]) => row?.createdAt ?? null)),
        listBookedReservations: Effect.fn(
          "CampaignCandidateRepository.listBookedReservations"
        )(function* (dotyposReservationIds) {
          if (dotyposReservationIds.length === 0) return [];
          const rows = yield* db
            .select({
              dotyposReservationId: workspaceReservations.dotyposReservationId,
              dotyposCustomerId: workspaceReservations.dotyposCustomerId,
            })
            .from(workspaceReservations)
            .where(
              reservationSelection({ dotyposReservationIds })
            );
          return rows.flatMap(({ dotyposReservationId, dotyposCustomerId }) =>
            dotyposReservationId === null
              ? []
              : [{ dotyposReservationId, dotyposCustomerId }]
          );
        }),
      } satisfies ICampaignCandidateRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
