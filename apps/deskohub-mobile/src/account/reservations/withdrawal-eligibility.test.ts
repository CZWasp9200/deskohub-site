import { describe, expect, test } from "bun:test";
import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { Cause, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import type {
  ReservationGroups,
  ReservationListRow,
} from "./reservation-list-model";
import {
  rowOffersWithdrawal,
  ticketWithdrawalSource,
} from "./withdrawal-eligibility";

const orderId = (id: string) => id as CustomerReservationOrderId;
const periodEndsAt = "2026-11-22T09:00:00Z";
const row = (
  id: string,
  change: Partial<ReservationListRow> = {}
): ReservationListRow => ({
  id,
  orderId: orderId(id),
  product: { kind: "meeting-room" },
  startsAt: "2026-11-20T09:00:00Z",
  endsAt: "2026-11-20T17:00:00Z",
  seats: 2,
  status: "confirmed",
  ...change,
});
const groups = (change: Partial<ReservationGroups> = {}) => ({
  groups: {
    featured: Option.none(),
    moreCurrent: [],
    past: [],
    undated: [],
    empty: false,
    ...change,
  } satisfies ReservationGroups,
});

describe("rowOffersWithdrawal", () => {
  test("offers the link only for an eligible entry point", () => {
    expect(
      rowOffersWithdrawal({ withdrawal: { eligible: true, periodEndsAt } })
    ).toBe(true);
    expect(
      rowOffersWithdrawal({ withdrawal: { eligible: false, periodEndsAt } })
    ).toBe(false);
  });

  test("offers nothing without an entry point, as while the release withholds it", () => {
    expect(rowOffersWithdrawal({})).toBe(false);
  });
});

describe("ticketWithdrawalSource", () => {
  test("follows the list's own row when the list has the order", () => {
    const history = AsyncResult.success(
      groups({
        featured: Option.some(
          row("a", { withdrawal: { eligible: true, periodEndsAt } })
        ),
        past: [row("b", { withdrawal: { eligible: false, periodEndsAt } })],
        undated: [row("c")],
      })
    );

    expect(ticketWithdrawalSource(history, orderId("a"))).toEqual({
      kind: "list",
      offered: true,
    });
    expect(ticketWithdrawalSource(history, orderId("b"))).toEqual({
      kind: "list",
      offered: false,
    });
    expect(ticketWithdrawalSource(history, orderId("c"))).toEqual({
      kind: "list",
      offered: false,
    });
  });

  test("keeps a refreshing list's rows", () => {
    const history = AsyncResult.success(
      groups({
        moreCurrent: [
          row("a", { withdrawal: { eligible: true, periodEndsAt } }),
        ],
      }),
      { waiting: true }
    );

    expect(ticketWithdrawalSource(history, orderId("a"))).toEqual({
      kind: "list",
      offered: true,
    });
  });

  test("asks the quote only when the list has no entry for the order", () => {
    const history = AsyncResult.success(groups({ past: [row("other")] }));

    expect(ticketWithdrawalSource(history, orderId("a"))).toEqual({
      kind: "quote",
    });
  });

  test("asks the quote when the list failed to load", () => {
    const history = AsyncResult.failure(Cause.fail("unavailable"));

    expect(ticketWithdrawalSource(history, orderId("a"))).toEqual({
      kind: "quote",
    });
  });

  test("waits for a list that is still loading", () => {
    expect(
      ticketWithdrawalSource(AsyncResult.initial(true), orderId("a"))
    ).toEqual({ kind: "waiting" });
  });
});
