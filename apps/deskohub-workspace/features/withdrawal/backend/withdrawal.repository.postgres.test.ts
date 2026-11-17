import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Money } from "@/shared/money/money";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  WithdrawalRepository,
  withdrawalSettlementSteps,
} from "./withdrawal.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "WithdrawalRepository on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const contractIds: string[] = [];
    const accountIds: CustomerAccountId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from contract_withdrawals where contract_id = any($1)",
        [contractIds]
      );
      await testDatabase.pool.query(
        "delete from customer_accounts where id = any($1)",
        [accountIds]
      );
    });

    const run = <A, E>(
      operation: (
        repository: typeof WithdrawalRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* WithdrawalRepository);
        }).pipe(
          Effect.provide(WithdrawalRepository.Default),
          Effect.provide(testDatabase.layer)
        )
      );

    const paid: Money = { value: 300_000, exponent: 2, currency: "CZK" };

    const newWithdrawal = async (
      submittedAt = Temporal.Now.instant().round("millisecond")
    ) => {
      const accountId = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).customerAccount()
      );
      accountIds.push(accountId);
      const contractId = `reservation-${crypto.randomUUID()}`;
      contractIds.push(contractId);
      return {
        contract: { kind: "reservation" as const, id: contractId },
        accountId,
        locale: "cs-CZ" as const,
        contractLabel: "Office · 10.–12. 1. 2027",
        submittedAt,
        periodEndsAt: submittedAt.add({ hours: 24 * 14 }),
        paidAmount: paid,
        refundAmount: { ...paid, value: 200_000 },
        refundBasis: {
          kind: "partial" as const,
          unit: "day" as const,
          unstarted: 2,
          total: 3,
        },
      };
    };

    test("records one withdrawal per contract, claimed by its request", async () => {
      const withdrawal = await newWithdrawal();
      const first = await run((repository) => repository.record(withdrawal));
      const second = await run((repository) =>
        repository.record({
          ...withdrawal,
          submittedAt: withdrawal.submittedAt.add({ minutes: 1 }),
        })
      );

      expect(first.recorded).toBe(true);
      expect(second).toMatchObject({
        recorded: false,
        withdrawal: { id: first.withdrawal.id },
      });
      expect(first.withdrawal).toMatchObject({
        contract: withdrawal.contract,
        refundAmount: withdrawal.refundAmount,
        refundBasis: withdrawal.refundBasis,
        stepRetries: {
          receipt: { attempts: 0, failureCode: null, retryAt: null },
          operator_notice: { attempts: 0, failureCode: null, retryAt: null },
          contract_cancellation: {
            attempts: 0,
            failureCode: null,
            retryAt: null,
          },
        },
        settledAt: null,
      });
      expect(
        first.withdrawal.settlementClaimedAt?.equals(withdrawal.submittedAt)
      ).toBe(true);
      expect(
        await run((repository) =>
          repository.listWithdrawnContractIds({
            kind: "reservation",
            contractIds: [withdrawal.contract.id, "reservation-unknown"],
          })
        )
      ).toEqual(new Set([withdrawal.contract.id]));
    });

    test("fences steps by the claim and retries a failed step once it is due", async () => {
      const withdrawal = await newWithdrawal();
      const { withdrawal: recorded } = await run((repository) =>
        repository.record(withdrawal)
      );
      const claim = { id: recorded.id, claimedAt: withdrawal.submittedAt };

      expect(
        await run((repository) =>
          repository.markStepDone({
            ...claim,
            step: "receipt",
            doneAt: Temporal.Now.instant(),
          })
        )
      ).toBe(true);
      const nextSettlementAt = Temporal.Now.instant()
        .add({ minutes: 5 })
        .round("millisecond");
      expect(
        await run((repository) =>
          repository.recordStepFailure({
            ...claim,
            step: "contract_cancellation",
            failureCode: "reservation_dotypos_failed",
            retryAt: nextSettlementAt,
          })
        )
      ).toBe(true);
      await run((repository) =>
        repository.deferSettlement({ ...claim, nextSettlementAt })
      );
      expect(
        await run((repository) =>
          repository.recordStepFailure({
            ...claim,
            step: "receipt",
            failureCode: "receipt_send_failed",
            retryAt: nextSettlementAt,
          })
        )
      ).toBe(false);
      // The released claim no longer fences anything.
      expect(
        await run((repository) =>
          repository.markStepDone({
            ...claim,
            step: "contract_cancellation",
            doneAt: Temporal.Now.instant(),
          })
        )
      ).toBe(false);

      const notYet = await run((repository) =>
        repository.claimDue({
          now: Temporal.Now.instant(),
          staleClaimBefore: Temporal.Now.instant().subtract({ minutes: 10 }),
          limit: 100,
        })
      );
      expect(notYet.map(({ id }) => id)).not.toContain(recorded.id);

      const later = nextSettlementAt.add({ seconds: 1 });
      const due = await run((repository) =>
        repository.claimDue({
          now: later,
          staleClaimBefore: later.subtract({ minutes: 10 }),
          limit: 100,
        })
      );
      const retried = due.find(({ id }) => id === recorded.id);
      expect(retried).toMatchObject({
        contractCancelledAt: null,
        stepRetries: {
          receipt: { attempts: 0, failureCode: null },
          contract_cancellation: {
            attempts: 1,
            failureCode: "reservation_dotypos_failed",
          },
        },
      });
      expect(
        retried?.stepRetries.contract_cancellation.retryAt?.equals(
          nextSettlementAt
        )
      ).toBe(true);
      expect(retried?.receiptSentAt).not.toBeNull();

      if (!retried?.settlementClaimedAt) throw new Error("Not claimed again.");
      const retryClaim = {
        id: recorded.id,
        claimedAt: retried.settlementClaimedAt,
      };
      for (const step of [
        "operator_notice",
        "contract_cancellation",
      ] as const) {
        expect(
          await run((repository) =>
            repository.markStepDone({ ...retryClaim, step, doneAt: later })
          )
        ).toBe(true);
      }
      await run((repository) =>
        repository.markSettled({ ...retryClaim, settledAt: later })
      );
      const settled = await run((repository) =>
        repository.findByContract(withdrawal.contract)
      );
      expect(settled).toMatchObject({
        _tag: "Some",
        value: {
          settlementClaimedAt: null,
          stepRetries: {
            contract_cancellation: {
              attempts: 1,
              failureCode: null,
              retryAt: null,
            },
          },
        },
      });
    });

    test("lists an account's withdrawals for its data export, oldest first", async () => {
      const older = await newWithdrawal(
        Temporal.Now.instant().subtract({ hours: 1 }).round("millisecond")
      );
      const { withdrawal: recordedOlder } = await run((repository) =>
        repository.record(older)
      );
      const olderClaim = { id: recordedOlder.id, claimedAt: older.submittedAt };
      for (const step of withdrawalSettlementSteps) {
        await run((repository) =>
          repository.markStepDone({
            ...olderClaim,
            step,
            doneAt: Temporal.Now.instant(),
          })
        );
      }
      await run((repository) =>
        repository.markSettled({
          ...olderClaim,
          settledAt: Temporal.Now.instant(),
        })
      );
      const newer = {
        ...(await newWithdrawal()),
        accountId: older.accountId,
        refundAmount: paid,
        refundBasis: { kind: "full" as const },
      };
      await run((repository) => repository.record(newer));

      const records = await run((repository) =>
        repository.listRecordsForAccount({
          accountId: older.accountId,
          limit: 10,
        })
      );
      expect(
        records.map(({ submittedAt, ...record }) => ({
          ...record,
          submittedAt: submittedAt.toString(),
        }))
      ).toEqual([
        {
          contractKind: "reservation",
          contractId: older.contract.id,
          contractLabel: older.contractLabel,
          submittedAt: older.submittedAt.toString(),
          paidAmount: paid,
          refundAmount: older.refundAmount,
          status: "completed",
        },
        {
          contractKind: "reservation",
          contractId: newer.contract.id,
          contractLabel: newer.contractLabel,
          submittedAt: newer.submittedAt.toString(),
          paidAmount: paid,
          refundAmount: paid,
          status: "processing",
        },
      ]);

      const overLimit = await Effect.runPromise(
        Effect.gen(function* () {
          const repository = yield* WithdrawalRepository;
          return yield* repository.listRecordsForAccount({
            accountId: older.accountId,
            limit: 1,
          });
        }).pipe(
          Effect.provide(WithdrawalRepository.Default),
          Effect.provide(testDatabase.layer),
          Effect.flip
        )
      );
      expect(overLimit).toMatchObject({ _tag: "ReadLimitExceededError" });
    });
  }
);
