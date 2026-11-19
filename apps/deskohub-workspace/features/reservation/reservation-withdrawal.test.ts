import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import type { Money } from "@/shared/money/money";
import {
  assessReservationWithdrawal,
  getReservationServiceSchedule,
  type ReservationServiceSchedule,
  type ReservationWithdrawalFacts,
} from "./reservation-withdrawal";

const prague = (dateTime: string) =>
  Temporal.ZonedDateTime.from(`${dateTime}[Europe/Prague]`).toInstant();

const paid: Money = { value: 100_000, exponent: 2, currency: "CZK" };

const facts = (
  schedule: ReservationServiceSchedule,
  overrides: Partial<ReservationWithdrawalFacts> = {}
): ReservationWithdrawalFacts => ({
  reservationState: "confirmed",
  paymentState: "paid",
  purpose: "personal",
  contractAt: prague("2027-01-02T10:00"),
  paidAmount: paid,
  schedule,
  ...overrides,
});

const coworkDay: ReservationServiceSchedule = {
  kind: "cowork",
  date: Temporal.PlainDate.from("2027-01-10"),
};

const office: ReservationServiceSchedule = {
  kind: "office",
  startsOn: Temporal.PlainDate.from("2027-01-10"),
  dayCount: 3,
};

const meetingRoom = (
  duration: Extract<
    ReservationServiceSchedule,
    { kind: "meeting-room" }
  >["duration"]
): ReservationServiceSchedule => ({
  kind: "meeting-room",
  startsAt: prague("2027-01-10T09:00"),
  duration,
});

describe("assessReservationWithdrawal before the service starts", () => {
  test("refunds the whole amount paid for every family", () => {
    const now = prague("2027-01-09T23:59");
    for (const schedule of [
      coworkDay,
      office,
      meetingRoom({ unit: "hour", amount: 4 }),
      meetingRoom({ unit: "day", amount: 1 }),
    ]) {
      expect(assessReservationWithdrawal(facts(schedule), now)).toEqual({
        withdrawable: true,
        refundAmount: paid,
        refundBasis: { kind: "full" },
        periodEndsAt: prague("2027-01-17T00:00"),
      });
    }
  });

  test("allows a zero-total reservation with a zero refund", () => {
    const free: Money = { ...paid, value: 0 };
    expect(
      assessReservationWithdrawal(
        facts(office, { paidAmount: free }),
        prague("2027-01-09T12:00")
      )
    ).toMatchObject({
      withdrawable: true,
      refundAmount: free,
      refundBasis: { kind: "full" },
    });
  });
});

describe("assessReservationWithdrawal after the service starts", () => {
  test("counts a started cowork day as supplied, leaving nothing to withdraw", () => {
    expect(
      assessReservationWithdrawal(facts(coworkDay), prague("2027-01-10T00:00"))
    ).toEqual({ withdrawable: false, reason: "performance_started" });
  });

  test("refunds the office days not started, rounded up", () => {
    expect(
      assessReservationWithdrawal(facts(office), prague("2027-01-10T08:00"))
    ).toEqual({
      withdrawable: true,
      refundAmount: { ...paid, value: 66_667 },
      refundBasis: { kind: "partial", unit: "day", unstarted: 2, total: 3 },
      periodEndsAt: prague("2027-01-17T00:00"),
    });
  });

  test("leaves nothing once the last office day starts", () => {
    expect(
      assessReservationWithdrawal(facts(office), prague("2027-01-12T00:01"))
    ).toEqual({ withdrawable: false, reason: "performance_started" });
  });

  test("refunds the hourly meeting-room hours not started", () => {
    expect(
      assessReservationWithdrawal(
        facts(meetingRoom({ unit: "hour", amount: 4 })),
        prague("2027-01-10T10:30")
      )
    ).toMatchObject({
      withdrawable: true,
      refundAmount: { ...paid, value: 50_000 },
      refundBasis: { kind: "partial", unit: "hour", unstarted: 2, total: 4 },
    });
  });

  test("leaves nothing of a started one-hour or whole-day room", () => {
    const now = prague("2027-01-10T09:00");
    for (const schedule of [
      meetingRoom({ unit: "hour", amount: 1 }),
      meetingRoom({ unit: "day", amount: 1 }),
    ]) {
      expect(assessReservationWithdrawal(facts(schedule), now)).toEqual({
        withdrawable: false,
        reason: "performance_started",
      });
    }
  });
});

