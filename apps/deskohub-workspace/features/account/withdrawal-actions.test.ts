import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { m } from "@/features/i18n";
import { WithdrawalService } from "@/features/withdrawal/backend/withdrawal.service";
import { WithdrawalReleaseGate } from "@/features/withdrawal/backend/withdrawal-release-gate";
import type { WithdrawalId } from "@/features/withdrawal/withdrawal-identifiers";
import { mockWorkspaceActionRequest } from "@/shared/testing/workspace-action-request.test-utils";

await mockWorkspaceActionRequest();

// The request's release decision for the online withdrawal function.
let released = true;
mock.module(
  "@/features/withdrawal/backend/withdrawal-release-gate.server",
  () => ({
    isWithdrawalEnabled: async () => released,
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
  email: "customer@example.test",
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
          receiptEmail: "customer@example.test",
          paidAmount: paid,
          refundAmount: paid,
          refundBasis: { kind: "full" } as const,
          periodEndsAt: Temporal.Instant.from("2027-01-16T23:00:00Z"),
        };
      }),
    withdraw: (input) =>
      Effect.sync(() => {
        calls.push(`withdraw ${input.accountId} ${input.contract.id}`);
        return {
          withdrawalId: "withdrawal-1" as WithdrawalId,
          submittedAt: Temporal.Instant.from("2027-01-10T08:00:00Z"),
          refundAmount: paid,
          receiptEmail: "customer@example.test",
        };
      }),
  }),
});

const importActions = () => import("./withdrawal-actions");

describe("reservation withdrawal actions", () => {
  beforeEach(() => {
    released = true;
    calls.length = 0;
    currentUser = Effect.succeed({
      accountId: "@test/account-id",
      email: "customer@example.test",
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
        receiptEmail: "customer@example.test",
      },
    });
    expect(calls).toEqual([
      "quote @test/account-id reservation-1",
      "withdraw @test/account-id reservation-1",
    ]);
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
