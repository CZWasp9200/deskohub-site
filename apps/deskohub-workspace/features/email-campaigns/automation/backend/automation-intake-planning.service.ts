import type { DotyposCustomerId } from "@deskohub/dotypos";
import { dotyposIdReadRequests } from "@deskohub/dotypos";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notExists,
  or,
} from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  customerEvents,
  emailCampaignAutomationRuns as runs,
  workspaceReservations,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { audienceEvaluationAt } from "../../backend/audience-evaluation-context";
import type { AudienceDotyposReads } from "../../backend/audience-facts.service";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationRunId } from "../automation-identifiers";
import { automationTickAtOrBefore } from "../automation-ticks";
import {
  type WorkspaceCancellations,
  withdrawnByWorkspaceCancellation,
} from "../automation-trigger-verification";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import {
  type IntakeMatch,
  intakeEventColumns,
  matchIntakeEvents,
} from "./automation-intake-matching";
import { lockAutomationForEngine } from "./automation-lifecycle-lock";
import { loadAutomationEntryVersions } from "./automation-run-entry";
import { AutomationRunTransitions } from "./automation-run-transitions";
import { lockTriggeringReservations } from "./automation-triggering-reservations";
import { planAutomationUnits } from "./automation-unit-planning";
import { plannedIntakeUnit, revisitedReservations } from "./intake";

/** What planner step 4 did, for the plan summary. */
export type AutomationIntakePlan = {
  /**
   * Runs ended `withdrawn` by eager withdrawal (D28), or because a restore
   * undid the cancellation that triggered them.
   */
  readonly withdrawnRuns: number;
  /** Events packed into intake units. */
  readonly eventsMatched: number;
  /** Events matching no automation, marked processed. */
  readonly eventsProcessed: number;
  /** Intake units planned. */
  readonly unitsPlanned: number;
};

/** The plan when nothing was due. */
export const emptyAutomationIntakePlan: AutomationIntakePlan = {
  withdrawnRuns: 0,
  eventsMatched: 0,
  eventsProcessed: 0,
  unitsPlanned: 0,
};

/** The most unplanned events one planner run matches (§5.5). */
const intakeBatchSize = 2000;

/**
 * The most runs one planner run withdraws, and the most whose cancellation
 * a restore undid; the next planner run takes the rest.
 */
const withdrawalBatchSize = 5000;

/**
 * D28: the runs a `reservation-cancelled` event withdraws, its
 * reservation's `active` runs except those a cancellation triggered.
 */
const withdrawableRuns = and(
  eq(runs.triggerReservationId, customerEvents.workspaceReservationId),
  eq(runs.status, "active"),
  ne(runs.triggerKind, "reservation-cancelled")
);

/**
 * The event's reservation, while the event's cancellation stands: still
 * cancelled at the event's instant, so no restore has undone it.
 */
const standingCancellation = and(
  eq(workspaceReservations.id, customerEvents.workspaceReservationId),
  eq(workspaceReservations.reservationCancelledAt, customerEvents.occurredAt)
);

/**
 * The triggering reservation of a run a cancellation triggered, once a
 * restore has undone that cancellation: the reservation is no longer
 * cancelled at the run's trigger instant.
 */
const undoneCancellation = and(
  eq(workspaceReservations.id, runs.triggerReservationId),
  or(
    isNull(workspaceReservations.reservationCancelledAt),
    ne(workspaceReservations.reservationCancelledAt, runs.triggerAt)
  )
);

/** The most Dotypos requests one packed unit makes (§5.3). */
const maxUnitRequestCost = 8;

interface IAutomationIntakePlanning {
  /**
   * Planner step 4 (§5.6): withdraws the active runs of each unprocessed `reservation-cancelled` event's reservation while its cancellation stands, up to 5,000 per run, then up to 5,000 active runs whose triggering cancellation a restore undid, matches up to 2,000 unplanned events against active automations, marks events matching nothing processed, and packs the rest by customer into intake units. A cancellation waits for its withdrawals before intake takes it. Runs its own short idempotent transactions, so overlapping
   * planners are harmless.
   */
  readonly plan: (
    at: Temporal.Instant
  ) => Effect.Effect<AutomationIntakePlan, DatabaseQueryError>;
}

