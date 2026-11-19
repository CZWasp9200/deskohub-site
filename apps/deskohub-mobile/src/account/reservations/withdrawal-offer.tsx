import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import type { ReactNode } from "react";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import { reservationHistoryAtom } from "./reservations-list-state";
import { ticketWithdrawalSource } from "./withdrawal-eligibility";

/** GET /reservations/:orderId/withdrawal: offered when a quote is available. */
const quotedWithdrawalAtom = Atom.family(
  (orderId: CustomerReservationOrderId) =>
    customerDataRuntime.atom(
      Effect.service(CustomerApi).pipe(
        Effect.flatMap((api) =>
          api.reservations.getWithdrawalQuote({
            params: { orderId },
            query: {},
          })
        ),
        customerRead({ accountRead: false }),
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
 * list's own row when it has one, else from the withdrawal quote. The
 * Workspace's release gate decides both, so nothing shows while it withholds
 * the function.
 */
export function WhenWithdrawable({
  orderId,
  children,
}: {
  readonly orderId: CustomerReservationOrderId;
  readonly children: ReactNode;
}) {
  const source = ticketWithdrawalSource(
    useAtomValue(reservationHistoryAtom),
    orderId
  );
  switch (source.kind) {
    case "waiting":
      return null;
    case "quote":
      return <QuotedWithdrawal orderId={orderId}>{children}</QuotedWithdrawal>;
    case "list":
      return source.offered ? children : null;
  }
}
