import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { m } from "@/features/i18n";
import {
  WithdrawalNameRequiredError,
  WithdrawalService,
} from "@/features/withdrawal/backend/withdrawal.service";
import { WithdrawalReleaseGate } from "@/features/withdrawal/backend/withdrawal-release-gate";
import type { WithdrawalId } from "@/features/withdrawal/withdrawal-identifiers";
import { mockWorkspaceActionRequest } from "@/shared/testing/workspace-action-request.test-utils";

await mockWorkspaceActionRequest();

// The request's release decision for the online withdrawal function.
let released = true;
mock.module(
  "@/features/withdrawal/backend/withdrawal-release-gate.server",
  () => ({
    WithdrawalReleaseGateRequest: WithdrawalReleaseGate.fromEvaluation(
      Effect.suspend(() => Effect.succeed(released))
    ),
  })
);

type TestUser = {
  readonly accountId: "@test/account-id";
  readonly email: string;
  readonly deletionRequested: boolean;
};
let currentUser: Effect.Effect<TestUser | null> = Effect.succeed({
  accountId: "@test/account-id",
  email: testEmailAddress("customer"),
  deletionRequested: false,
});
const Authentication = Context.Service<
  Authentication,
  { readonly currentUser: Effect.Effect<TestUser | null> }
>()("@test/WithdrawalActionsAuthentication");
Object.assign(Authentication, {
  Default: Layer.effect(
    Authentication,
    Effect.succeed({
      get currentUser() {
        return currentUser;
      },
    })
  ),
});
mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({ CustomerAuthentication: Authentication })
);

const calls: string[] = [];
// Whether the mocked profile has a name for the statement.
let profileNamed = true;
const paid = { value: 300_000, exponent: 2, currency: "CZK" };
Object.assign(WithdrawalService, {
  Live: Layer.mock(WithdrawalService, {
    quote: (input) =>
      Effect.sync(() => {
        calls.push(`quote ${input.accountId} ${input.contract.id}`);
        return {
          contractId: input.contract.id,
          contractLabel: "Office · 10.–12. 1. 2027",
          customerName: null,
          receiptEmail: testEmailAddress("customer"),
          paidAmount: paid,
          refundAmount: paid,
          refundBasis: { kind: "full" } as const,
          periodEndsAt: Temporal.Instant.from("2027-01-16T23:00:00Z"),
        };
      }),
    withdraw: (input) =>
      Effect.suspend(() => {
        calls.push(
          `withdraw ${input.accountId} ${input.contract.id}${input.customerName === undefined ? "" : ` as ${input.customerName}`}`
        );
        if (!profileNamed && !input.customerName?.trim()) {
          return Effect.fail(new WithdrawalNameRequiredError());
        }
        return Effect.succeed({
          withdrawalId: "withdrawal-1" as WithdrawalId,
          submittedAt: Temporal.Instant.from("2027-01-10T08:00:00Z"),
          refundAmount: paid,
          receiptEmail: testEmailAddress("customer"),
        });
      }),
  }),
});

const importActions = () => import("./withdrawal-actions");

describe("reservation withdrawal actions", () => {
  beforeEach(() => {
    released = true;
    profileNamed = true;
    calls.length = 0;
    currentUser = Effect.succeed({
      accountId: "@test/account-id",
      email: testEmailAddress("customer"),
      deletionRequested: false,
    });
  });

  test("refuse as unavailable while the function isn't released, before any withdrawal work", async () => {
    released = false;
    const { quoteReservationWithdrawal, withdrawFromReservation } =
      await importActions();

    const quote = await quoteReservationWithdrawal({
      orderId: "reservation-1",
    });
    const withdrawal = await withdrawFromReservation({
      orderId: "reservation-1",
    });

    const unavailable = m.accountUnavailableDescription(
      {},
      { locale: "en-US" }
    );
    expect(quote.serverError).toBe(unavailable);
    expect(withdrawal.serverError).toBe(unavailable);
    expect(calls).toEqual([]);
  });

  test("quote and withdraw for the session's account while released", async () => {
    const { quoteReservationWithdrawal, withdrawFromReservation } =
      await importActions();

    const quote = await quoteReservationWithdrawal({
      orderId: "reservation-1",
    });
    const withdrawal = await withdrawFromReservation({
      orderId: "reservation-1",
    });

    expect(quote.data).toMatchObject({
      status: "available",
      quote: { periodEndsAt: "2027-01-16T23:00:00Z" },
    });
    expect(withdrawal.data).toEqual({
      status: "withdrawn",
      receipt: {
        withdrawalId: "withdrawal-1",
        submittedAt: "2027-01-10T08:00:00Z",
        refundAmount: paid,
        receiptEmail: testEmailAddress("customer"),
      },
    });
    expect(calls).toEqual([
      "quote @test/account-id reservation-1",
      "withdraw @test/account-id reservation-1",
    ]);
  });

  test("pass the typed name to the withdrawal", async () => {
    profileNamed = false;
    const { withdrawFromReservation } = await importActions();

    const withdrawal = await withdrawFromReservation({
      orderId: "reservation-1",
      customerName: "Sam Typed",
    });

    expect(withdrawal.data).toMatchObject({ status: "withdrawn" });
    expect(calls).toEqual([
      "withdraw @test/account-id reservation-1 as Sam Typed",
    ]);
  });

  test("answer that the statement needs a name when neither the profile nor the customer gave one", async () => {
    profileNamed = false;
    const { withdrawFromReservation } = await importActions();

    const withdrawal = await withdrawFromReservation({
      orderId: "reservation-1",
    });

    expect(withdrawal.data).toEqual({ status: "name_required" });
  });

  test("refuse a signed-out request without touching withdrawals", async () => {
    currentUser = Effect.succeed(null);
    const { withdrawFromReservation } = await importActions();

    const withdrawal = await withdrawFromReservation({
      orderId: "reservation-1",
    });

    expect(withdrawal.serverError).toBeString();
    expect(calls).toEqual([]);
  });
});
