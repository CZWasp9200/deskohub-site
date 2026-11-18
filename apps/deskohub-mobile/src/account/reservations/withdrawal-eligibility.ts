import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import type {
  ReservationGroups,
  ReservationListRow,
} from "./reservation-list-model";

/**
 * Whether a list row offers the withdrawal link. The history carries the
 * entry point only while the Workspace releases the online withdrawal
 * function and the order is paid and confirmed, so an absent entry is no
 * offer.
 */
export const rowOffersWithdrawal = (
  row: Pick<ReservationListRow, "withdrawal">
) => row.withdrawal?.eligible === true;

/**
 * Where a ticket's withdrawal row comes from: the list's row for the order
 * when the list has it, the withdrawal quote only when the list read
 * finished without one, and nothing yet while the list is still loading.
 */
export type TicketWithdrawalSource =
  | { readonly kind: "list"; readonly offered: boolean }
  | { readonly kind: "quote" }
  | { readonly kind: "waiting" };

export const ticketWithdrawalSource = (
  history: AsyncResult.AsyncResult<
    { readonly groups: ReservationGroups },
    unknown
  >,
  orderId: CustomerReservationOrderId
): TicketWithdrawalSource => {
  if (AsyncResult.isInitial(history)) return { kind: "waiting" };
  if (!AsyncResult.isSuccess(history)) return { kind: "quote" };
  const { featured, moreCurrent, past, undated } = history.value.groups;
  const row = [
    ...Option.toArray(featured),
    ...moreCurrent,
    ...past,
    ...undated,
  ].find((row) => row.orderId === orderId);
  return row === undefined
    ? { kind: "quote" }
    : { kind: "list", offered: rowOffersWithdrawal(row) };
};
