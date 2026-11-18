import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import {
  CustomerAccountContactService,
  CustomerAccountSections,
  HeldCustomerAccount,
} from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Money } from "@/shared/money/money";
import {
  ContractCancellationError,
  type WithdrawableContract,
  type WithdrawableContractFamily,
} from "../withdrawable-contract";
import type { WithdrawalAssessment } from "../withdrawal-assessment";
import type { WithdrawalId } from "../withdrawal-identifiers";
import { WithdrawableContractFamilies } from "./withdrawable-contract-families";
import {
  type ContractWithdrawal,
  WithdrawalRepository,
  type WithdrawalSettlementStep,
} from "./withdrawal.repository";
import { WithdrawalService } from "./withdrawal.service";
import { WithdrawalEmails } from "./withdrawal-emails.service";
import { getWithdrawalSettlementStatus } from "./withdrawal-settlement-status";

const accountId = "account-1" as CustomerAccountId;
const receiptEmail = "customer@example.test";
const paid: Money = { value: 100_000, exponent: 2, currency: "CZK" };
const contract = { kind: "reservation", id: "reservation-1" } as const;
const input = { accountId, contract, locale: "cs-CZ" } as const;

const withdrawable: WithdrawalAssessment = {
  withdrawable: true,
  refundAmount: { ...paid, value: 66_667 },
  refundBasis: { kind: "partial", unit: "day", unstarted: 2, total: 3 },
  periodEndsAt: Temporal.Instant.from("2027-01-17T00:00:00Z"),
};

type Harness = ReturnType<typeof makeHarness>;

