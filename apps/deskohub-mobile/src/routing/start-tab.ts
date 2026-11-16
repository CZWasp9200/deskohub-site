import { Duration, Effect, Option } from "effect";
import { Atom } from "effect/unstable/reactivity";
import {
  type ReservationsList,
  savedReservationsAtom,
} from "../account/reservations/reservations-list-state";
import { customerDataRuntime } from "../customer-api/customer-data-runtime";

/** The tabs the app can open on. */
export type StartTab = "reservations" | "book";

/** Where each start tab lives. */
export const startTabHref = {
  reservations: "/reservations",
  book: "/book",
} as const satisfies Record<StartTab, string>;

/**
 * The tab the app opens on (and system back returns to before leaving):
 * Reservations when a reservation is coming up or under way, otherwise
 * Book. A cancelled booking isn't coming up.
 */
export const startTabOf = (list: Option.Option<ReservationsList>): StartTab =>
  Option.exists(list, ({ groups }) =>
    [...Option.toArray(groups.featured), ...groups.moreCurrent].some(
      (reservation) => reservation.status !== "cancelled"
    )
  )
    ? "reservations"
    : "book";

/**
 * How long the launch waits for the device's saved reservations before it
 * opens Book anyway: a local read, so it nearly always settles well within.
 */
export const startTabReadBudget = Duration.millis(500);

/**
 * The start tab from a read of the device's saved reservations: Book when
 * nothing is saved, and Book when the read is still running after
 * `startTabReadBudget` (the read is then interrupted, so a late answer
 * changes nothing).
 */
export const decideStartTab = <E, R>(
  savedRead: Effect.Effect<Option.Option<ReservationsList>, E, R>
): Effect.Effect<StartTab, E, R> =>
  savedRead.pipe(
    Effect.map(startTabOf),
    Effect.timeoutOrElse({
      duration: startTabReadBudget,
      orElse: () => Effect.succeed<StartTab>("book"),
    })
  );

/**
 * The start tab from the reservations this device saved on the last list
 * read: a local read the Reservations tab makes anyway, so the first screen
 * never waits for the network (see `decideStartTab`). Decided once per
 * signed-in account: a list saved later in the session doesn't move the tab
 * back navigates to.
 */
export const startTabAtom = customerDataRuntime
  .atom((get) => decideStartTab(get.resultOnce(savedReservationsAtom)))
  .pipe(Atom.keepAlive);
