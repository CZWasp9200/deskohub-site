import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Schema } from "effect";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote.test-utils";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import { normalizedOfficeReservationOrderSchema } from "@/features/reservation/office-reservation";
import { moneyWithValue } from "@/shared/money/money";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentIdentitySchema,
  accountingDocumentSnapshotSchema,
  decodeStoredAccountingDocumentSnapshot,
  encodeStoredAccountingDocumentSnapshot,
  getAccountingDocumentSnapshotFirstServiceDate,
  makeAccountingDocumentSnapshot,
} from "./accounting-document-snapshot";

const adaEmail = testEmailAddress("ada");

const coworkOrder = {
  entryTier: "basic",
  coffee: true,
} satisfies CoworkReservationQuoteOrder;

const prepared = {
  kind: "cowork",
  reservation: {
    kind: "cowork",
    ...coworkOrder,
    date: "2099-01-01",
    name: "Ada Lovelace",
    email: adaEmail,
    phone: "+420 777 777 777",
  },
  quote: buildCoworkReservationQuote(coworkOrder),
} as PreparedCustomerQuote;

const makeSnapshot = () =>
  makeAccountingDocumentSnapshot({
    workspaceReservationId: "reservation-id",
    dotyposReservationId: "dotypos-reservation-id",
    dotyposCustomerId: "dotypos-customer-id",
    locale: "en-US",
    prepared,
  });

const officeReservation = normalizedOfficeReservationOrderSchema.make({
  kind: "office",
  startsOn: "2099-06-20",
  endsOn: "2099-06-21",
  seats: 3,
  name: "Ada Lovelace",
  email: adaEmail,
  phone: "+420 777 777 777",
});

const officePrepared: PreparedCustomerQuote = {
  kind: "office",
  reservation: officeReservation,
  quote: Effect.runSync(buildOfficeReservationQuote(officeReservation)),
};