const makeHarness = (options: {
  readonly assessment?: WithdrawalAssessment;
  readonly contractFound?: boolean;
  /** Failures the family's cancellation answers, in order, before succeeding. */
  readonly cancellationFailures?: ContractCancellationError[];
  readonly receiptFailures?: number;
  readonly operatorNoticeFailures?: number;
  /** The profile's name; `null` when the profile has none. */
  readonly profileName?: string | null;
}) => {
  const log: string[] = [];
  /** The customer name each email carried, in sending order. */
  const emailNames: (string | null)[] = [];
  const rows = new Map<WithdrawalId, ContractWithdrawal>();
  const cancellationFailures = [...(options.cancellationFailures ?? [])];
  let receiptFailures = options.receiptFailures ?? 0;
  let operatorNoticeFailures = options.operatorNoticeFailures ?? 0;
  let accountReadable = true;
  let sequence = 0;

  const find = (claim: { id: WithdrawalId; claimedAt: Temporal.Instant }) => {
    const row = rows.get(claim.id);
    return row?.settlementClaimedAt?.equals(claim.claimedAt) ? row : undefined;
  };
  const update = (id: WithdrawalId, change: Partial<ContractWithdrawal>) => {
    const row = rows.get(id);
    if (row) rows.set(id, { ...row, ...change });
  };
  const stepColumn = {
    receipt: "receiptSentAt",
    operator_notice: "operatorNotifiedAt",
    contract_cancellation: "contractCancelledAt",
  } as const satisfies Record<
    WithdrawalSettlementStep,
    keyof ContractWithdrawal
  >;

  const repository = Layer.succeed(WithdrawalRepository, {
    findByContract: (ref) =>
      Effect.sync(() =>
        Option.fromNullishOr(
          [...rows.values()].find(
            (row) =>
              row.contract.kind === ref.kind && row.contract.id === ref.id
          )
        )
      ),
    listWithdrawnContractIds: () => Effect.succeed(new Set()),
    record: (withdrawal) =>
      Effect.sync(() => {
        log.push("record");
        const id = `withdrawal-${++sequence}` as WithdrawalId;
        const row: ContractWithdrawal = {
          ...withdrawal,
          id,
          receiptSentAt: null,
          operatorNotifiedAt: null,
          contractCancelledAt: null,
          settledAt: null,
          settlementClaimedAt: withdrawal.submittedAt,
          stepRetries: {
            receipt: noRetry,
            operator_notice: noRetry,
            contract_cancellation: noRetry,
          },
        };
        rows.set(id, row);
        return { withdrawal: row, recorded: true };
      }),
    claimDue: ({ now }) =>
      Effect.sync(() =>
        [...rows.values()]
          .filter((row) => !row.settledAt && !row.settlementClaimedAt)
          .map((row) => {
            const claimed = { ...row, settlementClaimedAt: now };
            rows.set(row.id, claimed);
            return claimed;
          })
      ),
    claimNow: ({ contract: ref, now }) =>
      Effect.sync(() => {
        const row = [...rows.values()].find(
          (candidate) =>
            candidate.contract.kind === ref.kind &&
            candidate.contract.id === ref.id
        );
        if (!row) return Option.none();
        if (row.settledAt || row.settlementClaimedAt) {
          return Option.some({ withdrawal: row, claimed: false });
        }
        const due = (retry: ContractWithdrawal["stepRetries"]["receipt"]) => ({
          ...retry,
          retryAt: null,
        });
        const claimed: ContractWithdrawal = {
          ...row,
          settlementClaimedAt: now,
          stepRetries: {
            receipt: due(row.stepRetries.receipt),
            operator_notice: due(row.stepRetries.operator_notice),
            contract_cancellation: due(row.stepRetries.contract_cancellation),
          },
        };
        rows.set(row.id, claimed);
        return Option.some({ withdrawal: claimed, claimed: true });
      }),
    markStepDone: (claim) =>
      Effect.sync(() => {
        const row = find(claim);
        if (!row) return false;
        update(claim.id, {
          [stepColumn[claim.step]]: claim.doneAt,
          stepRetries: {
            ...row.stepRetries,
            [claim.step]: {
              ...row.stepRetries[claim.step],
              failureCode: null,
              retryAt: null,
            },
          },
        });
        return true;
      }),
    recordStepFailure: (claim) =>
      Effect.sync(() => {
        const row = find(claim);
        if (!row) return false;
        update(claim.id, {
          stepRetries: {
            ...row.stepRetries,
            [claim.step]: {
              attempts: row.stepRetries[claim.step].attempts + 1,
              failureCode: claim.failureCode,
              retryAt: claim.retryAt,
            },
          },
        });
        return true;
      }),
    markSettled: (claim) =>
      Effect.sync(() => {
        if (!find(claim)) return;
        update(claim.id, {
          settledAt: claim.settledAt,
          settlementClaimedAt: null,
        });
      }),
    deferSettlement: (claim) =>
      Effect.sync(() => {
        if (!find(claim)) return;
        log.push("deferred");
        update(claim.id, { settlementClaimedAt: null });
      }),
  });

  const emails = Layer.succeed(WithdrawalEmails, {
    sendReceipt: (message) =>
      Effect.suspend(() => {
        if (receiptFailures > 0) {
          receiptFailures -= 1;
          log.push("receipt failed");
          return Effect.fail(new Error("Resend unavailable") as never);
        }
        log.push(`receipt to ${message.receiptEmail}`);
        emailNames.push(message.withdrawal.statementName);
        return Effect.void;
      }),
    sendOperatorNotice: (message) =>
      Effect.suspend(() => {
        if (operatorNoticeFailures > 0) {
          operatorNoticeFailures -= 1;
          log.push("operator notice failed");
          return Effect.fail(new Error("Resend unavailable") as never);
        }
        log.push("operator notice");
        emailNames.push(message.withdrawal.statementName);
        return Effect.void;
      }),
  });

  const family: WithdrawableContractFamily = {
    kind: "reservation",
    find: () =>
      Effect.succeed(
        options.contractFound === false
          ? Option.none()
          : Option.some<WithdrawableContract>({
              ref: contract,
              label: "Office · 10.–12. 1. 2027",
              paidAmount: paid,
              assess: () => options.assessment ?? withdrawable,
            })
      ),
    cancel: (cancellation) =>
      Effect.suspend(() => {
        const failure = cancellationFailures.shift();
        if (failure) {
          log.push(`cancel failed: ${failure.code}`);
          return Effect.fail(failure);
        }
        log.push(`cancel refund ${cancellation.refundAmount.value}`);
        return Effect.void;
      }),
  };

  const sections = Layer.mock(CustomerAccountSections, {
    withActiveAccount: (id, section) =>
      accountReadable
        ? section.pipe(
            Effect.provideService(HeldCustomerAccount, {
              accountId: id,
              email: receiptEmail,
            })
          )
        : (Effect.fail(new Error("Account section unavailable")) as never),
  });

  const contacts = Layer.mock(CustomerAccountContactService, {
    current: Effect.succeed({
      accountId,
      name:
        options.profileName === undefined
          ? "Alex Example"
          : options.profileName,
      email: receiptEmail,
      phone: "+420000000000",
    }),
  });

  const layer = WithdrawalService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        repository,
        emails,
        Layer.succeed(WithdrawableContractFamilies, { get: () => family }),
        sections,
        contacts
      )
    )
  );

  const run = <A, E>(
    operation: (service: WithdrawalService["Service"]) => Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* operation(yield* WithdrawalService);
      }).pipe(Effect.provide(layer))
    );

  const runExit = <A, E>(
    operation: (service: WithdrawalService["Service"]) => Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* operation(yield* WithdrawalService);
      }).pipe(Effect.provide(layer), Effect.exit)
    );

  /** Makes the steps' scheduled retries due now, as time passing would. */
  const makeRetriesDue = (steps: readonly WithdrawalSettlementStep[]) => {
    for (const row of rows.values()) {
      const stepRetries = { ...row.stepRetries };
      for (const step of steps) {
        const retry = stepRetries[step];
        if (retry.retryAt) {
          stepRetries[step] = {
            ...retry,
            retryAt: Temporal.Instant.from("2000-01-01T00:00:00Z"),
          };
        }
      }
      rows.set(row.id, { ...row, stepRetries });
    }
  };

  const setAccountReadable = (readable: boolean) => {
    accountReadable = readable;
  };

  return {
    log,
    emailNames,
    rows,
    run,
    runExit,
    makeRetriesDue,
    setAccountReadable,
  };
};