describe("assessReservationWithdrawal eligibility", () => {
  const beforeStart = prague("2027-01-09T12:00");

  test("excludes a business-purpose reservation", () => {
    expect(
      assessReservationWithdrawal(
        facts(office, { purpose: "business" }),
        beforeStart
      )
    ).toEqual({ withdrawable: false, reason: "business_purpose" });
  });

  test("treats a reservation without a recorded purpose as a consumer's", () => {
    expect(
      assessReservationWithdrawal(facts(office, { purpose: null }), beforeStart)
    ).toMatchObject({ withdrawable: true });
  });

  test("requires a paid, confirmed reservation", () => {
    for (const override of [
      { paymentState: "pending" },
      { reservationState: "cancelled" },
      { reservationState: "held" },
    ] as const) {
      expect(
        assessReservationWithdrawal(facts(office, override), beforeStart)
      ).toEqual({ withdrawable: false, reason: "not_withdrawable" });
    }
  });

  test("closes at the end of the fourteenth day after the contract day", () => {
    const later: ReservationServiceSchedule = {
      ...office,
      startsOn: Temporal.PlainDate.from("2027-02-10"),
    };
    expect(
      assessReservationWithdrawal(facts(later), prague("2027-01-16T23:59"))
    ).toMatchObject({ withdrawable: true });
    expect(
      assessReservationWithdrawal(facts(later), prague("2027-01-17T00:00"))
    ).toEqual({ withdrawable: false, reason: "period_ended" });
  });

  test("keeps a contract concluded before 2027 withdrawable inside its period", () => {
    expect(
      assessReservationWithdrawal(
        facts(office, { contractAt: prague("2026-12-28T18:00") }),
        prague("2027-01-01T09:00")
      )
    ).toMatchObject({
      withdrawable: true,
      periodEndsAt: prague("2027-01-12T00:00"),
    });
  });
});

describe("getReservationServiceSchedule", () => {
  test("reads a cowork day from its booked start", () => {
    expect(
      getReservationServiceSchedule(
        { kind: "cowork", tier: "open-space" } as never,
        prague("2027-01-10T12:00"),
        prague("2027-01-11T12:00")
      )
    ).toEqual({ kind: "cowork", date: Temporal.PlainDate.from("2027-01-10") });
  });

  test("keeps a meeting room's stored duration", () => {
    expect(
      getReservationServiceSchedule(
        { kind: "meeting-room", duration: { unit: "hour", amount: 4 } },
        prague("2027-01-10T09:00"),
        prague("2027-01-10T13:00")
      )
    ).toEqual({
      kind: "meeting-room",
      startsAt: prague("2027-01-10T09:00"),
      duration: { unit: "hour", amount: 4 },
    });
  });

  test("falls back to a meeting room's booked span", () => {
    expect(
      getReservationServiceSchedule(
        { kind: "meeting-room" },
        prague("2027-03-28T00:00"),
        prague("2027-03-29T00:00")
      )
    ).toMatchObject({ duration: { unit: "day", amount: 1 } });
    expect(
      getReservationServiceSchedule(
        { kind: "meeting-room" },
        prague("2027-01-10T09:00"),
        prague("2027-01-10T10:00")
      )
    ).toMatchObject({ duration: { unit: "hour", amount: 1 } });
  });

  test("counts an office's Prague dates when no day count was stored", () => {
    expect(
      getReservationServiceSchedule(
        { kind: "office" },
        prague("2027-01-10T00:00"),
        prague("2027-01-13T00:00")
      )
    ).toEqual({
      kind: "office",
      startsOn: Temporal.PlainDate.from("2027-01-10"),
      dayCount: 3,
    });
  });
});
