import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  CustomerFeatureUnavailable,
  CustomerReservationNotFound,
  type CustomerReservationOrderId,
  CustomerServiceUnavailable,
  CustomerWithdrawalNameRequired,
  type CustomerWithdrawalQuote,
  type CustomerWithdrawalReceipt,
  CustomerWithdrawalRefused,
} from "@deskohub/workspace-customer-api";
import { Cause, Effect, Option, Result } from "effect";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import { sampleOrderIds } from "../../customer-api/testing/sample-fixtures";
import type { AppLocale } from "../../i18n/app-locale";
import {
  type ReservationsList,
  reservationHistoryAtom,
} from "./reservations-list-state";
import { rowOffersWithdrawal } from "./withdrawal-eligibility";
import {
  type WithdrawalFailure,
  WithdrawalScreenState,
  type WithdrawalStatementQuote,
  withdrawAtom,
  withdrawalScreenState,
  withdrawalSubmission,
} from "./withdrawal-screen-state";

const money = (value: number) =>
  ({ value, exponent: 2, currency: "CZK" }) as const;
const quote = (
  change: Partial<CustomerWithdrawalQuote> = {}
): CustomerWithdrawalQuote => ({
  contractId: "order-1" as CustomerReservationOrderId,
  contractLabel: "Meeting room, 20 Nov 2026",
  customerName: "Alex Example",
  receiptEmail: testEmailAddress("alex"),
  paidAmount: money(120_000),
  refundAmount: money(120_000),
  refundBasis: { kind: "full" },
  refundTermsKey: "full",
  periodEndsAt: "2026-11-22T09:00:00Z",
  ...change,
});
const receipt: CustomerWithdrawalReceipt = {
  withdrawalId: "withdrawal-1",
  submittedAt: "2026-11-18T10:00:00Z",
  refundAmount: money(120_000),
  receiptEmail: testEmailAddress("alex"),
};
const failed = (error: WithdrawalFailure) =>
  AsyncResult.failure<never, WithdrawalFailure>(Cause.fail(error));
const idle = AsyncResult.initial<
  CustomerWithdrawalReceipt,
  WithdrawalFailure
>();

const stateOf = ({
  quoteResult = AsyncResult.success(quote()),
  statementQuote,
  submission = idle,
  typedName = "",
  nameAttempted = false,
}: {
  readonly quoteResult?: AsyncResult.AsyncResult<
    CustomerWithdrawalQuote,
    WithdrawalFailure
  >;
  readonly statementQuote?: WithdrawalStatementQuote;
  readonly submission?: AsyncResult.AsyncResult<
    CustomerWithdrawalReceipt,
    WithdrawalFailure
  >;
  readonly typedName?: string;
  readonly nameAttempted?: boolean;
} = {}) =>
  withdrawalScreenState({
    quote: quoteResult,
    statementQuote,
    submission,
    typedName,
    nameAttempted,
  });

const statement = (state: WithdrawalScreenState) => {
  if (state._tag !== "Statement")
    throw new Error(`expected the statement, got ${state._tag}`);
  return state;
};

describe("withdrawalScreenState: the quote", () => {
  test("loads until the quote answers", () => {
    expect(stateOf({ quoteResult: AsyncResult.initial(true) })._tag).toBe(
      "Loading"
    );
  });

  test("shows the refusal the quote answers with", () => {
    expect(
      stateOf({
        quoteResult: failed(
          new CustomerWithdrawalRefused({ reason: "period_ended" })
        ),
      })
    ).toEqual(WithdrawalScreenState.Refused({ reason: "period_ended" }));
  });

  test("reads an unreachable order or a withheld release as not withdrawable", () => {
    for (const error of [
      new CustomerReservationNotFound(),
      new CustomerFeatureUnavailable({ feature: "withdrawal" }),
    ])
      expect(stateOf({ quoteResult: failed(error) })).toEqual(
        WithdrawalScreenState.Refused({ reason: "not_withdrawable" })
      );
  });

  test("offers to read a quote again after a failure retrying can fix", () => {
    expect(
      stateOf({ quoteResult: failed(new CustomerServiceUnavailable()) })
    ).toEqual(
      WithdrawalScreenState.QuoteFailed({
        error: CustomerViewError.Unavailable(),
      })
    );
  });
});

