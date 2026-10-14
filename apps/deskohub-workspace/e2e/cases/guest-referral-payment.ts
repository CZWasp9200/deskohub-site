import { deepStrictEqual } from "node:assert/strict";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { canonicalPromotionCodeSchema } from "@/features/discounts/persistence-contracts";
import { m } from "@/features/i18n";
import { referralCodeQueryParam } from "@/features/referrals/client";
import { makeWorkspaceE2EAccountRecipientForRunId } from "../account/config";
import { createSyntheticCustomerProfile } from "../account/fixtures";
import { makeWorkspaceE2EAccountJournalRecorder } from "../account/journal";
import type { WorkspaceE2EAccountJournalOwner } from "../account/reconcile";
import { seedWorkspaceE2EReferralOwner } from "../account/referral-fixture";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import { waitForBrowserUrl } from "../browser";
import { getSubmitCoworkReservationScript } from "../browser-scripts";
import {
  makeCoworkCheckoutData,
  requireCheckoutDate,
  selectCoworkDates,
} from "../checkout/data";
import {
  applyDiscountCode,
  assertRequestedOnlyDiscountCode,
} from "../checkout/discount-code";
import {
  type DatasourceConfig,
  getConfig,
  getDatasourceConfig,
  type WorkspaceE2EConfig,
} from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import {
  type ExpectedDiscountApplication,
  type ReferralInvitationPaymentRecord,
  readReferralInvitationPayment,
  waitForCheckoutRow,
} from "../integrations/database";
import { E2EDatabase } from "../integrations/database.service";
import type { WorkspaceE2ECaseBinder } from "../playwright-checkout/fixtures";
import {
  isReferralAppliedPayUrl,
  referralAppliedMessage,
} from "../referrals/checkout";
import {
  waitForNoRememberedReferralCode,
  waitForRememberedReferralCode,
} from "../referrals/referral-cookie";
import type { WorkspaceE2ERunId } from "../run-identifiers";
import { addRedaction, assert, type Runner } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlowState,
  CheckoutRow,
  WorkspaceE2ECase,
  WorkspaceE2EStep,
} from "../types";
import { executeCheckoutFlow } from "./checkout";
import {
  assertDisplayedDiscounts,
  calendarDiscountExpectation,
} from "./discounts";

export const guestReferralPaymentCaseId = "checkout-guest-referral";

const referrerRecipientLabel = "gr-referrer";
const guestRecipientLabel = "gr-guest";

/**
 * The case's own identity journal: the seeded referrer and the guest
 * customer the booking creates, each derived from a run-scoped recipient.
 */
export const guestReferralPaymentJournalOwner: WorkspaceE2EAccountJournalOwner =
  {
    ownerId: guestReferralPaymentCaseId,
    recipientLabels: [referrerRecipientLabel, guestRecipientLabel],
  };

const invitationAdjustment = {
  basisPoints: 1500,
  kind: "percentage",
} as const;

const getInvitationDiscount = (
  locale: CheckoutData["locale"]
): ExpectedDiscountApplication => ({
  adjustment: invitationAdjustment,
  label: m.checkoutSummaryItemReferralInvitationDiscount({}, { locale }),
});

/**
 * The paid guest order's discount applications, in order. The long-lived E2E
 * Calendar sale covers every cowork date, so the invitation applies after it,
 * to the sale's remaining subtotal.
 */
export const getGuestReferralDiscounts = (
  locale: CheckoutData["locale"]
): readonly ExpectedDiscountApplication[] => [
  calendarDiscountExpectation,
  getInvitationDiscount(locale),
];

/**
 * Plans the paid guest-referral checkout on its own cowork date, after every
 * other case has planned its dates. The case pool binds the run-scoped
 * identities before the case runs.
 */
export const planGuestReferralPaymentCase = ({
  allocation,
  availableBasicDates,
  config,
  flowStates,
}: {
  readonly allocation: WorkspaceE2EDateAllocation;
  readonly availableBasicDates: readonly string[];
  readonly config: WorkspaceE2EConfig;
  readonly flowStates: CheckoutFlowState[];
}): Effect.Effect<WorkspaceE2ECase, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dates = yield* selectCoworkDates(availableBasicDates, 1, {
      allocation,
      excludedDates: new Set(flowStates.map(({ data }) => data.date)),
      selectionLabel: "guest referral payment",
    });
    const state: CheckoutFlowState = {
      data: makeCoworkCheckoutData(
        config.baseUrl,
        yield* requireCheckoutDate(dates, 0),
        guestReferralPaymentCaseId
      ),
    };
    flowStates.push(state);
    return {
      checkoutStates: [state],
      execute: () =>
        Effect.fail(
          workspaceE2EError(
            `${guestReferralPaymentCaseId} must be bound to its run-scoped identities by the case pool`,
            { operation: "bind guest referral payment case" }
          )
        ),
      id: guestReferralPaymentCaseId,
      timeoutMs: config.timeouts.checkoutCase,
    };
  });

