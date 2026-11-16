import { useAtom } from "@effect/atom-react";
import { Option } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { CheckoutState } from "../checkout/checkout-state";
import type { DetailsDraft } from "./details-form";

/**
 * The details form the customer filled in, kept per account registry (so
 * sign-out drops it) and outside any one checkout screen: going back to the
 * selection, or a hold that ran out and restarted the booking, opens a new
 * checkout with the same details, so restarting is select, Continue,
 * Continue. None until the form is first changed.
 */
export const detailsDraftAtom = Atom.make(Option.none<DetailsDraft>()).pipe(
  Atom.keepAlive
);

/**
 * Whether the details are kept once the checkout reaches `state`: only a
 * submitted booking (its status screen) ends them; a restart keeps them.
 */
export const keepsDetailsDraft = (state: CheckoutState) =>
  state._tag !== "Done";

/**
 * The kept details, or `initial` before the form was changed, and a setter
 * that keeps every change.
 */
export const useDetailsDraft = (
  initial: () => DetailsDraft
): readonly [DetailsDraft, (draft: DetailsDraft) => void] => {
  const [stored, setStored] = useAtom(detailsDraftAtom);
  return [
    Option.getOrElse(stored, initial),
    (draft) => setStored(Option.some(draft)),
  ];
};
