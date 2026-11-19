import type {
  CustomerReservationOrderId,
  CustomerWithdrawalNameRequired,
  CustomerWithdrawalQuote,
  CustomerWithdrawalReceipt,
  CustomerWithdrawalRefundChanged,
  CustomerWithdrawalRefused,
  CustomerWithdrawalRefusedReason,
  WithdrawFromCustomerReservation,
} from "@deskohub/workspace-customer-api";
import { Cause, Data, Effect, Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import {
  customerRead,
  customerWrite,
  refreshAfterWrite,
} from "../../customer-api/customer-request";
import {
  type CustomerRequestFailure,
  CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import type { AppLocale } from "../../i18n/app-locale";
import { reservationHistoryAtom } from "./reservations-list-state";

/**
 * GET /reservations/:orderId/withdrawal in the app's language. Keyed by
 * "<orderId> <locale>", so each order and language reads once.
 */
export const withdrawalQuoteAtom = Atom.family((key: string) => {
  const [orderId, locale] = key.split(" ") as [
    CustomerReservationOrderId,
    AppLocale,
  ];
  return customerDataRuntime.atom(
    Effect.service(CustomerApi).pipe(
      Effect.flatMap((api) =>
        api.reservations.getWithdrawalQuote({
          params: { orderId },
          query: { locale },
        })
      ),
      customerRead({ accountRead: false })
    )
  );
});

export const withdrawalQuoteKey = (
  orderId: CustomerReservationOrderId,
  locale: AppLocale
) => `${orderId} ${locale}`;

/**
 * POST /reservations/:orderId/withdrawal, the "Confirm withdrawal", one per
 * order. Once the server may hold the withdrawal, the list reads again, so
 * the screen the receipt closes to no longer offers it.
 */
export const withdrawAtom = Atom.family((orderId: CustomerReservationOrderId) =>
  customerDataRuntime.fn(
    (payload: typeof WithdrawFromCustomerReservation.Type, get) =>
      Effect.service(CustomerApi).pipe(
        Effect.flatMap((api) =>
          api.reservations.withdrawFromReservation({
            params: { orderId },
            payload,
          })
        ),
        customerWrite,
        refreshAfterWrite(get, [reservationHistoryAtom])
      )
  )
);

/** Every failure the withdrawal's quote or submission can end in. */
export type WithdrawalFailure =
  | CustomerRequestFailure
  | CustomerWithdrawalRefused
  | CustomerWithdrawalNameRequired
  | CustomerWithdrawalRefundChanged;

/**
 * The statement's name line: the profile's name to confirm, or an input
 * when the Workspace doesn't know it, with whether to show its error.
 */
export type WithdrawalNameField =
  | { readonly kind: "known"; readonly name: string }
  | { readonly kind: "input"; readonly missing: boolean };

export type WithdrawalStatementQuote = {
  readonly quote: CustomerWithdrawalQuote;
  readonly refundChanged: boolean;
};

/** What the withdrawal screen shows. */
export type WithdrawalScreenState = Data.TaggedEnum<{
  /** The quote is on its way. */
  Loading: Record<never, never>;
  /** The quote didn't load; the screen offers to read it again. */
  QuoteFailed: { readonly error: CustomerViewError };
  /** The customer can't withdraw from the order online, for `reason`. */
  Refused: { readonly reason: CustomerWithdrawalRefusedReason };
  /** The statement to confirm. */
  Statement: WithdrawalStatementQuote & {
    readonly name: WithdrawalNameField;
    /** The confirmation is on its way. */
    readonly pending: boolean;
    /** Why the last confirmation failed, when it did and can be retried. */
    readonly failure: Option.Option<CustomerViewError>;
  };
  /** The withdrawal is recorded: its receipt replaces the statement. */
  Received: {
    readonly quote: CustomerWithdrawalQuote;
    readonly receipt: CustomerWithdrawalReceipt;
  };
}>;
export const WithdrawalScreenState = Data.taggedEnum<WithdrawalScreenState>();

type Failed =
  | {
      readonly kind: "refused";
      readonly reason: CustomerWithdrawalRefusedReason;
    }
  | { readonly kind: "name_required" }
  | {
      readonly kind: "refund_changed";
      readonly quote: CustomerWithdrawalRefundChanged["quote"];
    }
  | { readonly kind: "failed"; readonly error: CustomerViewError };

const failureOf = (cause: Cause.Cause<WithdrawalFailure>): Failed =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => ({ kind: "failed", error: CustomerViewError.Unexpected() }),
    onSome: (error): Failed => {
      switch (error._tag) {
        case "CustomerWithdrawalRefused":
          return { kind: "refused", reason: error.reason };
        case "CustomerWithdrawalNameRequired":
          return { kind: "name_required" };
        case "CustomerWithdrawalRefundChanged":
          return { kind: "refund_changed", quote: error.quote };
        default:
          return { kind: "failed", error: toCustomerViewError(error) };
      }
    },
  });