describe("accounting document snapshot", () => {
  test("freezes supplier, buyer, reservation, and accepted quote facts", () => {
    expect(makeSnapshot()).toMatchObject({
      workspaceReservationId: "reservation-id",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      locale: "en-US",
      supplier: {
        legalName: "Desktechub s.r.o.",
        companyId: "24531596",
        vatStatus: "not-vat-payer",
      },
      buyer: {
        kind: "person",
        legalName: "Ada Lovelace",
      },
      delivery: {
        email: adaEmail,
      },
      reservation: {
        kind: "cowork",
        date: "2099-01-01",
      },
      quote: prepared.quote,
    });
  });

  test("freezes only the reservation email needed for invoice delivery", () => {
    const serialized = JSON.stringify(makeSnapshot());

    expect(serialized).toContain(adaEmail);
    expect(serialized).not.toContain("+420 777 777 777");
    expect(serialized).not.toContain('"message"');
  });

  test("freezes office reservation and accepted quote facts", async () => {
    const snapshot = makeAccountingDocumentSnapshot({
      workspaceReservationId: "office-reservation-id",
      dotyposReservationId: "dotypos-office-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      locale: "en-US",
      prepared: officePrepared,
    });

    expect(snapshot).toMatchObject({
      reservation: {
        kind: "office",
        startsOn: "2099-06-20",
        endsOn: "2099-06-21",
        seats: 3,
      },
      quote: officePrepared.quote,
    });
    await expect(
      Effect.runPromise(
        Schema.decodeUnknownEffect(accountingDocumentSnapshotSchema, {
          onExcessProperty: "error",
        })(snapshot)
      )
    ).resolves.toEqual(snapshot);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).toContain(adaEmail);
    expect(serialized).not.toContain("+420 777 777 777");
  });

  test("reads the Prague start date of every reservation family", () => {
    const meetingRoomSnapshot = {
      ...makeSnapshot(),
      reservation: {
        kind: "meeting-room",
        // 00:30 in Prague on June 21, still June 20 in UTC.
        startsAt: "2099-06-20T22:30:00Z",
        endsAt: "2099-06-21T00:30:00Z",
      },
    } as AccountingDocumentSnapshot;
    const overnightMeetingRoomSnapshot = {
      ...makeSnapshot(),
      reservation: {
        kind: "meeting-room",
        startsAt: "2099-06-20T20:00:00Z",
        endsAt: "2099-06-20T23:00:00Z",
      },
    } as AccountingDocumentSnapshot;
    const officeSnapshot = makeAccountingDocumentSnapshot({
      workspaceReservationId: "reservation-id",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      locale: "en-US",
      prepared: officePrepared,
    });

    expect(getAccountingDocumentSnapshotFirstServiceDate(makeSnapshot())).toBe(
      "2099-01-01"
    );
    expect(
      getAccountingDocumentSnapshotFirstServiceDate(meetingRoomSnapshot)
    ).toBe("2099-06-21");
    expect(
      getAccountingDocumentSnapshotFirstServiceDate(
        overnightMeetingRoomSnapshot
      )
    ).toBe("2099-06-20");
    expect(getAccountingDocumentSnapshotFirstServiceDate(officeSnapshot)).toBe(
      "2099-06-20"
    );
  });

  test("supports a reservation-specific business billing identity", () => {
    const buyer = {
      kind: "business" as const,
      legalName: "Analytical Engines s.r.o.",
      companyId: "12345678",
      vatId: "CZ12345678",
      address: {
        line1: "Počernická 1",
        city: "Praha",
        postalCode: "100 00",
        country: "CZ",
      },
    };
    const snapshot = makeAccountingDocumentSnapshot({
      workspaceReservationId: "business-reservation",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      locale: "cs-CZ",
      prepared: {
        ...prepared,
        reservation: {
          ...prepared.reservation,
          billing: { purpose: "business", invoice: "required", buyer },
        },
      },
    });

    expect(snapshot.buyer).toEqual(buyer);
  });

  test("decodes historical snapshots without an invoice instruction", async () => {
    const { billing: _billing, ...historicalSnapshot } = makeSnapshot();

    const decoded = await Effect.runPromise(
      decodeStoredAccountingDocumentSnapshot(historicalSnapshot)
    );

    expect(decoded.billing).toBeUndefined();
  });

  test.each(["not-vat-payer", "vat-payer"] as const)(
    "decodes a stored snapshot issued as %s with that VAT status",
    async (vatStatus) => {
      const snapshot = makeSnapshot();
      const stored = encodeStoredAccountingDocumentSnapshot({
        ...snapshot,
        supplier: { ...snapshot.supplier, vatStatus },
      });

      const decoded = await Effect.runPromise(
        decodeStoredAccountingDocumentSnapshot(stored)
      );

      expect(decoded.supplier.vatStatus).toBe(vatStatus);
    }
  );

  test("rejects a stored snapshot with an unknown VAT status", async () => {
    const snapshot = makeSnapshot();

    await expect(
      Effect.runPromise(
        decodeStoredAccountingDocumentSnapshot({
          ...snapshot,
          supplier: { ...snapshot.supplier, vatStatus: "exempt" },
        })
      )
    ).rejects.toBeDefined();
  });

  test("decodes discounts with and without a staff label", async () => {
    const snapshot = makeSnapshot();
    const price = snapshot.quote.payment.expectedPrice;
    const withDiscount = (discount: {
      label: string;
      staffLabel?: string;
    }) => ({
      ...snapshot,
      quote: {
        ...snapshot.quote,
        payment: {
          ...snapshot.quote.payment,
          discounts: [
            {
              discount: {
                id: "summer-sale",
                adjustment: { kind: "percentage", basisPoints: 1000 },
                ...discount,
              },
              subtotalBefore: price,
              amount: moneyWithValue(1, price),
              subtotalAfter: moneyWithValue(price.value - 1, price),
            },
          ],
        },
      },
    });

    const historical = await Effect.runPromise(
      decodeStoredAccountingDocumentSnapshot(
        withDiscount({ label: "Sommerrabatt" })
      )
    );
    const current = await Effect.runPromise(
      decodeStoredAccountingDocumentSnapshot(
        withDiscount({ label: "Sommerrabatt", staffLabel: "Letní sleva" })
      )
    );

    expect(historical.quote.payment.discounts[0]?.discount).not.toHaveProperty(
      "staffLabel"
    );
    expect(current.quote.payment.discounts[0]?.discount.staffLabel).toBe(
      "Letní sleva"
    );
  });

  test("rejects schema-version metadata from stored snapshots", async () => {
    const snapshot = makeSnapshot();

    await expect(
      Effect.runPromise(
        decodeStoredAccountingDocumentSnapshot({
          ...snapshot,
          schemaVersion: 1,
        })
      )
    ).rejects.toBeDefined();
    await expect(
      Effect.runPromise(
        decodeStoredAccountingDocumentSnapshot({
          ...snapshot,
          unexpected: true,
        })
      )
    ).rejects.toBeDefined();
    await expect(
      Effect.runPromise(
        decodeStoredAccountingDocumentSnapshot({
          ...snapshot,
          schemaVersion: 2,
        })
      )
    ).rejects.toBeDefined();
  });
});

test("keeps a document only in a language Workspace serves", () => {
  const decodeLocale = Schema.decodeUnknownSync(
    accountingDocumentIdentitySchema.fields.locale
  );
  expect(decodeLocale("cs-CZ")).toBe("cs-CZ");
  expect(decodeLocale("en-US")).toBe("en-US");
  expect(() => decodeLocale("zz-ZZ")).toThrow();
});