/** Binds the planned case to this run's synthetic referrer and guest. */
export const bindGuestReferralPaymentCase: WorkspaceE2ECaseBinder = async ({
  environment,
  run,
  runId,
  testCase,
}) => {
  if (testCase.id !== guestReferralPaymentCaseId) return testCase;
  const [state] = testCase.checkoutStates;
  if (!state || testCase.checkoutStates.length !== 1) {
    throw new Error("planned guest referral payment checkout is incomplete");
  }
  const config = getConfig(environment);
  const datasourceConfig = getDatasourceConfig(environment);
  const boundState: CheckoutFlowState = {
    data: withGuestContact(
      state.data,
      makeWorkspaceE2EAccountRecipientForRunId(runId, guestRecipientLabel)
    ),
  };
  return {
    ...testCase,
    checkoutStates: [boundState],
    execute: ({ runStep, session }) =>
      executeGuestReferralPayment({
        config,
        datasourceConfig,
        run,
        runId,
        runStep,
        session,
        state: boundState,
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.mapError((cause) =>
          toWorkspaceE2EError("run guest referral payment e2e case", cause)
        )
      ),
  };
};

const withGuestContact = (
  data: CheckoutData,
  email: string
): CheckoutData => {
  const url = new URL(data.checkoutUrl);
  url.searchParams.set("email", email);
  return { ...data, checkoutUrl: url.toString(), email };
};

/** The reservation URL a guest opens from a shared referral link. */
const withReferralCode = (
  data: CheckoutData,
  code: string
): CheckoutData => {
  const url = new URL(data.checkoutUrl);
  url.searchParams.set(referralCodeQueryParam, code);
  return { ...data, checkoutUrl: url.toString() };
};

const executeGuestReferralPayment = Effect.fn("GuestReferralPayment.execute")(
  function* ({
    config,
    datasourceConfig,
    run,
    runId,
    runStep,
    session,
    state,
  }: {
    readonly config: WorkspaceE2EConfig;
    readonly datasourceConfig: DatasourceConfig;
    readonly run: Runner;
    readonly runId: WorkspaceE2ERunId;
    readonly runStep: Parameters<WorkspaceE2ECase["execute"]>[0]["runStep"];
    readonly session: string;
    readonly state: CheckoutFlowState;
  }) {
    const database = yield* E2EDatabase;
    const journal = makeIdentityJournal();
    const locale = state.data.locale;
    const invitationDiscount = getInvitationDiscount(locale);
    const expectedDiscounts = getGuestReferralDiscounts(locale);

    yield* runStep({
      execute: waitForNoRememberedReferralCode({ config, run, session }),
      id: "starts-without-remembered-referral-code",
      timeoutMs: config.timeouts.uiTransition,
    });
    const referrer = yield* runStep({
      execute: seedReferrer({
        datasourceConfig,
        email: makeWorkspaceE2EAccountRecipientForRunId(
          runId,
          referrerRecipientLabel
        ),
        journal,
      }),
      id: "seed-synthetic-referrer",
      timeoutMs: config.timeouts.datasource,
    });
    const data = withReferralCode(state.data, referrer.code);
    state.data = data;

    let guestCustomerId: string | undefined;
    const payPageSteps = (
      orderId: CheckoutRow["reservation_id"]
    ): readonly WorkspaceE2EStep<void>[] => [
      {
        // Journal the booked guest before payment can attribute it.
        execute: Effect.gen(function* () {
          const row = yield* waitForCheckoutRow(datasourceConfig, orderId);
          const customerId = yield* tryWorkspaceE2ESync(
            "read booked guest customer",
            () => {
              assert(row.dotypos_customer_id, "booked guest customer missing");
              assert(
                row.dotypos_customer_id !== referrer.customerId,
                "guest booking resolved to the referrer"
              );
              return row.dotypos_customer_id;
            }
          );
          guestCustomerId = customerId;
          yield* journal.record({ dotyposCustomerIds: [customerId] });
        }).pipe(Effect.provideService(E2EDatabase, database)),
        id: "journal-booked-guest-customer",
        timeoutMs: config.timeouts.datasource,
      },
      {
        // The shared reservation link left its code in the guest's cookie,
        // which prefills the box.
        execute: waitForRememberedReferralCode(
          { config, run, session },
          referrer.code
        ),
        id: "remember-shared-referral-code",
        timeoutMs: config.timeouts.uiTransition,
      },
      {
        execute: assertRequestedOnlyDiscountCode({
          code: canonicalPromotionCodeSchema.make(referrer.code),
          config,
          run,
          session,
        }),
        id: "assert-referral-code-prefilled",
        timeoutMs: config.timeouts.uiTransition,
      },
      {
        execute: Effect.gen(function* () {
          yield* applyDiscountCode({
            appliedMessage: referralAppliedMessage(locale),
            code: referrer.code,
            config,
            run,
            session,
          });
          yield* waitForBrowserUrl({
            description: "referral-applied pay page",
            matches: (currentUrl) =>
              isReferralAppliedPayUrl({
                baseUrl: config.baseUrl,
                currentUrl,
                locale,
                orderId,
              }),
            run,
            session,
            timeoutMs: config.timeouts.uiTransition,
          });
        }),
        id: "apply-referral-invitation-code",
        timeoutMs: config.timeouts.uiTransition,
      },
      {
        execute: assertDisplayedDiscounts({
          config,
          discounts: expectedDiscounts,
          run,
          session,
        }),
        id: "assert-referral-invitation-discount",
        timeoutMs: config.timeouts.uiTransition,
      },
    ];

    yield* executeCheckoutFlow({
      config,
      data,
      datasourceConfig,
      expectedDiscounts,
      flow: {
        id: guestReferralPaymentCaseId,
        submitReservationScript: getSubmitCoworkReservationScript,
      },
      payPageSteps,
      run,
      runStep,
      session,
      state,
    });

    yield* runStep({
      // The paid status page uses the remembered code up.
      execute: waitForNoRememberedReferralCode({ config, run, session }),
      id: "forget-referral-code-after-paid-status",
      timeoutMs: config.timeouts.uiTransition,
    });
    const orderId = state.orderId;
    yield* runStep({
      execute: Effect.gen(function* () {
        const record = orderId
          ? yield* readReferralInvitationPayment(orderId)
          : undefined;
        yield* tryWorkspaceE2ESync("assert guest referral payment", () =>
          assertGuestReferralPayment(record, {
            guestCustomerId,
            invitationLabel: invitationDiscount.label,
            referrerCustomerId: referrer.customerId,
          })
        );
      }),
      id: "validate-guest-referral-attribution",
      timeoutMs: config.timeouts.datasource,
    });
  }
);

const seedReferrer = Effect.fn("GuestReferralPayment.seedReferrer")(function* ({
  datasourceConfig,
  email,
  journal,
}: {
  readonly datasourceConfig: DatasourceConfig;
  readonly email: string;
  readonly journal: IdentityJournal;
}) {
  const accountId = customerAccountIdSchema.make(
    `guest-referral-referrer-${crypto.randomUUID()}`
  );
  yield* journal.record({ authUserIds: [accountId] });
  const customerId = yield* createSyntheticCustomerProfile(datasourceConfig, {
    email,
    firstName: "Guest Referral Referrer",
  });
  yield* journal.record({ dotyposCustomerIds: [customerId] });
  const owner = yield* seedWorkspaceE2EReferralOwner({
    accountId,
    dotyposCustomerId: customerId,
    email,
    name: "Synthetic Guest Referral Referrer",
  });
  addRedaction(owner.code, true);
  return { code: owner.code, customerId };
});

type IdentityJournal = ReturnType<typeof makeIdentityJournal>;

/** Writes every identity the case creates to its journal as it appears. */
const makeIdentityJournal = () => {
  const recorder = makeWorkspaceE2EAccountJournalRecorder(
    guestReferralPaymentCaseId
  );
  return {
    record: (update: Parameters<typeof recorder.record>[0]) =>
      Effect.tryPromise({
        catch: (cause) =>
          workspaceE2EError("record guest referral identity", {
            cause,
            operation: "record guest referral identity",
          }),
        try: () => recorder.record(update),
      }),
  };
};

/**
 * The paid guest order carries the 15% invitation: the booked customer is
 * attributed to the seeded referrer, and its one active invitation claim is
 * redeemed by the order's active attempt through that attempt's invitation
 * application.
 */
export const assertGuestReferralPayment = (
  record: ReferralInvitationPaymentRecord | undefined,
  expected: {
    readonly guestCustomerId: string | undefined;
    readonly invitationLabel: string;
    readonly referrerCustomerId: string;
  }
) => {
  assert(record, "guest referral order missing");
  assert(record.paymentState === "paid", "guest referral order is not paid");
  assert(
    record.dotyposCustomerId !== null &&
      record.dotyposCustomerId === expected.guestCustomerId,
    "guest referral order changed its booked customer"
  );
  assert(
    record.attributions.length === 1 &&
      record.attributions[0]?.referrerDotyposCustomerId ===
        expected.referrerCustomerId,
    "guest is not attributed to the seeded referrer"
  );
  const activeClaims = record.claims.filter(
    ({ state }) => state === "reserved" || state === "redeemed"
  );
  const [claim] = activeClaims;
  assert(
    claim && activeClaims.length === 1,
    "guest needs exactly one active referral invitation claim"
  );
  assert(claim.state === "redeemed", "referral invitation claim not redeemed");
  assert(
    record.activePaymentAttemptId !== null &&
      claim.paymentAttemptId === record.activePaymentAttemptId,
    "referral invitation claim is not on the paid attempt"
  );
  const application = record.applications.find(
    ({ id }) => id === claim.applicationId
  );
  assert(
    application?.paymentAttemptId === record.activePaymentAttemptId,
    "referral invitation claim has no application on the paid attempt"
  );
  assert(
    application.label === expected.invitationLabel,
    "referral invitation application label changed"
  );
  deepStrictEqual(
    application.adjustment,
    invitationAdjustment,
    "referral invitation application is not 15%"
  );
};