export class AutomationIntakePlanning extends Context.Service<
  AutomationIntakePlanning,
  IAutomationIntakePlanning
>()("@deskohub-workspace/email-campaigns/AutomationIntakePlanning") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
      const facts = yield* AutomationEvaluationFacts;

      /**
       * Ends one automation's `runs` `withdrawn` in one short transaction:
       * under its lifecycle lock and their triggering reservations' share
       * locks, only those `withdrawn` still holds for, so a restore or a
       * cancellation committing since the select is respected.
       */
      const endWithdrawn = <
        Run extends {
          readonly runId: AutomationRunId;
          readonly reservationId: WorkspaceReservationId | null;
        },
      >(
        campaignId: CampaignId,
        ofCampaign: readonly Run[],
        withdrawn: (run: Run, cancellations: WorkspaceCancellations) => boolean,
        at: Temporal.Instant
      ) =>
        transaction(
          lockAutomationForEngine(campaignId).pipe(
            Effect.andThen(
              lockTriggeringReservations(
                ofCampaign.map(({ reservationId }) => reservationId)
              )
            ),
            Effect.map((cancellations) =>
              ofCampaign
                .filter((run) => withdrawn(run, cancellations))
                .map(({ runId }) => runId)
            ),
            Effect.flatMap((runIds) =>
              runIds.length === 0
                ? Effect.succeed([])
                : AutomationRunTransitions.end({
                    runIds,
                    expect: { status: "active" },
                    outcome: "withdrawn",
                    at,
                  })
            )
          )
        );

      /**
       * D28: each unprocessed cancellation that still stands ends its
       * withdrawable runs. `sending` runs are in a persisted batch and
       * settle normally. One short transaction per automation, under its
       * lifecycle lock. Intake leaves a standing cancellation unprocessed
       * until none remain, so runs past the batch are withdrawn by
       * subsequent planner runs. A cancellation a restore undid withdraws
       * nothing.
       */
      const withdraw = (at: Temporal.Instant) =>
        db
          .selectDistinct({
            campaignId: runs.campaignId,
            runId: runs.id,
            reservationId: runs.triggerReservationId,
            cancelledAt: customerEvents.occurredAt,
          })
          .from(runs)
          .innerJoin(customerEvents, withdrawableRuns)
          .innerJoin(workspaceReservations, standingCancellation)
          .where(
            and(
              eq(customerEvents.kind, "reservation-cancelled"),
              isNull(customerEvents.automationProcessedAt)
            )
          )
          .orderBy(asc(runs.campaignId), asc(runs.id))
          .limit(withdrawalBatchSize)
          .pipe(
            Effect.flatMap((withdrawable) =>
              Effect.forEach(
                Map.groupBy(withdrawable, ({ campaignId }) => campaignId),
                ([campaignId, ofCampaign]) =>
                  endWithdrawn(
                    campaignId,
                    ofCampaign,
                    ({ reservationId, cancelledAt }, cancellations) =>
                      reservationId !== null &&
                      Option.exists(
                        Option.fromUndefinedOr(
                          cancellations.get(reservationId)
                        ),
                        (at) => at.equals(cancelledAt)
                      ),
                    at
                  )
              )
            ),
            Effect.map((ended) => ended.flat().length),
            Effect.withSpan("AutomationIntakePlanning.withdraw")
          );

      /**
       * Ends the active runs whose triggering cancellation a restore undid,
       * so no cancellation message goes out for it and the customer's open
       * run slot frees (D4). `sending` runs settle normally. Up to 5,000
       * per planner run, one short transaction per automation, as in
       * `withdraw`.
       */
      const withdrawUndone = (at: Temporal.Instant) =>
        db
          .select({
            campaignId: runs.campaignId,
            runId: runs.id,
            kind: runs.triggerKind,
            triggerAt: runs.triggerAt,
            reservationId: runs.triggerReservationId,
          })
          .from(runs)
          .innerJoin(workspaceReservations, undoneCancellation)
          .where(
            and(
              eq(runs.status, "active"),
              eq(runs.triggerKind, "reservation-cancelled"),
              isNotNull(runs.triggerReservationId)
            )
          )
          .orderBy(asc(runs.campaignId), asc(runs.id))
          .limit(withdrawalBatchSize)
          .pipe(
            Effect.flatMap((undone) =>
              Effect.forEach(
                Map.groupBy(undone, ({ campaignId }) => campaignId),
                ([campaignId, ofCampaign]) =>
                  endWithdrawn(
                    campaignId,
                    ofCampaign,
                    (run, cancellations) =>
                      withdrawnByWorkspaceCancellation(
                        {
                          kind: run.kind,
                          at: run.triggerAt,
                          reservationId: run.reservationId,
                        },
                        cancellations
                      ),
                    at
                  )
              )
            ),
            Effect.map((ended) => ended.flat().length),
            Effect.withSpan("AutomationIntakePlanning.withdrawUndone")
          );

      /** The Dotypos reads the entry gates of these versions need, together. */
      const gateReads = (
        matches: readonly IntakeMatch[],
        at: Temporal.Instant
      ) =>
        loadAutomationEntryVersions(
          matches.map(({ versionId }) => versionId)
        ).pipe(
          Effect.flatMap((versions) =>
            Effect.forEach(versions.values(), (version) =>
              facts
                .plan({
                  filters: { entryAudience: version.audienceFilter },
                  context: audienceEvaluationAt(at),
                })
                .pipe(Effect.orDie)
            )
          ),
          Effect.map(
            (plans): AudienceDotyposReads => ({
              visits: plans.some(({ reads }) => reads.visits),
              profiles: plans.some(({ reads }) => reads.profiles),
            })
          )
        );

      /**
       * Packs the matched events by customer, in id order, into units of
       * at most 100 customers and 8 requests: the gates' reads plus, unless
       * the gates read the customers' visits anyway, one request per 100
       * triggering reservations to re-check. A customer too large for any
       * unit alone stays a solo unit.
       */
      const pack = (
        matches: readonly IntakeMatch[],
        reads: AudienceDotyposReads
      ) => {
        const byCustomer = Map.groupBy(
          matches,
          ({ event }) => event.dotyposCustomerId
        );
        const customers = [...byCustomer.keys()].sort();
        const revisitCost = (ofCustomers: readonly DotyposCustomerId[]) =>
          reads.visits
            ? 0
            : dotyposIdReadRequests(
                revisitedReservations(
                  ofCustomers.flatMap((id) =>
                    (byCustomer.get(id) ?? []).map(({ event }) => event)
                  )
                ).length
              );
        const fit = (chunk: {
          readonly customers: readonly DotyposCustomerId[];
          readonly requestCost: number;
        }): Effect.Effect<
          readonly {
            readonly customers: readonly DotyposCustomerId[];
            readonly requestCost: number;
          }[]
        > => {
          const requestCost = chunk.requestCost + revisitCost(chunk.customers);
          if (
            requestCost <= maxUnitRequestCost ||
            chunk.customers.length === 1
          ) {
            return Effect.succeed([
              { customers: chunk.customers, requestCost },
            ]);
          }
          const half = Math.ceil(chunk.customers.length / 2);
          return Effect.forEach(
            [chunk.customers.slice(0, half), chunk.customers.slice(half)],
            (part) =>
              facts
                .cost({ reads, customers: part })
                .pipe(
                  Effect.flatMap((cost) =>
                    fit({ customers: part, requestCost: cost })
                  )
                )
          ).pipe(Effect.map((parts) => parts.flat()));
        };
        return facts.pack({ reads, customers }).pipe(
          Effect.flatMap(Effect.forEach(fit)),
          Effect.map((chunks) =>
            chunks.flat().map((chunk) => ({
              requestCost: chunk.requestCost,
              eventIds: [
                ...new Set(
                  chunk.customers.flatMap((id) =>
                    (byCustomer.get(id) ?? []).map(({ event }) => event.id)
                  )
                ),
              ].sort(),
            }))
          )
        );
      };

      /**
       * One transaction: locks up to 2,000 unplanned events that occurred
       * by the tick `at` falls in (skipping those an overlapping planner
       * holds, and standing cancellations with runs still to withdraw), marks those
       * no automation takes processed, and plans
       * units for the rest, owning their events by compare-and-set. Unit
       * keys include the planner instant, so events a dropped unit released
       * are planned again under a new key.
       */
      const planEvents = (at: Temporal.Instant) =>
        transaction(
          Effect.Do.pipe(
            Effect.bind("events", () =>
              db
                .select(intakeEventColumns)
                .from(customerEvents)
                .where(
                  and(
                    isNull(customerEvents.automationProcessedAt),
                    isNull(customerEvents.automationUnitId),
                    // A late planner leaves events after its tick's instant
                    // to the next tick, so no run's waits count from a tick
                    // before its event, as in the dry run (D36).
                    lte(
                      customerEvents.occurredAt,
                      automationTickAtOrBefore(at)
                    ),
                    or(
                      ne(customerEvents.kind, "reservation-cancelled"),
                      notExists(
                        db
                          .select({ id: runs.id })
                          .from(runs)
                          .innerJoin(
                            workspaceReservations,
                            standingCancellation
                          )
                          .where(withdrawableRuns)
                      )
                    )
                  )
                )
                .orderBy(asc(customerEvents.recordedAt), asc(customerEvents.id))
                .limit(intakeBatchSize)
                .for("update", { skipLocked: true })
            ),
            Effect.bind("matches", ({ events }) => matchIntakeEvents(events)),
            Effect.let("unmatched", ({ events, matches }) => {
              const matched = new Set(matches.map(({ event }) => event.id));
              return events
                .filter(({ id }) => !matched.has(id))
                .map(({ id }) => id);
            }),
            Effect.tap(({ unmatched }) =>
              db
                .update(customerEvents)
                .set({ automationProcessedAt: at })
                .where(inArray(customerEvents.id, unmatched))
                .pipe(Effect.when(Effect.succeed(unmatched.length > 0)))
            ),
            Effect.bind("units", ({ matches }) =>
              matches.length === 0
                ? Effect.succeed([])
                : gateReads(matches, at).pipe(
                    Effect.flatMap((reads) => pack(matches, reads))
                  )
            ),
            Effect.let(
              "eventIdsByKey",
              ({ units }) =>
                new Map(
                  units.map((unit) => [
                    plannedIntakeUnit(unit, at).key,
                    unit.eventIds,
                  ])
                )
            ),
            Effect.bind("planned", ({ units }) =>
              planAutomationUnits(
                units.map((unit) => plannedIntakeUnit(unit, at)),
                at
              )
            ),
            Effect.tap(({ eventIdsByKey, planned }) =>
              Effect.forEach(
                planned.written,
                ({ unitId, key }) =>
                  db
                    .update(customerEvents)
                    .set({ automationUnitId: unitId })
                    .where(
                      and(
                        inArray(
                          customerEvents.id,
                          eventIdsByKey.get(key) ?? []
                        ),
                        isNull(customerEvents.automationUnitId),
                        isNull(customerEvents.automationProcessedAt)
                      )
                    ),
                { discard: true }
              )
            ),
            Effect.map(({ events, unmatched, planned }) => ({
              eventsMatched: events.length - unmatched.length,
              eventsProcessed: unmatched.length,
              unitsPlanned: planned.written.length,
            }))
          )
        );

      return {
        plan: (at) =>
          Effect.Do.pipe(
            Effect.bind("withdrawnRuns", () => withdraw(at)),
            Effect.bind("undoneRuns", () => withdrawUndone(at)),
            Effect.bind("events", () => planEvents(at)),
            Effect.map(
              ({
                withdrawnRuns,
                undoneRuns,
                events,
              }): AutomationIntakePlan => ({
                withdrawnRuns: withdrawnRuns + undoneRuns,
                ...events,
              })
            ),
            Effect.withSpan("AutomationIntakePlanning.plan")
          ),
      } satisfies IAutomationIntakePlanning;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(WorkspaceDatabase.Default, AutomationEvaluationFacts.Live)
    )
  );
}
