import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { useAtomValue } from "@effect/atom-react";
import { Effect, Option } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import type { ReactNode } from "react";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { reservationHistoryAtom } from "./reservations-list-state";

/**
 * Whether the order can be withdrawn from, as the list already read it:
 * `undefined` when the list hasn't (or no longer has) this order.
 */
const useListedWithdrawal = (
  orderId: CustomerReservationOrderId
): boolean | undefined => {
  const history = useAtomValue(reservationHistoryAtom);
  if (!AsyncResult.isSuccess(history)) return undefined;
  const { featured, moreCurrent, past, undated } = history.value.groups;
  const row = [
    ...Option.toArray(featured),
    ...moreCurrent,
    ...past,
    ...undated,
  ].find((row) => row.orderId === orderId);
  return row === undefined ? undefined : row.withdrawal?.eligible === true;
};

/** GET /reservations/:orderId/withdrawal: offered when a quote is available. */
const quotedWithdrawalAtom = Atom.family((orderId: CustomerReservationOrderId) =>
  customerDataRuntime.atom(
    Effect.service(CustomerApi).pipe(
      Effect.flatMap((api) =>
        api.reservations.getWithdrawalQuote({ params: { orderId }, query: {} })
      ),
      Effect.as(true),
      Effect.orElseSucceed(() => false)
    )
  )
);

function QuotedWithdrawal({
  orderId,
  children,
}: {
  readonly orderId: CustomerReservationOrderId;
  readonly children: ReactNode;
}) {
  const quoted = useAtomValue(quotedWithdrawalAtom(orderId));
  return AsyncResult.isSuccess(quoted) && quoted.value ? children : null;
}

/**
 * Shows `children` while the customer can withdraw from the order: from the
 * list's own row when it has one, else from the withdrawal quote.
 */
export function WhenWithdrawable({
  orderId,
  children,
}: {
  readonly orderId: CustomerReservationOrderId;
  readonly children: ReactNode;
}) {
  const listed = useListedWithdrawal(orderId);
  if (listed === undefined)
    return <QuotedWithdrawal orderId={orderId}>{children}</QuotedWithdrawal>;
  return listed ? children : null;
}