const noRetry = { attempts: 0, failureCode: null, retryAt: null } as const;

/** Minutes from now to an instant, rounded. */
const minutesUntil = (instant: Temporal.Instant | null) =>
  instant
    ? Math.round(
        Temporal.Now.instant().until(instant).total({ unit: "minutes" })
      )
    : null;

const onlyRow = (harness: Harness) => {
  const [row] = harness.rows.values();
  if (!row) throw new Error("No withdrawal was recorded.");
  return row;
};

const cancellationFailure = (
  transient: boolean,
  code = "reservation_dotypos_failed"
) =>
  new ContractCancellationError({
    kind: "reservation",
    code,
    transient,
    message: "Dotypos could not cancel the reservation.",
  });

describe("WithdrawalService.withdraw", () => {
  test("records, confirms by email, tells the operator, then cancels", async () => {
    const harness = makeHarness({});
    const receipt = await harness.run((service) => service.withdraw(input));

    expect(harness.log).toEqual([
      "record",
      `receipt to ${receiptEmail}`,
      "operator notice",
      "cancel refund 66667",
    ]);
    expect(receipt).toMatchObject({
      refundAmount: { ...paid, value: 66_667 },
      receiptEmail,
    });
    const row = onlyRow(harness);
    expect(receipt.withdrawalId).toBe(row.id);
    expect(receipt.submittedAt.equals(row.submittedAt)).toBe(true);
    expect(row.settledAt).not.toBeNull();
    expect(
      row.receiptSentAt && row.operatorNotifiedAt && row.contractCancelledAt
    ).toBeTruthy();
  });

  test("answers a repeated submission with the recorded receipt and does nothing again", async () => {
    const harness = makeHarness({});
    const first = await harness.run((service) => service.withdraw(input));
    const second = await harness.run((service) => service.withdraw(input));

    expect(second.withdrawalId).toBe(first.withdrawalId);
    expect(second.submittedAt.equals(first.submittedAt)).toBe(true);
    expect(harness.log.filter((entry) => entry === "record")).toHaveLength(1);
    expect(
      harness.log.filter((entry) => entry.startsWith("cancel"))
    ).toHaveLength(1);
  });

  test("refuses with the contract's reason and records nothing", async () => {
    const harness = makeHarness({
      assessment: { withdrawable: false, reason: "performance_started" },
    });
    const exit = await harness.runExit((service) => service.withdraw(input));

    expect(exit).toMatchObject({
      _tag: "Failure",
      cause: { reasons: [{ error: { reason: "performance_started" } }] },
    });
    expect(harness.rows.size).toBe(0);
  });

  test("answers a contract the account didn't conclude as not found", async () => {
    const harness = makeHarness({ contractFound: false });
    const exit = await harness.runExit((service) => service.withdraw(input));

    expect(exit).toMatchObject({
      _tag: "Failure",
      cause: { reasons: [{ error: { reason: "not_found" } }] },
    });
  });

  test("retries a transient cancellation failure at once", async () => {
    const harness = makeHarness({
      cancellationFailures: [cancellationFailure(true)],
    });
    await harness.run((service) => service.withdraw(input));

    expect(harness.log.slice(-2)).toEqual([
      "cancel failed: reservation_dotypos_failed",
      "cancel refund 66667",
    ]);
    expect(onlyRow(harness).settledAt).not.toBeNull();
  });

  test("keeps the receipt when cancellation fails, and leaves it for the retry", async () => {
    const harness = makeHarness({
      cancellationFailures: [
        cancellationFailure(false, "reservation_invalid_state"),
      ],
    });
    const receipt = await harness.run((service) => service.withdraw(input));

    expect(receipt.receiptEmail).toBe(receiptEmail);
    const row = onlyRow(harness);
    expect(row).toMatchObject({
      settledAt: null,
      settlementClaimedAt: null,
      stepRetries: {
        receipt: noRetry,
        operator_notice: noRetry,
        contract_cancellation: {
          attempts: 1,
          failureCode: "reservation_invalid_state",
        },
      },
    });
    expect(minutesUntil(row.stepRetries.contract_cancellation.retryAt)).toBe(5);
    expect(row.receiptSentAt).not.toBeNull();
    expect(row.contractCancelledAt).toBeNull();
    expect(getWithdrawalSettlementStatus(row)).toEqual({
      settlement: "needs_attention",
      failingSteps: [
        {
          step: "contract_cancellation",
          failureCode: "reservation_invalid_state",
        },
      ],
    });
  });

  test("cancels the booking while the receipt keeps failing, and retries the receipt on its own", async () => {
    const harness = makeHarness({ receiptFailures: 3, profileName: null });
    const receipt = await harness.run((service) =>
      service.withdraw({ ...input, customerName: "Sam Typed" })
    );

    expect(receipt.receiptEmail).toBe(receiptEmail);
    expect(harness.log).toEqual([
      "record",
      "receipt failed",
      "receipt failed",
      "receipt failed",
      "operator notice",
      "cancel refund 66667",
      "deferred",
    ]);
    const failed = onlyRow(harness);
    expect(failed).toMatchObject({
      settledAt: null,
      receiptSentAt: null,
      stepRetries: {
        receipt: { attempts: 1, failureCode: "receipt_send_failed" },
        operator_notice: noRetry,
        contract_cancellation: noRetry,
      },
    });
    expect(failed.operatorNotifiedAt).not.toBeNull();
    expect(failed.contractCancelledAt).not.toBeNull();
    expect(getWithdrawalSettlementStatus(failed)).toEqual({
      settlement: "needs_attention",
      failingSteps: [{ step: "receipt", failureCode: "receipt_send_failed" }],
    });

    const early = await harness.run((service) =>
      service.settleDue({ limit: 10 })
    );
    expect(early).toEqual({ claimed: 1, settled: 0, failed: 0 });
    expect(harness.log.at(-1)).toBe("deferred");

    harness.makeRetriesDue(["receipt"]);
    const due = await harness.run((service) =>
      service.settleDue({ limit: 10 })
    );
    expect(due).toEqual({ claimed: 1, settled: 1, failed: 0 });
    expect(harness.log.at(-1)).toBe(`receipt to ${receiptEmail}`);
    expect(
      harness.log.filter((entry) => entry.startsWith("cancel"))
    ).toHaveLength(1);
    expect(
      harness.log.filter((entry) => entry === "operator notice")
    ).toHaveLength(1);
    expect(harness.emailNames).toEqual(["Sam Typed", "Sam Typed"]);
    expect(getWithdrawalSettlementStatus(onlyRow(harness))).toEqual({
      settlement: "settled",
      failingSteps: [],
    });
  });

  test("keeps each failing email on its own attempts and backoff", async () => {
    const harness = makeHarness({
      receiptFailures: 3,
      operatorNoticeFailures: 6,
    });
    await harness.run((service) => service.withdraw(input));
    expect(onlyRow(harness).contractCancelledAt).not.toBeNull();
    expect(
      getWithdrawalSettlementStatus(onlyRow(harness)).failingSteps
    ).toEqual([
      { step: "receipt", failureCode: "receipt_send_failed" },
      { step: "operator_notice", failureCode: "operator_notice_failed" },
    ]);

    harness.makeRetriesDue(["receipt"]);
    await harness.run((service) => service.settleDue({ limit: 10 }));
    const receiptSent = onlyRow(harness);
    expect(receiptSent.receiptSentAt).not.toBeNull();
    expect(receiptSent.stepRetries.receipt.failureCode).toBeNull();
    expect(receiptSent.stepRetries.operator_notice.attempts).toBe(1);
    expect(
      harness.log.filter((entry) => entry === "operator notice failed")
    ).toHaveLength(3);

    harness.makeRetriesDue(["operator_notice"]);
    const second = await harness.run((service) =>
      service.settleDue({ limit: 10 })
    );
    expect(second).toEqual({ claimed: 1, settled: 0, failed: 1 });
    const backedOff = onlyRow(harness).stepRetries.operator_notice;
    expect(backedOff).toMatchObject({
      attempts: 2,
      failureCode: "operator_notice_failed",
    });
    expect(minutesUntil(backedOff.retryAt)).toBe(10);
    expect(onlyRow(harness).stepRetries.receipt.attempts).toBe(1);

    harness.makeRetriesDue(["operator_notice"]);
    const last = await harness.run((service) =>
      service.settleDue({ limit: 10 })
    );
    expect(last).toEqual({ claimed: 1, settled: 1, failed: 0 });
    expect(harness.emailNames).toEqual(["Alex Example", "Alex Example"]);
    expect(
      harness.log.filter((entry) => entry.startsWith("receipt to"))
    ).toHaveLength(1);
    expect(
      harness.log.filter((entry) => entry.startsWith("cancel"))
    ).toHaveLength(1);
  });

  test("cancels the booking when the receipt address can't be read on a retry", async () => {
    const harness = makeHarness({
      receiptFailures: 3,
      cancellationFailures: [
        cancellationFailure(false, "reservation_invalid_state"),
      ],
    });
    await harness.run((service) => service.withdraw(input));
    harness.setAccountReadable(false);
    harness.makeRetriesDue(["receipt", "contract_cancellation"]);

    await harness.run((service) => service.settleDue({ limit: 10 }));

    const row = onlyRow(harness);
    expect(row.contractCancelledAt).not.toBeNull();
    expect(row.stepRetries.receipt).toMatchObject({
      attempts: 2,
      failureCode: "customer_address_unavailable",
    });
    expect(row.settledAt).toBeNull();
  });
});