/**
 * The screen's state from the quote, the submission, and the name typed
 * into the fallback input. `nameAttempted` is whether the customer has
 * tried to confirm, so an empty input shows its error only after that.
 *
 * An order the account can't reach (not its own, or a function the
 * release withholds) reads as refused: it can't be withdrawn from online.
 */
export const withdrawalScreenState = ({
  quote,
  statementQuote,
  submission,
  typedName,
  nameAttempted,
}: {
  readonly quote: AsyncResult.AsyncResult<
    CustomerWithdrawalQuote,
    WithdrawalFailure
  >;
  readonly statementQuote: WithdrawalStatementQuote | undefined;
  readonly submission: AsyncResult.AsyncResult<
    CustomerWithdrawalReceipt,
    WithdrawalFailure
  >;
  readonly typedName: string;
  readonly nameAttempted: boolean;
}): WithdrawalScreenState => {
  const originalQuote =
    statementQuote ??
    (AsyncResult.isSuccess(quote)
      ? { quote: quote.value, refundChanged: false }
      : undefined);
  if (!originalQuote && AsyncResult.isFailure(quote)) {
    const failed = failureOf(quote.cause);
    if (failed.kind === "refused")
      return WithdrawalScreenState.Refused({ reason: failed.reason });
    if (failed.kind === "failed") {
      if (
        failed.error._tag === "NotFound" ||
        failed.error._tag === "FeatureUnavailable"
      )
        return WithdrawalScreenState.Refused({ reason: "not_withdrawable" });
      return WithdrawalScreenState.QuoteFailed({ error: failed.error });
    }
    return WithdrawalScreenState.QuoteFailed({
      error: CustomerViewError.Unexpected(),
    });
  }
  if (!originalQuote) return WithdrawalScreenState.Loading();
  const failure = AsyncResult.isFailure(submission)
    ? failureOf(submission.cause)
    : undefined;
  const current =
    failure?.kind === "refund_changed"
      ? {
          quote: { ...originalQuote.quote, ...failure.quote },
          refundChanged: true,
        }
      : originalQuote;
  if (AsyncResult.isSuccess(submission))
    return WithdrawalScreenState.Received({
      quote: current.quote,
      receipt: submission.value,
    });

  const failed = submission.waiting ? undefined : failure;
  if (failed?.kind === "refused")
    return WithdrawalScreenState.Refused({ reason: failed.reason });
  const name: WithdrawalNameField =
    current.quote.customerName !== null && failed?.kind !== "name_required"
      ? { kind: "known", name: current.quote.customerName }
      : // A name the server asked for follows a confirmation, so the empty
        // input shows its error at once.
        { kind: "input", missing: nameAttempted && typedName.trim() === "" };
  return WithdrawalScreenState.Statement({
    ...current,
    name,
    pending: submission.waiting,
    failure:
      failed?.kind === "failed" ? Option.some(failed.error) : Option.none(),
  });
};

/**
 * What "Confirm withdrawal" sends: the typed name when the statement asks
 * for one, or nothing while that input is empty (the input shows why).
 */
export const withdrawalSubmission = (
  name: WithdrawalNameField,
  typedName: string,
  locale: AppLocale,
  refundTermsKey: CustomerWithdrawalQuote["refundTermsKey"]
): Option.Option<typeof WithdrawFromCustomerReservation.Type> => {
  if (name.kind === "known") return Option.some({ locale, refundTermsKey });
  const customerName = typedName.trim();
  return customerName === ""
    ? Option.none()
    : Option.some({ locale, refundTermsKey, customerName });
};
