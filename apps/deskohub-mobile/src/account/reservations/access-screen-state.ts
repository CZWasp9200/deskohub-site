import type {
  CustomerReservationAccess,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { Cause, Data, Duration, Effect, Option, Stream } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import {
  type CustomerRequestFailure,
  type CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import { Clipboard } from "../../customer-api/device-capabilities";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { accessWindowStates } from "./access-clock";
import { type AccessWindowState, accessWindowOf } from "./access-window";

/**
 * An order's door PIN and the lock's window (GET access, Dotypos-backed).
 * The PIN lives only in this atom's memory: nothing writes it to storage,
 * and it goes with the atom when the screen unmounts.
 */
export const reservationAccessAtom = Atom.family(
  (orderId: CustomerReservationOrderId) =>
    customerDataRuntime.atom(
      Effect.flatMap(Effect.service(CustomerApi), (api) =>
        api.reservations.getReservationAccess({ params: { orderId } })
      ).pipe(customerRead({ accountRead: true }))
    )
);

/**
 * The lock's window as the access answer gives it, as an atom key: plain
 * objects compare structurally, so the same window finds the same atom.
 */
export const accessWindowKey = ({
  accessStartsAt,
  accessEndsAt,
}: Pick<CustomerReservationAccess, "accessStartsAt" | "accessEndsAt">) => ({
  accessStartsAt,
  accessEndsAt,
});

/**
 * Where a window stands, every second while the screen is mounted, until it
 * ends; none for a window whose times can't be read. Keyed by the window
 * on screen rather than the read, so a failed refresh that keeps the last
 * PIN on screen keeps its countdown running too.
 */
export const accessCountdownAtom = Atom.family(
  (window: ReturnType<typeof accessWindowKey>) =>
    customerDataRuntime.atom(
      Option.match(accessWindowOf(window), {
        onNone: () => Stream.make(Option.none<AccessWindowState>()),
        onSome: (parsed) => Stream.map(accessWindowStates(parsed), Option.some),
      })
    )
);

/**
 * Copies the PIN on screen, kept out of the system's clipboard preview.
 * One copy result per order.
 */
export const copyAccessCodeAtom = Atom.family(
  (_orderId: CustomerReservationOrderId) =>
    customerDataRuntime.fn((code: string) =>
      Effect.flatMap(Effect.service(Clipboard), (clipboard) =>
        clipboard.copy(code, { sensitive: true })
      )
    )
);

/** How long a copy action shows that it copied, in place of its icon. */
export const copyFeedbackDuration = Duration.seconds(2);

/**
 * Copies `text`, then reports `true` for `copyFeedbackDuration` and `false`
 * after it: the copy action shows its check while the value is `true`.
 */
const copyWithFeedback = (text: string, sensitive: boolean) =>
  Stream.fromEffect(
    Effect.flatMap(Effect.service(Clipboard), (clipboard) =>
      Effect.as(clipboard.copy(text, { sensitive }), true)
    )
  ).pipe(
    Stream.concat(
      Stream.fromEffect(Effect.as(Effect.sleep(copyFeedbackDuration), false))
    )
  );

/**
 * The access screen's Copy PIN action: copies the PIN, kept out of the
 * system's clipboard preview, and confirms it in place for two seconds.
 */
export const copyPinWithFeedbackAtom = Atom.family(
  (_orderId: CustomerReservationOrderId) =>
    customerDataRuntime.fn((code: string) => copyWithFeedback(code, true))
);

/** Copies the space's address, confirming it in place for two seconds. */
export const copyAddressAtom = customerDataRuntime.fn((address: string) =>
  copyWithFeedback(address, false)
);

/** Whether a copy action shows its check now. */
export const showsCopied = (
  result: AsyncResult.AsyncResult<boolean, unknown>
): boolean => AsyncResult.isSuccess(result) && result.value;

/** What the access screen shows for its read and the window's state. */
export type AccessScreenState = Data.TaggedEnum<{
  /** The first read is under way. */
  Loading: Record<never, never>;
  /** The order has no PIN to show (not confirmed, or withdrawn). */
  NoPin: Record<never, never>;
  /** Any other failure without a PIN on screen; the shared error states. */
  Failed: Record<never, never>;
  /** The PIN and its window; where the window stands is `accessCountdownAtom`'s. */
  Pin: { readonly access: CustomerReservationAccess };
}>;

export const AccessScreenState = Data.taggedEnum<AccessScreenState>();

/**
 * The screen's state from its access read, as `shownAccess` keeps it. A PIN
 * on screen stays there through a failed refresh, under the shared notice.
 */
export const accessScreenStateOf = (
  access: AsyncResult.AsyncResult<
    CustomerReservationAccess,
    CustomerRequestFailure
  >
): AccessScreenState => {
  if (AsyncResult.isInitial(access)) return AccessScreenState.Loading();
  return Option.match(AsyncResult.value(access), {
    onSome: (shown) => AccessScreenState.Pin({ access: shown }),
    onNone: () =>
      AsyncResult.isFailure(access) &&
      Option.exists(
        Cause.findErrorOption(access.cause),
        (failure) =>
          toCustomerViewError(failure)._tag === "AccessCodeUnavailable"
      )
        ? AccessScreenState.NoPin()
        : AccessScreenState.Failed(),
  });
};

/**
 * The header over the screen's state: navy over the PIN's navy band (and
 * while it loads), the paper canvas's over No PIN, which has no band.
 */
export const accessHeaderTone = (state: AccessScreenState): "navy" | "paper" =>
  AccessScreenState.$is("NoPin")(state) ? "paper" : "navy";

const withdrawsAccess = (error: CustomerViewError) =>
  error._tag === "NotFound" || error._tag === "AccessCodeUnavailable";

/**
 * The access read as the screen shows it. A failure normally keeps the last
 * PIN on screen under a notice, but a refresh that finds the order gone or
 * its PIN withdrawn drops it: the screen must not keep showing a PIN the
 * server no longer vouches for.
 */
export const shownAccess = <A, E extends CustomerRequestFailure>(
  result: AsyncResult.AsyncResult<A, E>
): AsyncResult.AsyncResult<A, E> =>
  AsyncResult.isFailure(result) &&
  Option.exists(Cause.findErrorOption(result.cause), (failure) =>
    withdrawsAccess(toCustomerViewError(failure))
  )
    ? AsyncResult.failure(result.cause, { waiting: result.waiting })
    : result;

/** The access screen's own copy for the failure only it can explain. */
export const accessErrorMessage = (
  error: CustomerViewError,
  locale: AppLocale
): string | undefined =>
  error._tag === "NotFound"
    ? m.reservations_access_not_found({}, { locale })
    : undefined;