describe("WithdrawalService.withdraw statement name", () => {
  test("carries the profile name and ignores a typed one", async () => {
    const harness = makeHarness({});
    await harness.run((service) =>
      service.withdraw({ ...input, customerName: "Typed Name" })
    );

    expect(harness.emailNames).toEqual(["Alex Example", "Alex Example"]);
  });

  test("carries the trimmed typed name when the profile has none", async () => {
    const harness = makeHarness({ profileName: null });
    await harness.run((service) =>
      service.withdraw({ ...input, customerName: "  Sam Typed  " })
    );

    expect(harness.emailNames).toEqual(["Sam Typed", "Sam Typed"]);
    expect(harness.rows.size).toBe(1);
  });

  test.each([
    ["no typed name", undefined],
    ["a blank typed name", "   "],
  ])(
    "requires a name and records nothing with %s when the profile has none",
    async (_case, customerName) => {
      const harness = makeHarness({ profileName: null });
      const exit = await harness.runExit((service) =>
        service.withdraw({
          ...input,
          ...(customerName !== undefined && { customerName }),
        })
      );

      expect(exit).toMatchObject({
        _tag: "Failure",
        cause: {
          reasons: [{ error: { _tag: "WithdrawalNameRequiredError" } }],
        },
      });
      expect(harness.rows.size).toBe(0);
      expect(harness.log).toEqual([]);
    }
  );

  test("answers a recorded withdrawal's receipt without asking for a name", async () => {
    const harness = makeHarness({ profileName: null });
    const first = await harness.run((service) =>
      service.withdraw({ ...input, customerName: "Sam Typed" })
    );
    const second = await harness.run((service) => service.withdraw(input));

    expect(second.withdrawalId).toBe(first.withdrawalId);
  });
});

