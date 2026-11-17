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
}) => {
  const log: string[] = [];
  const rows = new Map<WithdrawalId, ContractWithdrawal>();
  const cancellationFailures = [...(options.cancellationFailures ?? [])];
  let receiptFailures = options.receiptFailures ?? 0;
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
          settlementAttempts: 0,
          settlementFailureCode: null,
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
    markStepDone: (claim) =>
      Effect.sync(() => {
        if (!find(claim)) return false;
        update(claim.id, { [stepColumn[claim.step]]: claim.doneAt });
        return true;
      }),
    markSettled: (claim) =>
      Effect.sync(() => {
        if (!find(claim)) return;
        update(claim.id, {
          settledAt: claim.settledAt,
          settlementClaimedAt: null,
          settlementFailureCode: null,
        });
      }),
    recordSettlementFailure: (claim) =>
      Effect.sync(() => {
        const row = find(claim);
        if (!row) return;
        update(claim.id, {
          settlementAttempts: row.settlementAttempts + 1,
          settlementFailureCode: claim.failureCode,
          settlementClaimedAt: null,
        });
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
        return Effect.void;
      }),
    sendOperatorNotice: () =>
      Effect.sync(() => {
        log.push("operator notice");
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
      section.pipe(
        Effect.provideService(HeldCustomerAccount, {
          accountId: id,
          email: receiptEmail,
        })
      ),
  });

  const contacts = Layer.mock(CustomerAccountContactService, {
    current: Effect.succeed({
      accountId,
      name: "Alex Example",
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

  return { log, rows, run, runExit };
};

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
      settlementAttempts: 1,
      settlementFailureCode: "reservation_invalid_state",
      settlementClaimedAt: null,
    });
    expect(row.receiptSentAt).not.toBeNull();
    expect(row.contractCancelledAt).toBeNull();
  });

  test("holds the cancellation until the receipt is sent, then finishes in order", async () => {
    const harness = makeHarness({ receiptFailures: 3 });
    const receipt = await harness.run((service) => service.withdraw(input));

    expect(receipt.receiptEmail).toBe(receiptEmail);
    expect(onlyRow(harness)).toMatchObject({
      settledAt: null,
      receiptSentAt: null,
      operatorNotifiedAt: null,
      contractCancelledAt: null,
      settlementFailureCode: "receipt_send_failed",
    });
    expect(harness.log.some((entry) => entry.startsWith("cancel"))).toBe(false);

    const summary = await harness.run((service) =>
      service.settleDue({ limit: 10 })
    );
    expect(summary).toEqual({ claimed: 1, settled: 1, failed: 0 });
    expect(harness.log.slice(-3)).toEqual([
      `receipt to ${receiptEmail}`,
      "operator notice",
      "cancel refund 66667",
    ]);
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
      settlementAttempts: 1,
    });

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
