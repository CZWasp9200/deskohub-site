import type { DotyposCustomerLifecycle } from "@deskohub/dotypos";
import {
  AdministrationCampaignRecipientSkipReason,
  AutomationEngineHealth,
  AutomationRunDetail,
  type AutomationRunOutcome,
  type AutomationRunState,
  AutomationRunStats,
  AutomationRunSummary,
  AutomationRunTimelineEntry,
  automationRunOutcomes,
  automationRunStates,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import type {
  AutomationRunDetailWithLifecycle,
  AutomationRunSummaryWithLifecycle,
} from "../../../automation/backend/automation-run-log.service";
import { fixtureCampaignId } from "../activation/automation-detail.test-utils";

const runFields = {
  runId: "run-1",
  campaignId: fixtureCampaignId,
  versionNumber: 1,
  customerId: "dotypos-customer-1",
  customerName: null,
  customerEmail: null,
  customerProfileStatus: "found",
  triggerKind: "account-created",
  triggerAt: "2026-10-03T08:00:00.000Z",
  state: "ended",
  phase: null,
  stepId: "send",
  dueAt: null,
  outcome: "sent",
  outcomeReason: null,
  sendId: null,
  startedAt: "2026-10-03T08:00:00.000Z",
  endedAt: "2026-10-05T08:00:00.000Z",
} satisfies typeof AutomationRunSummary.Encoded;

/** The fields a run fixture overrides, its customer's lifecycle among them. */
type RunOverrides<Encoded> = Partial<Encoded> & {
  readonly customerLifecycle?: DotyposCustomerLifecycle;
};

/** The lifecycle the port reads: active for a found customer, else none. */
const withLifecycle = <A extends typeof AutomationRunSummary.Type>(
  run: A,
  customerLifecycle: DotyposCustomerLifecycle | undefined
) => ({
  ...run,
  customerLifecycle:
    customerLifecycle ??
    (run.customerProfileStatus === "found" ? "active" : null),
});

/** One run of the fixture campaign, decoded like the port's output. */
export const automationRunFixture = ({
  customerLifecycle,
  ...overrides
}: RunOverrides<
  typeof AutomationRunSummary.Encoded
> = {}): AutomationRunSummaryWithLifecycle =>
  withLifecycle(
    Schema.decodeUnknownSync(AutomationRunSummary)({
      ...runFields,
      ...overrides,
    }),
    customerLifecycle
  );

/** A timeline entry decoded like the port's output; unknown kinds decode generically. */
export const timelineEntryFixture = (
  entry: Partial<typeof AutomationRunTimelineEntry.Encoded> & {
    readonly kind: string;
    readonly detail?: unknown;
  }
): AutomationRunTimelineEntry =>
  Schema.decodeUnknownSync(AutomationRunTimelineEntry)({
    sequence: 1,
    stepId: null,
    at: "2026-10-03T08:00:00.000Z",
    detail: {},
    ...entry,
  });

/** One run with its timeline, decoded like the port's output. */
export const automationRunDetailFixture = ({
  customerLifecycle,
  ...overrides
}: RunOverrides<
  typeof AutomationRunDetail.Encoded
> = {}): AutomationRunDetailWithLifecycle =>
  withLifecycle(
    Schema.decodeUnknownSync(AutomationRunDetail)({
      ...runFields,
      timeline: [],
      ...overrides,
    }),
    customerLifecycle
  );

const zeroCounts = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

type Counts<K extends string> = Partial<Record<K, number>>;

/** Run counts of the fixture campaign; omitted counts are zero. */
export const automationRunStatsFixture = ({
  byState,
  byOutcome,
  bySkipReason,
  ...overrides
}: Omit<
  Partial<typeof AutomationRunStats.Encoded>,
  "byState" | "byOutcome" | "bySkipReason"
> & {
  readonly byState?: Counts<AutomationRunState>;
  readonly byOutcome?: Counts<AutomationRunOutcome>;
  readonly bySkipReason?: Counts<AdministrationCampaignRecipientSkipReason>;
} = {}): AutomationRunStats =>
  Schema.decodeUnknownSync(AutomationRunStats)({
    campaignId: fixtureCampaignId,
    versionNumber: null,
    byState: { ...zeroCounts(automationRunStates), ...byState },
    byOutcome: { ...zeroCounts(automationRunOutcomes), ...byOutcome },
    bySkipReason: {
      ...zeroCounts(AdministrationCampaignRecipientSkipReason.literals),
      ...bySkipReason,
    },
    ...overrides,
  });

/** A healthy engine report; override fields to raise warnings. */
export const automationEngineHealthFixture = (
  overrides: Partial<typeof AutomationEngineHealth.Encoded> = {}
): AutomationEngineHealth =>
  Schema.decodeUnknownSync(AutomationEngineHealth)({
    lastPlannedAt: "2026-10-05T07:58:00.000Z",
    sweepLagSeconds: 5,
    reconcileLagSeconds: 1800,
    oldestUnprocessedEventAt: null,
    automations: [],
    unitDurations: [],
    units: [],
    oldestPlannedUnitAt: null,
    retryingUnits: [],
    deadlineMisses: 0,
    largestCustomerBookedCount: null,
    soloThreshold: null,
    warnings: [],
    ...overrides,
  });
