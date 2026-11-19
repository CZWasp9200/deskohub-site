import { CustomerAccountId } from "@deskohub/workspace-customer-api";
import type { FakeWorkspace } from "./fake-workspace";
import {
  sampleDeskReservation,
  sampleOfficePeopleReservation,
  samplePaymentFailedReservation,
  sampleWholeDayDesk,
} from "./sample-fixtures";

/**
 * Which reservations the sample-data mode lists, for evidence of the
 * Reservations tab's states (`EXPO_PUBLIC_ACCOUNT_SAMPLE_HISTORY`):
 * - `today`: the fixtures, the first booking running today with its PIN.
 * - `upcoming`: the next booking is a desk 16 days ahead, confirmed.
 * - `pending`: the next booking waits for payment.
 * - `nothing-upcoming`: only past bookings.
 * - `empty`: no bookings at all.
 * - `offline`: the list never loads (the service can't be reached); what the
 *   device saved earlier shows, or the retry state when nothing is saved.
 * - `offline-fresh`: as `offline`, for another sample account, which has
 *   nothing saved on the device.
 * - `loading`: the list, every booking's status and its PIN never answer,
 *   so their skeletons stay; for the account with nothing saved.
 * - `whole-day`: the next booking is a reserved desk for the whole of today,
 *   with a nine-digit PIN.
 * - `payment-failed`: the fixtures, and a meeting room whose payment failed,
 *   listed as the history answers it: not booked, at its booked time.
 * - `office-people`: an upcoming office with a contact and an invitee.
 * - `cancelled-invitation`: a future-dated cancelled invitation with no PIN.
 */
export const sampleHistories = [
  "today",
  "upcoming",
  "pending",
  "nothing-upcoming",
  "empty",
  "offline",
  "offline-fresh",
  "loading",
  "whole-day",
  "payment-failed",
  "office-people",
  "cancelled-invitation",
] as const;
export type SampleHistory = (typeof sampleHistories)[number];

export const sampleHistoryOf = (value: string | undefined): SampleHistory =>
  sampleHistories.find((history) => history === value) ?? "today";

/** `workspace` listing the `history` variant. */
export const withSampleHistory = (
  workspace: FakeWorkspace,
  history: SampleHistory,
  now: Date = new Date()
): FakeWorkspace => {
  const { data } = workspace;
  const [today, ...later] = data.history.current;
  const wholeDay = sampleWholeDayDesk(now);
  const todayOrder =
    today?.orderId === undefined ? undefined : data.orders.get(today.orderId);
  const current = {
    today: () =>
      today === undefined
        ? []
        : [{ ...today, todayAccess: todayOrder?.access }, ...later],
    upcoming: () => [sampleDeskReservation(now), ...later],
    pending: () => [sampleDeskReservation(now, "pending"), ...later],
    "nothing-upcoming": () => [],
    empty: () => [],
    offline: () => data.history.current,
    "offline-fresh": () => data.history.current,
    loading: () => data.history.current,
    "whole-day": () => [wholeDay.reservation, ...data.history.current],
    "payment-failed": () => data.history.current,
    "office-people": () => [sampleOfficePeopleReservation(now)],
    "cancelled-invitation": () => [],
  }[history]();
  workspace.data = {
    ...data,
    // An account of its own, which never loads a list, so has none saved.
    ...(history === "offline-fresh" || history === "loading"
      ? {
          accountId: CustomerAccountId.make(
            `sample-account-unsaved-${history}`
          ),
        }
      : {}),
    ...(history === "whole-day"
      ? {
          orders: new Map([
            ...data.orders,
            [wholeDay.reservation.orderId ?? "", wholeDay.order],
          ]),
        }
      : {}),
    history:
      history === "empty"
        ? { current: [], past: [], unavailable: [] }
        : {
            ...data.history,
            current,
            ...(history === "payment-failed" && {
              past: [samplePaymentFailedReservation(now), ...data.history.past],
            }),
          },
  };
  if (history === "cancelled-invitation") {
    const invitation = data.invited?.current[0];
    const order = invitation && data.orders.get(invitation.orderId);
    if (invitation && order) {
      workspace.data = {
        ...workspace.data,
        invited: {
          current: [],
          past: [{ ...invitation, status: "cancelled" }],
        },
        orders: new Map(data.orders).set(invitation.orderId, {
          state: { ...order.state, status: "cancelled" },
        }),
      };
    }
  }
  if (history === "offline" || history === "offline-fresh") {
    workspace.fail("listReservations", "service-unavailable", 10_000);
  }
  if (history === "loading") {
    workspace.fail("listReservations", "hang", 10_000);
    workspace.fail("getReservationStatus", "hang", 10_000);
    workspace.fail("getReservationAccess", "hang", 10_000);
  }
  return workspace;
};
