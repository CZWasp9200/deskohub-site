import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { reservationsAccess } from "../account-gating";
import { reservationHistoryAtom } from "./reservations-list-state";

/**
 * Reads the account's reservations once per launch, whichever tab the app
 * opens on, for an account the Reservations tab may show them to. The read
 * saves the list on the device, where the next launch picks its start tab
 * (`startTabAtom`), and the Reservations tab shows the same read.
 */
export function ReservationsRefreshRoot() {
  const account = useAtomValue(accountAtom);
  const available = Option.exists(
    AsyncResult.value(account),
    (current) => reservationsAccess(current).kind === "available"
  );
  return available && <ReservationHistoryRead />;
}

function ReservationHistoryRead() {
  useAtomMount(reservationHistoryAtom);
  return null;
}