describe("withdrawalScreenState: the statement", () => {
  test("confirms the profile's name without an input", () => {
    const shown = statement(stateOf());

    expect(shown.name).toEqual({ kind: "known", name: "Alex Example" });
    expect(shown.pending).toBe(false);
    expect(Option.isNone(shown.failure)).toBe(true);
  });

  test("asks for the name when the profile has none, flagging it only after a confirmation", () => {
    const noName = AsyncResult.success(quote({ customerName: null }));

    expect(statement(stateOf({ quoteResult: noName })).name).toEqual({
      kind: "input",
      missing: false,
    });
    expect(
      statement(stateOf({ quoteResult: noName, nameAttempted: true })).name
    ).toEqual({ kind: "input", missing: true });
    expect(
      statement(
        stateOf({
          quoteResult: noName,
          nameAttempted: true,
          typedName: "  Alex Example ",
        })
      ).name
    ).toEqual({ kind: "input", missing: false });
  });

  test("turns the name line into a flagged input when the server requires a name", () => {
    const shown = statement(
      stateOf({
        submission: failed(new CustomerWithdrawalNameRequired()),
        nameAttempted: true,
      })
    );

    expect(shown.name).toEqual({ kind: "input", missing: true });
    expect(Option.isNone(shown.failure)).toBe(true);
  });

  test("holds the statement while the confirmation is on its way", () => {
    expect(
      statement(stateOf({ submission: AsyncResult.initial(true) })).pending
    ).toBe(true);
  });

  test("keeps the statement with the failure when the confirmation failed", () => {
    const shown = statement(
      stateOf({ submission: failed(new CustomerServiceUnavailable()) })
    );

    expect(shown.failure).toEqual(Option.some(CustomerViewError.Unavailable()));
  });

  test("shows a refusal the confirmation answers with instead of the statement", () => {
    expect(
      stateOf({
        submission: failed(
          new CustomerWithdrawalRefused({ reason: "already_withdrawn" })
        ),
      })
    ).toEqual(WithdrawalScreenState.Refused({ reason: "already_withdrawn" }));
  });
});

describe("withdrawalScreenState: the receipt", () => {
  test("replaces the statement with the receipt once the withdrawal is recorded", () => {
    expect(stateOf({ submission: AsyncResult.success(receipt) })).toEqual(
      WithdrawalScreenState.Received({ quote: quote(), receipt })
    );
  });
});

describe("withdrawalSubmission", () => {
  test("sends the confirmed refund terms when the profile's name is known", () => {
    expect(
      withdrawalSubmission(
        { kind: "known", name: "Alex Example" },
        "ignored",
        "cs-CZ",
        "full"
      )
    ).toEqual(Option.some({ locale: "cs-CZ", refundTermsKey: "full" }));
  });

  test("sends the trimmed typed name when the statement asks for one", () => {
    expect(
      withdrawalSubmission(
        { kind: "input", missing: false },
        "  Alex Example ",
        "en-US",
        "full"
      )
    ).toEqual(
      Option.some({
        locale: "en-US",
        refundTermsKey: "full",
        customerName: "Alex Example",
      })
    );
  });

  test("sends nothing while the asked-for name is blank", () => {
    expect(
      Option.isNone(
        withdrawalSubmission(
          { kind: "input", missing: true },
          "   ",
          "en-US",
          "full"
        )
      )
    ).toBe(true);
  });
});