describe("WithdrawalService.settleDue", () => {
  test("finishes the cancellation a failed run left", async () => {
    const harness = makeHarness({
      cancellationFailures: [
        cancellationFailure(true),
        cancellationFailure(true),
        cancellationFailure(true),
      ],
    });
    await harness.run((service) => service.withdraw(input));
    expect(onlyRow(harness)).toMatchObject({
      settledAt: null,
      stepRetries: { contract_cancellation: { attempts: 1 } },
    });

    harness.makeRetriesDue(["contract_cancellation"]);
    const summary = await harness.run((service) =>
      service.settleDue({ limit: 10 })
    );

    expect(summary).toEqual({ claimed: 1, settled: 1, failed: 0 });
    expect(
      harness.log.filter((entry) => entry.startsWith("receipt"))
    ).toHaveLength(1);
    expect(harness.log.at(-1)).toBe("cancel refund 66667");
  });
});

describe("WithdrawalService.quote", () => {
  test("quotes the refund, the statement details and the receipt address", async () => {
    const harness = makeHarness({});
    const quote = await harness.run((service) => service.quote(input));

    expect(quote).toEqual({
      contractId: "reservation-1",
      contractLabel: "Office · 10.–12. 1. 2027",
      customerName: "Alex Example",
      receiptEmail,
      paidAmount: paid,
      refundAmount: { ...paid, value: 66_667 },
      refundBasis: { kind: "partial", unit: "day", unstarted: 2, total: 3 },
      periodEndsAt: withdrawable.withdrawable
        ? withdrawable.periodEndsAt
        : Temporal.Now.instant(),
    });
    expect(harness.rows.size).toBe(0);
  });

  test("refuses a quote once the customer withdrew", async () => {
    const harness = makeHarness({});
    await harness.run((service) => service.withdraw(input));
    const exit = await harness.runExit((service) => service.quote(input));

    expect(exit).toMatchObject({
      _tag: "Failure",
      cause: { reasons: [{ error: { reason: "already_withdrawn" } }] },
    });
  });
});

