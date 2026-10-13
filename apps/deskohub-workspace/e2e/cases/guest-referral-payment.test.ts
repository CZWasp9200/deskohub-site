import { expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Exit } from "effect";
import { referralCodeQueryParam } from "@/features/referrals/client";
import { makeCoworkCheckoutData } from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import type { ReferralInvitationPaymentRecord } from "../integrations/database";
import type { WorkspaceE2ERunId } from "../run-identifiers";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutFlowState, WorkspaceE2ECase } from "../types";
import {
  assertGuestReferralPayment,
  bindGuestReferralPaymentCase,
  guestReferralPaymentCaseId,
  planGuestReferralPaymentCase,
  withGuestContact,
  withReferralCode,
} from "./guest-referral-payment";

const config: WorkspaceE2EConfig = {
  baseUrl: "https://workspace.example.test",
  bypassSecret: undefined,
  expectedHost: "workspace.example.test",
  timeouts: workspaceE2ETimeouts,
};

const invitationLabel = "Referral invitation discount";

const paidRecord = (
  overrides: Partial<ReferralInvitationPaymentRecord> = {}
): ReferralInvitationPaymentRecord => ({
  activePaymentAttemptId: "attempt-2",
  applications: [
    {
      adjustment: { basisPoints: 1500, kind: "percentage" },
      id: "application-2",
      label: invitationLabel,
      paymentAttemptId: "attempt-2",
    },
  ],
  attributions: [{ referrerDotyposCustomerId: "referrer" }],
  claims: [
    // A sandbox restart leaves the first attempt's claim released.
    {
      applicationId: "application-1",
      paymentAttemptId: "attempt-1",
      state: "released",
    },
    {
      applicationId: "application-2",
      paymentAttemptId: "attempt-2",
      state: "redeemed",
    },
  ],
  dotyposCustomerId: "guest",
  paymentState: "paid",
  ...overrides,
});

const expected = {
  guestCustomerId: "guest",
  invitationLabel,
  referrerCustomerId: "referrer",
};

test("accepts a paid guest order attributed to the seeded referrer", () => {
  expect(() =>
    assertGuestReferralPayment(paidRecord(), expected)
  ).not.toThrow();
});

test.each([
  ["the order is missing", undefined, "guest referral order missing"],
  [
    "the order is unpaid",
    paidRecord({ paymentState: "pending" }),
    "guest referral order is not paid",
  ],
  [
    "the order changed its booked customer",
    paidRecord({ dotyposCustomerId: "someone-else" }),
    "guest referral order changed its booked customer",
  ],
  [
    "the guest has no attribution",
    paidRecord({ attributions: [] }),
    "guest is not attributed to the seeded referrer",
  ],
  [
    "another referrer is attributed",
    paidRecord({ attributions: [{ referrerDotyposCustomerId: "other" }] }),
    "guest is not attributed to the seeded referrer",
  ],
  [
    "no claim is active",
    paidRecord({
      claims: [
        {
          applicationId: "application-2",
          paymentAttemptId: "attempt-2",
          state: "released",
        },
      ],
    }),
    "guest needs exactly one active referral invitation claim",
  ],
  [
    "the claim is still reserved",
    paidRecord({
      claims: [
        {
          applicationId: "application-2",
          paymentAttemptId: "attempt-2",
          state: "reserved",
        },
      ],
    }),
    "referral invitation claim not redeemed",
  ],
  [
    "the claim belongs to another attempt",
    paidRecord({
      claims: [
        {
          applicationId: "application-1",
          paymentAttemptId: "attempt-1",
          state: "redeemed",
        },
      ],
    }),
    "referral invitation claim is not on the paid attempt",
  ],
  [
    "the claim's application is missing",
    paidRecord({ applications: [] }),
    "referral invitation claim has no application on the paid attempt",
  ],
  [
    "the application label changed",
    paidRecord({
      applications: [
        {
          adjustment: { basisPoints: 1500, kind: "percentage" },
          id: "application-2",
          label: "Other",
          paymentAttemptId: "attempt-2",
        },
      ],
    }),
    "referral invitation application label changed",
  ],
  [
    "the application is not 15%",
    paidRecord({
      applications: [
        {
          adjustment: { basisPoints: 1000, kind: "percentage" },
          id: "application-2",
          label: invitationLabel,
          paymentAttemptId: "attempt-2",
        },
      ],
    }),
    "referral invitation application is not 15%",
  ],
] as const)(
  "rejects a guest referral payment when %s",
  (_description, record, message) => {
    expect(() => assertGuestReferralPayment(record, expected)).toThrow(message);
  }
);

test("opens the reservation from a referral link as the run-scoped guest", () => {
  const planned = makeCoworkCheckoutData(config.baseUrl, "2099-08-03");
  const data = withReferralCode(
    withGuestContact(planned, testEmailAddress("delivered+run-gr-guest")),
    "RFLABCDEF12"
  );
  const url = new URL(data.checkoutUrl);

  expect(data.email).toBe(testEmailAddress("delivered+run-gr-guest"));
  expect(url.searchParams.get("email")).toBe(data.email);
  expect(url.searchParams.getAll(referralCodeQueryParam)).toEqual([
    "RFLABCDEF12",
  ]);
  expect(url.pathname).toBe("/en-US/reservation/cowork");
  expect(url.searchParams.get("date")).toBe("2099-08-03");
  expect(url.searchParams.get("name")).toBe(planned.name);
});

test("plans the guest referral payment on its own date and requires binding", async () => {
  const flowStates: CheckoutFlowState[] = [
    { data: makeCoworkCheckoutData(config.baseUrl, "2099-08-01") },
    { data: makeCoworkCheckoutData(config.baseUrl, "2099-08-02") },
  ];
  const planned = await Effect.runPromise(
    planGuestReferralPaymentCase({
      allocation: {
        fromOffsetDays: 0,
        shardCount: 1,
        shardIndex: 0,
        toOffsetDays: 0,
      },
      availableBasicDates: ["2099-08-01", "2099-08-02", "2099-08-03"],
      config,
      flowStates,
    })
  );

  expect(planned.id).toBe(guestReferralPaymentCaseId);
  expect(planned.checkoutStates.map(({ data }) => data.date)).toEqual([
    "2099-08-03",
  ]);
  expect(flowStates.at(-1)).toBe(planned.checkoutStates[0]);
  const exit = await Effect.runPromiseExit(
    planned.execute({
      runStep: (step) => step.execute,
      session: "session",
    }) as Effect.Effect<void, unknown>
  );
  expect(Exit.isFailure(exit)).toBe(true);
});

test("leaves other planned cases unbound", async () => {
  const other: WorkspaceE2ECase = {
    checkoutStates: [],
    execute: () => Effect.void,
    id: "checkout-cowork-basic",
    timeoutMs: 1,
  };
  expect(
    await bindGuestReferralPaymentCase({
      environment: {} as never,
      run: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
      runId: "run" as WorkspaceE2ERunId,
      testCase: other,
    })
  ).toBe(other);
});
