import type { FakeWorkspace } from "./fake-workspace";
import { sampleDeskReservation } from "./sample-fixtures";

/**
 * Which reservations the sample-data mode lists, for evidence of the
 * Reservations tab's states (`EXPO_PUBLIC_ACCOUNT_SAMPLE_HISTORY`):
 * - `today`: the fixtures, the first booking running today with its PIN.
 * - `upcoming`: the next booking is a desk 16 days ahead, confirmed.
 * - `pending`: the next booking waits for payment.
 * - `nothing-upcoming`: only past bookings.
 * - `empty`: no bookings at all.
 * - `offline`: the list never loads, as without a connection; what the
 *   device saved earlier shows, or the retry state when nothing is saved.
 * - `loading`: the list and every booking's status never answer, so their
 *   skeletons stay.
 */
export const sampleHistories = [
  "today",
  "upcoming",
  "pending",
  "nothing-upcoming",
  "empty",
  "offline",
  "loading",
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
    loading: () => data.history.current,
  }[history]();
  workspace.data = {
    ...data,
    history:
      history === "empty"
        ? { current: [], past: [], unavailable: [] }
        : { ...data.history, current },
  };
  if (history === "offline") {
    workspace.fail("listReservations", "transport-failure", 10_000);
  }
  if (history === "loading") {
    workspace.fail("listReservations", "hang", 10_000);
    workspace.fail("getReservationStatus", "hang", 10_000);
  }
  return workspace;
};
