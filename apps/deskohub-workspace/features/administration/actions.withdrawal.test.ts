import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CurrentAdministrationCaller } from "@deskohub/workspace-admin-api";
import { Effect, Layer, Option } from "effect";
import type { AdministrationActionEnd } from "@/features/admin-cli/administration-action-log.service";
import type { ContractWithdrawal } from "@/features/withdrawal/backend/withdrawal.repository";
import type { WithdrawableContractRef } from "@/features/withdrawal/withdrawable-contract";
import { withdrawalIdSchema } from "@/features/withdrawal/withdrawal-identifiers";
import { mockAdministrationActionRequest } from "@/shared/testing/workspace-action-request.test-utils";

mock.module("server-only", () => ({}));
const { access } = await mockAdministrationActionRequest({
  administrator: "withdrawal-settlement",
  referer: "https://deskohub.test/en-US/admin",
});

const nextCacheModule = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCacheModule,
  revalidatePath: () => undefined,
}));

const { WithdrawalService } = await import(
  "@/features/withdrawal/backend/withdrawal.service"
);
const { m } = await import("./i18n");

const { AdministrationActionLog } = await import(
  "@/features/admin-cli/administration-action-log.service"
);

const reservationId = "reservation-withdrawal-1";
const submittedAt = Temporal.Instant.from("2026-11-18T12:01:00Z");
const retryAt = submittedAt.add({ hours: 1 });
const noRetry = { attempts: 0, failureCode: null, retryAt: null };
const payment = { value: 120_000, exponent: 2, currency: "CZK" };
const withdrawal: ContractWithdrawal = {
  id: withdrawalIdSchema.make("withdrawal-settlement"),
  contract: { kind: "reservation", id: reservationId },
  accountId: access.administrator.accountId,
  locale: "en-US",
  contractLabel: "Synthetic reservation",
  submittedAt,
  periodEndsAt: submittedAt.add({ hours: 14 * 24 }),
  paidAmount: payment,
  refundAmount: payment,
  refundBasis: { kind: "full" },
  receiptSentAt: submittedAt,
  operatorNotifiedAt: submittedAt,
  contractCancelledAt: null,
  settledAt: null,
  settlementClaimedAt: null,
  stepRetries: {
    receipt: noRetry,
    operator_notice: noRetry,
    contract_cancellation: {
      attempts: 2,
      failureCode: "reservation_dotypos_unavailable",
      retryAt,
    },
  },
};

const settled: WithdrawableContractRef[] = [];
const provenance = mock(
  (_input: {
    readonly caller: CurrentAdministrationCaller["Service"];
    readonly operation: string;
  }) => Effect.succeed("admin-action")
);
const finish = mock(
  (_id: string, _end: AdministrationActionEnd) => Effect.void
);
let answer: Option.Option<{
  readonly outcome: "failed" | "already_settled";
  readonly withdrawal: ContractWithdrawal;
}> = Option.none();

const originalWithdrawalService = WithdrawalService.Live;
const originalActionLog = AdministrationActionLog.Live;
WithdrawalService.Live = Layer.mock(WithdrawalService, {
  settleNow: (contract) =>
    Effect.sync(() => {
      expect(provenance).toHaveBeenCalledTimes(1);
      settled.push(contract);
      return answer;
    }),
}) as typeof WithdrawalService.Live;
AdministrationActionLog.Live = Layer.mock(AdministrationActionLog, {
  start: provenance,
  finish,
});

// Imported after the substitution, since the actions take the layer on load.
const { settleAdministrationReservationWithdrawal } = await import("./actions");

afterAll(() => {
  WithdrawalService.Live = originalWithdrawalService;
  AdministrationActionLog.Live = originalActionLog;
});

describe("settleAdministrationReservationWithdrawal", () => {
  beforeEach(() => {
    access.set("administrator");
    settled.length = 0;
    provenance.mockClear();
    finish.mockClear();
    answer = Option.none();
  });

  test("settles only the reservation's own withdrawal and answers how it went", async () => {
    answer = Option.some({ outcome: "failed", withdrawal });

    const result = await settleAdministrationReservationWithdrawal({
      reservationId,
    });

    expect(result.data).toMatchObject({
      outcome: "failed",
      withdrawal: {
        settlement: "needs_attention",
        steps: [
          { step: "receipt", status: "done" },
          { step: "operator_notice", status: "done" },
          {
            step: "contract_cancellation",
            status: "failed",
            attempts: 2,
            failureCode: "reservation_dotypos_unavailable",
            retryAt: retryAt.toString(),
          },
        ],
      },
    });
    expect(provenance).toHaveBeenCalledWith({
      operation: "administration.retryReservationWithdrawal",
      caller: { actor: access.administrator, channel: { _tag: "AdminUi" } },
    });
    expect(finish).toHaveBeenCalledWith("admin-action", {
      outcome: "succeeded",
    });
    expect(settled).toEqual([{ kind: "reservation", id: reservationId }]);
  });

  test("answers a settled withdrawal as already settled", async () => {
    answer = Option.some({
      outcome: "already_settled",
      withdrawal: {
        ...withdrawal,
        contractCancelledAt: submittedAt,
        settledAt: submittedAt,
      },
    });

    const result = await settleAdministrationReservationWithdrawal({
      reservationId,
    });

    expect(result.data).toMatchObject({
      outcome: "already_settled",
      withdrawal: { settlement: "settled" },
    });
  });

  test("reports a reservation without a withdrawal", async () => {
    answer = Option.none();

    const result = await settleAdministrationReservationWithdrawal({
      reservationId,
    });

    expect(result).toEqual({
      serverError: m.administrationWithdrawalRetryNotFound(
        {},
        { locale: "en-US" }
      ),
    });
  });

  for (const denied of ["not-administrator", "signed-out"] as const) {
    test(`settles nothing for a ${denied} caller`, async () => {
      access.set(denied);

      const result = await settleAdministrationReservationWithdrawal({
        reservationId,
      });

      expect(result.data).toBeUndefined();
      expect(result.serverError).toBeString();
      expect(settled).toEqual([]);
      expect(provenance).not.toHaveBeenCalled();
    });
  }
});