describe("withdrawAtom over the Workspace", () => {
  const orderId = sampleOrderIds.fulfilled;

  /** Confirms the withdrawal and waits for its answer, like the screen. */
  const confirm = async (
    registry: AtomRegistry.AtomRegistry,
    payload: {
      readonly locale: AppLocale;
      readonly customerName?: string;
      readonly refundTermsKey?: string;
    }
  ) => {
    const atom = withdrawAtom(orderId);
    registry.mount(atom);
    registry.set(atom, { refundTermsKey: "full", ...payload });
    await Effect.runPromise(
      Effect.result(
        AtomRegistry.getResult(atom, { suspendOnWaiting: true })(registry)
      )
    );
    return registry.get(atom);
  };

  const listed = (history: ReservationsList) =>
    [
      ...Option.toArray(history.groups.featured),
      ...history.groups.moreCurrent,
      ...history.groups.past,
      ...history.groups.undated,
    ].find((row) => row.orderId === orderId);

  test("reads the list again once recorded, which no longer offers the withdrawal", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    workspace.withdrawal = quote({ contractId: orderId });
    const before = await settle(registry, reservationHistoryAtom);
    expect(Result.isSuccess(before)).toBe(true);

    const submission = await confirm(registry, { locale: "en-US" });

    expect(AsyncResult.isSuccess(submission)).toBe(true);
    const after = await settle(registry, reservationHistoryAtom);
    if (!Result.isSuccess(after)) throw new Error("the list didn't load");
    const row = listed(after.success);
    expect(row?.status).toBe("cancelled");
    expect(rowOffersWithdrawal(row ?? {})).toBe(false);
  });

  test("keeps the statement open for deliberate confirmation of the changed refund", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    const originalQuote = quote({ contractId: orderId, customerName: null });
    const freshQuote = {
      ...originalQuote,
      refundAmount: money(5_000),
      refundBasis: { kind: "partial", unit: "hour", unstarted: 1, total: 2 },
      refundTermsKey: "one-hour",
    } satisfies CustomerWithdrawalQuote;
    workspace.withdrawal = freshQuote;
    const originalHistory = await settle(registry, reservationHistoryAtom);
    if (!Result.isSuccess(originalHistory))
      throw new Error("The list didn't load.");
    const originalRow = listed(originalHistory.success);
    expect(originalRow).toBeDefined();
    const typedName = "  Alex Example ";
    const submission = await confirm(registry, {
      locale: "en-US",
      customerName: typedName,
      refundTermsKey: originalQuote.refundTermsKey,
    });

    expect(AsyncResult.isFailure(submission)).toBe(true);
    const current = statement(
      stateOf({
        quoteResult: AsyncResult.initial(true),
        statementQuote: { quote: originalQuote, refundChanged: false },
        submission,
        typedName,
        nameAttempted: true,
      })
    );
    expect(current).toMatchObject({
      quote: freshQuote,
      refundChanged: true,
      name: { kind: "input", missing: false },
      pending: false,
      failure: Option.none(),
    });
    const before = await settle(registry, reservationHistoryAtom);
    if (!Result.isSuccess(before)) throw new Error("The list didn't load.");
    expect(listed(before.success)).toEqual(originalRow);
    const payload = Option.getOrThrow(
      withdrawalSubmission(
        current.name,
        typedName,
        "en-US",
        current.quote.refundTermsKey
      )
    );
    expect(payload).toEqual({
      locale: "en-US",
      customerName: "Alex Example",
      refundTermsKey: "one-hour",
    });
    const confirmed = await confirm(registry, payload);
    expect(confirmed).toMatchObject({
      _tag: "Success",
      value: { refundAmount: freshQuote.refundAmount },
    });
    expect(
      stateOf({
        quoteResult: AsyncResult.failure(
          Cause.fail(
            new CustomerWithdrawalRefused({ reason: "already_withdrawn" })
          )
        ),
        statementQuote: { quote: current.quote, refundChanged: true },
        submission: confirmed,
      })
    ).toMatchObject({ _tag: "Received", quote: freshQuote });
  });

  test("answers a statement without a name as needing one, and records it once named", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    workspace.withdrawal = quote({ contractId: orderId, customerName: null });

    const unnamed = await confirm(registry, { locale: "en-US" });
    expect(
      withdrawalScreenState({
        quote: AsyncResult.success(quote({ customerName: null })),
        statementQuote: undefined,
        submission: unnamed,
        typedName: "",
        nameAttempted: true,
      })
    ).toMatchObject({
      _tag: "Statement",
      name: { kind: "input", missing: true },
    });

    const named = await confirm(registry, {
      locale: "en-US",
      customerName: "Alex Example",
    });
    expect(AsyncResult.isSuccess(named)).toBe(true);
  });
});
