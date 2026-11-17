import type { CustomerBookingSelection } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import type { ImperativeRouter } from "expo-router";
import {
  bookFamilyHref,
  orderStatusHref,
  paymentStatusHref,
  reservationsHref,
} from "../booking-routes";
import type { CheckoutFlowView } from "../checkout/checkout-flow";
import type { ReviewState } from "../checkout/checkout-state";

/**
 * Where a finished checkout leaves to, and how:
 * - `Status`: the order's status screen, right above the Reservations
 *   list, with the book stack gone.
 * - `FamilyScreen`: back to the family screen the checkout was opened from,
 *   which sits below it in the book stack and re-reads its `restart` reason
 *   on refocus. Without it in the stack (such as after a web reload), the
 *   family screen replaces the checkout instead.
 */
export type CheckoutDestination =
  | {
      readonly _tag: "Status";
      readonly href:
        | ReturnType<typeof paymentStatusHref>
        | ReturnType<typeof orderStatusHref>;
    }
  | {
      readonly _tag: "FamilyScreen";
      readonly href: ReturnType<typeof bookFamilyHref>;
    };

/**
 * The screen a checkout state leaves to, if it's finished here. A payment
 * retry (`retriedOrderId`) that has to start over goes back to its order's
 * ticket, which offers the retry again, never to a new booking.
 */
export const checkoutDestination = (
  view: CheckoutFlowView,
  family: CustomerBookingSelection["family"],
  retriedOrderId?: string
): CheckoutDestination | undefined => {
  if (view._tag === "Starting") return undefined;
  switch (view.state._tag) {
    case "Done":
      return { _tag: "Status", href: paymentStatusHref(view.state.orderId) };
    case "Restart":
      return retriedOrderId === undefined
        ? {
            _tag: "FamilyScreen",
            href: bookFamilyHref(family, view.state.reason),
          }
        : { _tag: "Status", href: orderStatusHref(retriedOrderId) };
    default:
      return undefined;
  }
};

/**
 * The review a hold ran out on, kept on screen under the hold-ended dialog
 * (board 33): the customer checks the date again or leaves, instead of
 * being moved without a word. Only a hold that ran out while its review
 * was shown waits; any other restart leaves at once.
 */
export const holdEndedReview = (
  view: CheckoutFlowView,
  lastReview: Option.Option<ReviewState>
): Option.Option<ReviewState> =>
  view._tag === "Running" &&
  view.state._tag === "Restart" &&
  view.state.reason === "hold_expired"
    ? lastReview
    : Option.none();

/** A destination's href, which identifies it across renders. */
export type CheckoutDestinationHref = CheckoutDestination["href"];

/**
 * - `Navigate`: leave now.
 * - `Drop`: the checkout finished while the customer was elsewhere; stay.
 * - `Stay`: nothing new to act on.
 */
export type NavigationDecision =
  | { readonly _tag: "Navigate"; readonly destination: CheckoutDestination }
  | { readonly _tag: "Drop"; readonly destination: CheckoutDestination }
  | { readonly _tag: "Stay" };

/**
 * Whether the checkout screen is in view: as last rendered, and right now
 * (the navigation's `isFocused`), which also catches a blur between the
 * render and the effect that acts on it.
 */
export interface CheckoutScreenFocus {
  readonly rendered: boolean;
  readonly now: () => boolean;
}

/**
 * The checkout screen owns leaving the checkout (R8): it acts on each
 * destination once, and only while it's focused. A destination reached
 * while the customer is on another screen is dropped, not replayed on
 * return, so a late payment result can't pull them away.
 */
export const navigationDecision = (
  destination: CheckoutDestination | undefined,
  focus: CheckoutScreenFocus,
  handled: CheckoutDestinationHref | undefined
): NavigationDecision => {
  if (destination === undefined || destination.href === handled) {
    return { _tag: "Stay" };
  }
  return focus.rendered && focus.now()
    ? { _tag: "Navigate", destination }
    : { _tag: "Drop", destination };
};

/** Leaves the checkout for `destination` (see `CheckoutDestination`). */
export const leaveCheckout = (
  router: Pick<ImperativeRouter, "navigate" | "dismissTo">,
  destination: CheckoutDestination
) => {
  switch (destination._tag) {
    case "Status":
      // First back to the list: out of the book stack, checkout included,
      // to the tabs below it, and down the reservations stack past any
      // status already open. Queued navigations apply in order, so the
      // status then opens over the list. A navigate, not a push: when the
      // first step only just created the tabs, a push would add a second
      // tabs route. When it only just created the reservations stack, the
      // anchor puts the list below the status, as the deep link does. Back
      // from the status is the list.
      router.dismissTo(reservationsHref);
      return router.navigate(destination.href, { withAnchor: true });
    case "FamilyScreen":
      // Replaces the checkout when the family screen isn't below it.
      return router.dismissTo(destination.href);
  }
};
