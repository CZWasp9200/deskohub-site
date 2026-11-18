import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer, Option } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WithdrawalRepository } from "./withdrawal.repository";
import {
  WithdrawalRefusedError,
  WithdrawalService,
} from "./withdrawal.service";
import { WithdrawalReleaseGate } from "./withdrawal-release-gate";

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
let currentUser: TestUser | null = null;
const Authentication = Context.Service<
  Authentication,
  { readonly currentUser: Effect.Effect<TestUser | null> }
>()("@test/WithdrawalEntryAuthentication");
Object.assign(Authentication, {
  Default: Layer.effect(
    Authentication,
    Effect.succeed({
      get currentUser() {
        return Effect.succeed(currentUser);
      },
    })
  ),
});
mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({ CustomerAuthentication: Authentication })
);

const refund = { value: 40_000, exponent: 2, currency: "CZK" };
const calls: string[] = [];
// The recorded withdrawal's refund, `"unreadable"` for a failing ledger.
let recorded: typeof refund | "unreadable" | undefined;
let quotable = true;

Object.assign(WithdrawalRepository, {
  Live: Layer.mock(WithdrawalRepository, {
    findByContract: (contract) =>
      Effect.suspend(() => {
        calls.push(`find ${contract.id}`);
        if (recorded === "unreadable") {
          return Effect.fail(new Error("ledger unavailable") as never);
        }
        return Effect.succeed(
          recorded
            ? Option.some({ refundAmount: recorded } as never)
            : Option.none()
        );
      }),
  }),
});
Object.assign(WithdrawalService, {
  Live: Layer.mock(WithdrawalService, {
    quote: (input) =>
      Effect.suspend(() => {
        calls.push(`quote ${input.contract.id}`);
        return quotable
          ? Effect.succeed({} as never)
          : Effect.fail(new WithdrawalRefusedError({ reason: "period_ended" }));
      }),
  }),
});

const reservationId = "reservation-1" as WorkspaceReservationId;
const readEntry = async () => {
  const { readReservationWithdrawalEntry } = await import(
    "./withdrawal-entry.server"
  );
  return Effect.runPromise(
    readReservationWithdrawalEntry({ reservationId, locale: "en-US" })
  );
};

describe("readReservationWithdrawalEntry", () => {
  beforeEach(() => {
    released = true;
    currentUser = {
      accountId: "@test/account-id",
      email: "customer@example.test",
      deletionRequested: false,
    };
    recorded = undefined;
    quotable = true;
    calls.length = 0;
  });

  test("shows a recorded withdrawal with its refund", async () => {
    recorded = refund;
    quotable = false;

    expect(await readEntry()).toEqual({
      status: "withdrawn",
      refundAmount: refund,
    });
  });

  test("shows a recorded withdrawal to a signed-out viewer after the function closed", async () => {
    recorded = refund;
    released = false;
    currentUser = null;

    expect(await readEntry()).toEqual({
      status: "withdrawn",
      refundAmount: refund,
    });
  });

  test("offers the withdrawal while the customer's quote is available", async () => {
    expect(await readEntry()).toEqual({ status: "offered" });
    expect(calls.toSorted()).toEqual([
      "find reservation-1",
      "quote reservation-1",
    ]);
  });

  test("offers nothing when the quote is refused", async () => {
    quotable = false;

    expect(await readEntry()).toEqual({ status: "none" });
  });

  test("offers nothing and makes no quote while the function is closed", async () => {
    released = false;

    expect(await readEntry()).toEqual({ status: "none" });
    expect(calls).toEqual(["find reservation-1"]);
  });

  test("falls back to the offer when the ledger can't be read", async () => {
    recorded = "unreadable";

    expect(await readEntry()).toEqual({ status: "offered" });
  });
});
