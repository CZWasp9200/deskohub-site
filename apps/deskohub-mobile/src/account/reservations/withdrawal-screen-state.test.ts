import { describe, expect, test } from "bun:test";
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
import { Cause, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import {
  type WithdrawalFailure,
  WithdrawalScreenState,
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
  receiptEmail: "alex@example.test",
  paidAmount: money(120_000),
  refundAmount: money(120_000),
  refundBasis: { kind: "full" },
  periodEndsAt: "2026-11-22T09:00:00Z",
  ...change,
});
const receipt: CustomerWithdrawalReceipt = {
  withdrawalId: "withdrawal-1",
  submittedAt: "2026-11-18T10:00:00Z",
  refundAmount: money(120_000),
  receiptEmail: "alex@example.test",
};
const failed = (error: WithdrawalFailure) =>
  AsyncResult.failure<never, WithdrawalFailure>(Cause.fail(error));
const idle = AsyncResult.initial<
  CustomerWithdrawalReceipt,
  WithdrawalFailure
>();

const stateOf = ({
  quoteResult = AsyncResult.success(quote()),
  submission = idle,
  typedName = "",
  nameAttempted = false,
}: {
  readonly quoteResult?: AsyncResult.AsyncResult<
    CustomerWithdrawalQuote,
    WithdrawalFailure
  >;
  readonly submission?: AsyncResult.AsyncResult<
    CustomerWithdrawalReceipt,
    WithdrawalFailure
  >;
  readonly typedName?: string;
  readonly nameAttempted?: boolean;
} = {}) =>
  withdrawalScreenState({
    quote: quoteResult,
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
  test("sends only the locale when the profile's name is confirmed", () => {
    expect(
      withdrawalSubmission(
        { kind: "known", name: "Alex Example" },
        "ignored",
        "cs-CZ"
      )
    ).toEqual(Option.some({ locale: "cs-CZ" }));
  });

  test("sends the trimmed typed name when the statement asks for one", () => {
    expect(
      withdrawalSubmission(
        { kind: "input", missing: false },
        "  Alex Example ",
        "en-US"
      )
    ).toEqual(Option.some({ locale: "en-US", customerName: "Alex Example" }));
  });

  test("sends nothing while the asked-for name is blank", () => {
    expect(
      Option.isNone(
        withdrawalSubmission({ kind: "input", missing: true }, "   ", "en-US")
      )
    ).toBe(true);
  });
});
