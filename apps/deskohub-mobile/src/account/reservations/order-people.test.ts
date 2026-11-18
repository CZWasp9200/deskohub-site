import { describe, expect, test } from "bun:test";
import type { CustomerReservationParty } from "@deskohub/workspace-customer-api";
import { DateTime, Option } from "effect";
import { inviteeResend, OrderContact, orderContactOf } from "./order-people";

const now = DateTime.makeUnsafe("2026-11-18T10:00:00Z");
describe("inviteeResend", () => {
  test.each([false, undefined])(
    "offers no Resend unless the server confirms eligibility (%s)",
    (resendable) => {
      expect(inviteeResend(resendable, {}, Option.none(), now)).toEqual(
        Option.none()
      );
    }
  );

  test("is open now when nothing holds it", () => {
    expect(inviteeResend(true, {}, Option.none(), now)).toEqual(
      Option.some({ opensAt: Option.none() })
    );
    expect(
      inviteeResend(
        true,
        { resendAvailableAt: "2026-11-18T09:30:00Z" },
        Option.none(),
        now
      )
    ).toEqual(Option.some({ opensAt: Option.none() }));
  });

  test("opens at the later of the server's time and this screen's own resend", () => {
    const server = "2026-11-18T10:05:00Z";
    const resent = "2026-11-18T10:15:00Z";
    const opensAt = (resentUntil: Option.Option<string>) =>
      Option.flatMap(
        inviteeResend(true, { resendAvailableAt: server }, resentUntil, now),
        (resend) => resend.opensAt
      ).pipe(Option.map(DateTime.formatIso));
    expect(opensAt(Option.none())).toEqual(
      Option.some("2026-11-18T10:05:00.000Z")
    );
    expect(opensAt(Option.some(resent))).toEqual(
      Option.some("2026-11-18T10:15:00.000Z")
    );
  });
});

describe("orderContactOf", () => {
  const row = (party?: CustomerReservationParty) =>
    Option.some(party === undefined ? {} : { party });

  test("is unknown without the order's row in a fresh history read", () => {
    expect(orderContactOf(Option.none())).toEqual(OrderContact.Unknown());
  });

  test("is the account itself unless the account booked for another customer", () => {
    expect(orderContactOf(row())).toEqual(OrderContact.You());
    expect(
      orderContactOf(row({ kind: "booked-by", authorName: "Sam Example" }))
    ).toEqual(OrderContact.You());
    expect(orderContactOf(row({ kind: "booked-by-deleted-account" }))).toEqual(
      OrderContact.You()
    );
  });

  test("names the customer the account booked for, never as You", () => {
    expect(
      orderContactOf(row({ kind: "booked-for", customerName: "Bob Example" }))
    ).toEqual(OrderContact.Customer({ name: Option.some("Bob Example") }));
    expect(
      orderContactOf(row({ kind: "booked-for", customerName: null }))
    ).toEqual(OrderContact.Customer({ name: Option.none() }));
  });
});
