import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
  DotyposTableIdSchema,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import {
  type AccountingDocumentSnapshot,
  makeAccountingDocumentSnapshot,
} from "@/features/accounting/accounting-document-snapshot";
import { AccountingDocumentSnapshots } from "@/features/accounting/backend/accounting-document-snapshots";
import { AccountingRecordUnavailable } from "@/features/accounting/backend/sealed-accounting-json";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import type { ReservationRecord } from "@/features/reservation/backend/reservation-record";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import { normalizedOfficeReservationOrderSchema } from "@/features/reservation/office-reservation";
import {
  type StoredWorkspaceReservationDetails,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  instantStringSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";
import { getRestorationBooking } from "./restoration-booking";

const reservationId = workspaceReservationIdSchema.make("restored-reservation");
const paymentAttemptId = paymentAttemptIdSchema.make("restored-payment");
const customerId = DotyposCustomerIdSchema.make("restored-customer");
const tableId = DotyposTableIdSchema.make("restored-table");
const recordId = DotyposReservationIdSchema.make("restored-record");
const syntheticEmail = testEmailAddress("restoration-booking");
const billing = {
  purpose: "personal",
  invoice: "requested",
  address: {
    line1: "Synthetic 1",
    city: "Praha",
    postalCode: "100 00",
    country: "CZ",
  },
} as const;

const snapshotOf = (prepared: PreparedCustomerQuote) =>
  makeAccountingDocumentSnapshot({
    workspaceReservationId: reservationId,
    dotyposReservationId: recordId,
    dotyposCustomerId: customerId,
    locale: "en-US",
    prepared,
  });

const coworkOrder = { entryTier: "open-space", coffee: true } as const;
const coworkDate = "2099-01-01";
const coworkSnapshot = snapshotOf({
  kind: "cowork",
  reservation: {
    kind: "cowork",
    ...coworkOrder,
    date: coworkDate,
    name: "Ada Lovelace",
    email: syntheticEmail,
    phone: "+420 700 000 000",
    billing,
  },
  quote: buildCoworkReservationQuote(coworkOrder),
} as PreparedCustomerQuote);
const coworkInterval = getCoworkReservationInterval("open-space", coworkDate);

const meetingRoomOrder = (earlySetup: boolean) =>
  normalizedMeetingRoomReservationOrderSchema.make({
    kind: "meeting-room",
    duration: { unit: "hour", amount: 4 },
    reservationDate: plainDateStringSchema.make("2099-02-03"),
    startsAt: instantStringSchema.make("2099-02-03T08:00:00Z"),
    endsAt: instantStringSchema.make("2099-02-03T12:00:00Z"),
    ...(earlySetup && { earlySetup: true }),
    name: "Grace Hopper",
    email: syntheticEmail,
    phone: "+420 700 000 000",
    billing,
  });
const meetingRoomSnapshot = (earlySetup: boolean) => {
  const reservation = meetingRoomOrder(earlySetup);
  const quote = Effect.runSync(getMeetingRoomReservationQuote(reservation));
  return snapshotOf({
    kind: "meeting-room",
    reservation,
    quote: {
      ...quote,
      fingerprint: getReservationQuoteFingerprint(reservation, quote),
    },
  });
};

const officeOrder = normalizedOfficeReservationOrderSchema.make({
  kind: "office",
  startsOn: plainDateStringSchema.make("2099-06-20"),
  endsOn: plainDateStringSchema.make("2099-06-21"),
  seats: 3,
  name: "Katherine Johnson",
  email: syntheticEmail,
  phone: "+420 700 000 000",
  billing,
});
const officeSnapshot = snapshotOf({
  kind: "office",
  reservation: officeOrder,
  quote: Effect.runSync(buildOfficeReservationQuote(officeOrder)),
});

type Kind = {
  readonly label: string;
  readonly details: StoredWorkspaceReservationDetails;
  readonly snapshot: AccountingDocumentSnapshot;
  /** The record reservation creation wrote for it. */
  readonly record: ReservationRecord;
};

const kinds: readonly Kind[] = [
  {
    label: "cowork",
    details: { kind: "cowork", ...coworkOrder },
    snapshot: coworkSnapshot,
    record: {
      id: recordId,
      status: "CANCELLED",
      _tableId: tableId,
      startDate: coworkInterval.startsAt,
      endDate: coworkInterval.endsAt,
      seats: "1",
    },
  },
  {
    label: "meeting room",
    details: { kind: "meeting-room", duration: { unit: "hour", amount: 4 } },
    snapshot: meetingRoomSnapshot(false),
    record: {
      id: recordId,
      status: "CANCELLED",
      _tableId: tableId,
      startDate: "2099-02-03T08:00:00Z",
      endDate: "2099-02-03T12:00:00Z",
      seats: "1",
    },
  },
  {
    label: "meeting room with early setup",
    details: {
      kind: "meeting-room",
      duration: { unit: "hour", amount: 4 },
      earlySetup: true,
    },
    snapshot: meetingRoomSnapshot(true),
    record: {
      id: recordId,
      status: "CANCELLED",
      _tableId: tableId,
      // Dotypos holds the room from the setup start, 15 minutes early.
      startDate: "2099-02-03T07:45:00Z",
      endDate: "2099-02-03T12:00:00Z",
      seats: "1",
    },
  },
  {
    label: "office",
    details: { kind: "office", seats: 3, dayCount: 2 },
    snapshot: officeSnapshot,
    record: {
      id: recordId,
      status: "CANCELLED",
      _tableId: tableId,
      // Prague midnights, summer time.
      startDate: "2099-06-19T22:00:00+00:00",
      endDate: "2099-06-21T22:00:00Z",
      seats: "3",
    },
  },
];

const run = (input: {
  readonly details: StoredWorkspaceReservationDetails;
  readonly record: ReservationRecord;
  readonly findSnapshot?: AccountingDocumentSnapshots["Service"]["find"];
  readonly activePaymentAttemptId?: typeof paymentAttemptId | null;
}) =>
  Effect.runPromise(
    getRestorationBooking({
      reservation: {
        id: reservationId,
        activePaymentAttemptId:
          input.activePaymentAttemptId === undefined
            ? paymentAttemptId
            : input.activePaymentAttemptId,
        dotyposCustomerId: customerId,
        reservationDetails: input.details,
      },
      record: input.record,
    }).pipe(
      Effect.match({
        onFailure: (error) => ({ error, booking: null }),
        onSuccess: (booking) => ({ error: null, booking }),
      }),
      Effect.provide(
        Layer.mock(AccountingDocumentSnapshots, {
          find: input.findSnapshot ?? (() => Effect.succeed(null)),
        })
      )
    )
  );

const bookingOf = (record: ReservationRecord, seats: number) => ({
  customerId,
  tableId,
  startDate: new Date(Date.parse(record.startDate)),
  endDate: new Date(Date.parse(record.endDate)),
  seats,
});

describe("getRestorationBooking", () => {
  for (const kind of kinds) {
    describe(kind.label, () => {
      const withSnapshot = (record: ReservationRecord) =>
        run({
          details: kind.details,
          record,
          findSnapshot: mock(() => Effect.succeed(kind.snapshot)),
        });

      test("books the creation-time span and seats on the record's table for the Workspace customer", async () => {
        const findSnapshot = mock(() => Effect.succeed(kind.snapshot));
        const result = await run({
          details: kind.details,
          record: kind.record,
          findSnapshot,
        });

        expect(result).toEqual({
          error: null,
          booking: bookingOf(kind.record, Number(kind.record.seats)),
        });
        expect(findSnapshot).toHaveBeenCalledWith(paymentAttemptId);
      });

      test("books a record whose unchanged instants are written in another UTC offset", async () => {
        const inOtherOffset = (instant: string) =>
          Temporal.Instant.from(instant).toString({ timeZone: "+05:30" });
        const record = {
          ...kind.record,
          startDate: inOtherOffset(kind.record.startDate),
          endDate: inOtherOffset(kind.record.endDate),
        };

        const result = await withSnapshot(record);

        expect(result).toEqual({
          error: null,
          booking: bookingOf(kind.record, Number(kind.record.seats)),
        });
      });

      for (const [field, change] of [
        [
          "start",
          {
            startDate: Temporal.Instant.from(kind.record.startDate)
              .subtract({ hours: 1 })
              .toString(),
          },
        ],
        [
          "end",
          {
            endDate: Temporal.Instant.from(kind.record.endDate)
              .add({ hours: 1 })
              .toString(),
          },
        ],
        ["seats", { seats: String(Number(kind.record.seats) + 1) }],
      ] as const) {
        test(`refuses a record whose ${field} changed since creation`, async () => {
          const result = await withSnapshot({ ...kind.record, ...change });

          expect(result.error?._tag).toBe("RestorationBookingChanged");
        });
      }

      test("refuses a record without a table as unreadable", async () => {
        const { _tableId: _, ...unassigned } = kind.record;

        const result = await withSnapshot(unassigned);

        expect(result.error?._tag).toBe("RestorationBookingUnreadable");
      });

      test("takes the span and seats from the record when the payment has no snapshot", async () => {
        const result = await run({
          details: kind.details,
          record: kind.record,
        });

        expect(result).toEqual({
          error: null,
          booking: bookingOf(kind.record, Number(kind.record.seats)),
        });
      });
    });
  }

  test("refuses unreadable record bounds", async () => {
    const [cowork] = kinds;
    if (!cowork) throw new Error("cowork kind missing");

    const result = await run({
      details: cowork.details,
      record: { ...cowork.record, endDate: "not-a-date" },
    });

    expect(result.error?._tag).toBe("RestorationBookingUnreadable");
  });

  test("refuses as unreadable when the snapshot can't be loaded", async () => {
    const [cowork] = kinds;
    if (!cowork) throw new Error("cowork kind missing");

    const result = await run({
      details: cowork.details,
      record: cowork.record,
      findSnapshot: () =>
        Effect.fail(
          new AccountingRecordUnavailable({
            operation: "decrypt",
            reference: {
              type: "paymentAttemptId",
              id: paymentAttemptId,
            },
            message: "synthetic decryption failure",
          })
        ),
    });

    expect(result.error?._tag).toBe("RestorationBookingUnreadable");
  });

  test("refuses a snapshot of another reservation kind as unreadable", async () => {
    const [cowork] = kinds;
    if (!cowork) throw new Error("cowork kind missing");

    const result = await run({
      details: cowork.details,
      record: cowork.record,
      findSnapshot: () => Effect.succeed(officeSnapshot),
    });

    expect(result.error?._tag).toBe("RestorationBookingUnreadable");
  });

  test("uses the no-snapshot policy for a reservation without a paid attempt", async () => {
    const findSnapshot = mock(() => Effect.succeed(coworkSnapshot));
    const [cowork] = kinds;
    if (!cowork) throw new Error("cowork kind missing");

    const result = await run({
      details: cowork.details,
      record: cowork.record,
      findSnapshot,
      activePaymentAttemptId: null,
    });

    expect(result.booking).toEqual(bookingOf(cowork.record, 1));
    expect(findSnapshot).not.toHaveBeenCalled();
  });

  describe("without a snapshot, checks what the stored details determine", () => {
    for (const [label, details, record] of [
      [
        "cowork hours that aren't its tier's",
        { kind: "cowork", ...coworkOrder },
        {
          id: recordId,
          status: "CANCELLED",
          _tableId: tableId,
          startDate: Temporal.Instant.from(coworkInterval.startsAt)
            .add({ hours: 1 })
            .toString(),
          endDate: coworkInterval.endsAt,
          seats: "1",
        },
      ],
      [
        "a cowork booking of more than one seat",
        { kind: "cowork", ...coworkOrder },
        {
          id: recordId,
          status: "CANCELLED",
          _tableId: tableId,
          startDate: coworkInterval.startsAt,
          endDate: coworkInterval.endsAt,
          seats: "2",
        },
      ],
      [
        "a meeting room span that isn't its duration",
        { kind: "meeting-room", duration: { unit: "hour", amount: 4 } },
        {
          id: recordId,
          status: "CANCELLED",
          _tableId: tableId,
          startDate: "2099-02-03T08:00:00Z",
          endDate: "2099-02-03T11:00:00Z",
          seats: "1",
        },
      ],
      [
        "an office booking of other seats",
        { kind: "office", seats: 3, dayCount: 2 },
        { ...kinds[3]?.record, seats: "2" },
      ],
      [
        "an office span of another day count",
        { kind: "office", seats: 3, dayCount: 2 },
        {
          ...kinds[3]?.record,
          endDate: "2099-06-22T22:00:00Z",
        },
      ],
      [
        "an office span that isn't whole days",
        { kind: "office", seats: 3 },
        {
          ...kinds[3]?.record,
          endDate: "2099-06-21T16:00:00Z",
        },
      ],
    ] as const) {
      test(`refuses ${label}`, async () => {
        const result = await run({
          details: details as StoredWorkspaceReservationDetails,
          record: record as ReservationRecord,
        });

        expect(result.error?._tag).toBe("RestorationBookingChanged");
      });
    }

    test("takes an office's seats and days from the record when its details predate them", async () => {
      const office = kinds[3];
      if (!office) throw new Error("office kind missing");

      const result = await run({
        details: { kind: "office" },
        record: office.record,
      });

      expect(result.booking).toEqual(bookingOf(office.record, 3));
    });
  });
});