describe("WithdrawalService.settleNow", () => {
  test("retries a failing step before its scheduled retry and settles the withdrawal", async () => {
    const harness = makeHarness({
      cancellationFailures: [cancellationFailure(false)],
    });
    await harness.run((service) => service.withdraw(input));
    expect(onlyRow(harness).stepRetries.contract_cancellation).toMatchObject({
      attempts: 1,
      failureCode: "reservation_dotypos_failed",
    });
    expect(
      minutesUntil(onlyRow(harness).stepRetries.contract_cancellation.retryAt)
    ).toBe(5);

    const outcome = await harness.run((service) => service.settleNow(contract));

    expect(outcome).toEqual(
      Option.some({ outcome: "settled", withdrawal: onlyRow(harness) })
    );
    expect(harness.log.at(-1)).toBe("cancel refund 66667");
    expect(
      harness.log.filter((entry) => entry.startsWith("receipt to"))
    ).toHaveLength(1);
    expect(getWithdrawalSettlementStatus(onlyRow(harness))).toEqual({
      settlement: "settled",
      failingSteps: [],
    });
  });

  test("records another failure with its attempt when the step still fails", async () => {
    const harness = makeHarness({
      cancellationFailures: [
        cancellationFailure(false),
        cancellationFailure(false, "reservation_dotypos_unavailable"),
      ],
    });
    await harness.run((service) => service.withdraw(input));

    const outcome = await harness.run((service) => service.settleNow(contract));

    const row = onlyRow(harness);
    expect(outcome).toEqual(
      Option.some({ outcome: "failed", withdrawal: row })
    );
    expect(row.settledAt).toBeNull();
    expect(row.settlementClaimedAt).toBeNull();
    expect(row.stepRetries.contract_cancellation).toMatchObject({
      attempts: 2,
      failureCode: "reservation_dotypos_unavailable",
    });
  });

  test("settles only the contract's own withdrawal", async () => {
    const harness = makeHarness({
      cancellationFailures: [cancellationFailure(false)],
    });
    await harness.run((service) => service.withdraw(input));
    const own = onlyRow(harness);
    const otherId = "withdrawal-other" as WithdrawalId;
    const other: ContractWithdrawal = {
      ...own,
      id: otherId,
      contract: { kind: "reservation", id: "reservation-2" },
      settlementClaimedAt: null,
    };
    harness.rows.set(otherId, other);
    const cancellations = harness.log.filter((entry) =>
      entry.startsWith("cancel")
    ).length;

    await harness.run((service) => service.settleNow(contract));

    expect(harness.rows.get(own.id)?.settledAt).not.toBeNull();
    expect(harness.rows.get(otherId)).toEqual(other);
    expect(
      harness.log.filter((entry) => entry.startsWith("cancel"))
    ).toHaveLength(cancellations + 1);
  });

  test("does nothing again for a settled withdrawal", async () => {
    const harness = makeHarness({});
    await harness.run((service) => service.withdraw(input));
    const settled = onlyRow(harness);
    const steps = harness.log.length;

    const outcome = await harness.run((service) => service.settleNow(contract));

    expect(outcome).toEqual(
      Option.some({ outcome: "already_settled", withdrawal: settled })
    );
    expect(harness.log).toHaveLength(steps);
    expect(onlyRow(harness)).toEqual(settled);
  });

  test("leaves a withdrawal another run is settling", async () => {
    const harness = makeHarness({
      cancellationFailures: [cancellationFailure(false)],
    });
    await harness.run((service) => service.withdraw(input));
    const busy: ContractWithdrawal = {
      ...onlyRow(harness),
      settlementClaimedAt: Temporal.Now.instant(),
    };
    harness.rows.set(busy.id, busy);
    const steps = harness.log.length;

    const outcome = await harness.run((service) => service.settleNow(contract));

    expect(outcome).toEqual(
      Option.some({ outcome: "in_progress", withdrawal: busy })
    );
    expect(harness.log).toHaveLength(steps);
    expect(onlyRow(harness)).toEqual(busy);
  });

  test("answers none for a contract without a withdrawal", async () => {
    const harness = makeHarness({});

    const outcome = await harness.run((service) => service.settleNow(contract));

    expect(outcome).toEqual(Option.none());
    expect(harness.log).toEqual([]);
  });
});
