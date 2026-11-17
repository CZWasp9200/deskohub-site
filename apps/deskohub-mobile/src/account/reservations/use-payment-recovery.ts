import type {
  CustomerBookedSelection,
  CustomerOrderState,
} from "@deskohub/workspace-customer-api";
import { useAtom, useAtomSet } from "@effect/atom-react";
import { Cause, Exit, Option } from "effect";
import { useRouter } from "expo-router";
import { useState } from "react";
import { bookCheckoutHref } from "../../booking/booking-routes";
import { checkoutRequestAtom } from "../../booking/checkout/checkout-flow";
import { retryMessage } from "../../booking/checkout-screen/checkout-copy";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import type { PaymentRecovery } from "./booking-ticket-model";
import {
  PaymentPageOutcome,
  type PaymentRecoveryFailed,
  PaymentRetryOutcome,
  reopenPaymentPageAtom,
  retryPaymentAtom,
} from "./payment-recovery";

/**
 * The booking ticket's ways to still pay an unpaid order: open its payment
 * page again, or pay a failed, cancelled or expired order again in place. What the
 * server answers decides what the ticket offers next, and the order's status
 * is read again after each: a page it won't reopen isn't offered until a
 * fresh read says it can be (the provider's answer can change), and a retry
 * it refuses isn't offered again on this visit.
 */
export const usePaymentRecovery = (
  order: CustomerOrderState,
  /** What the order books, from the order or its reservation in the list. */
  booked: CustomerBookedSelection | undefined,
  {
    onCheckAgain,
    onPaymentPageLeft,
  }: {
    readonly onCheckAgain: () => void;
    readonly onPaymentPageLeft: () => void;
  }
) => {
  const locale = useAppLocale();
  const router = useRouter();
  const setCheckoutRequest = useAtomSet(checkoutRequestAtom);
  const [reopened, runReopen] = useAtom(reopenPaymentPageAtom, {
    mode: "promiseExit",
  });
  const [retried, runRetry] = useAtom(retryPaymentAtom, {
    mode: "promiseExit",
  });
  // The read the page was refused on; a fresh read decides again.
  const [pageClosedOn, setPageClosedOn] = useState<
    CustomerOrderState | undefined
  >(undefined);
  const [retryRefused, setRetryRefused] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  /** A failure with no answer to act on says what to try; nothing else changes. */
  const failed = (cause: Cause.Cause<PaymentRecoveryFailed>) =>
    Option.map(Cause.findErrorOption(cause), ({ kind }) =>
      setNotice(retryMessage(kind, locale))
    );

  const reopen = async () => {
    setNotice(undefined);
    const exit = await runReopen(order.orderId);
    Exit.match(exit, {
      onFailure: failed,
      onSuccess: (outcome) =>
        PaymentPageOutcome.$match(outcome, {
          Opened: onPaymentPageLeft,
          Closed: () => {
            setPageClosedOn(order);
            onCheckAgain();
          },
          NotFound: onCheckAgain,
        }),
    });
  };

  const retry = async () => {
    setNotice(undefined);
    if (booked === undefined) return;
    const exit = await runRetry({ orderId: order.orderId, locale });
    Exit.match(exit, {
      onFailure: failed,
      onSuccess: (outcome) =>
        PaymentRetryOutcome.$match(outcome, {
          Checkout: ({ checkout }) => {
            setCheckoutRequest(
              Option.some({
                _tag: "PaymentRetry",
                locale,
                selection: booked.selection,
                ...(booked.earlySetup === undefined
                  ? {}
                  : { earlySetup: booked.earlySetup }),
                checkout,
                previousTotal: order.total ?? checkout.summary.total,
              })
            );
            router.push(bookCheckoutHref);
          },
          // The earlier payment may still arrive: never book again now.
          CheckLater: () => {
            setNotice(m.reservations_payment_retry_settling({}, { locale }));
            onCheckAgain();
          },
          BookAgain: () => {
            setRetryRefused(true);
            onCheckAgain();
          },
          NotFound: onCheckAgain,
        }),
    });
  };

  const offer: PaymentRecovery = {
    pageReopenable:
      order.paymentPageReopenable === true && pageClosedOn !== order,
    // Without what the order books, its review can't be shown; booking again
    // is the way on.
    retryRefused: retryRefused || booked === undefined,
  };
  return {
    offer,
    notice,
    reopen: () => void reopen(),
    retry: () => void retry(),
    reopening: reopened.waiting,
    retrying: retried.waiting,
    busy: reopened.waiting || retried.waiting,
  };
};
