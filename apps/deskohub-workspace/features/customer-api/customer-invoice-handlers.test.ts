import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import {
  testCustomerSession,
  testLinkedAccount,
} from "@/features/account/backend/account-operations.test-utils";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerInvoiceService } from "@/features/account/backend/customer-invoice.service";
import {
  type Invoice,
  InvoiceRepository,
} from "@/features/accounting/backend/invoice.repository";
import { AccountingRecordUnavailable } from "@/features/accounting/backend/sealed-accounting-json";
import { getInvoicedReservation } from "@/features/accounting/customer-invoice";
import {
  makeCoworkInvoiceDocument,
  makeMeetingRoomInvoiceDocument,
  makeOfficeInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "@/features/accounting/invoice.test-utils";
import { getInvoiceTotal } from "@/features/accounting/invoice-settlement";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import {
  type CustomerApiCall,
  type CustomerApiTestOptions,
  currentAccountResolving,
  customerApiRequest,
  linkedAccountServices,
  makeCustomerApiTestServer,
  testCustomerEndpointGuards,
} from "./customer-api.test-utils";

const reservationId = "019edbcf-5026-7ecc-821b-eda46998eaaa";
const coworkDocument = makeCoworkInvoiceDocument("en-US");
const manualDocument = makeTestManualInvoiceDocument("en-US", "450.50");
const cowork = getInvoicedReservation(coworkDocument);

/** The account's customer's reservation invoice. */
const reservationInvoice: Invoice = {
  id: invoiceIdSchema.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb24"),
  workspaceReservationId: reservationId,
  paymentAttemptId: "payment-attempt-1",
  dotyposCustomerId: testLinkedAccount.dotyposCustomerId,
  invoiceNumber: coworkDocument.invoiceNumber,
  // 22:30 UTC is already the next day in Prague.
  issuedAt: Temporal.Instant.from("2026-08-09T22:30:00Z"),
  document: coworkDocument,
};
/** The account's customer's manual invoice, which invoices no order. */
const manualInvoice: Invoice = {
  id: invoiceIdSchema.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23"),
  workspaceReservationId: null,
  paymentAttemptId: null,
  dotyposCustomerId: testLinkedAccount.dotyposCustomerId,
  invoiceNumber: manualDocument.invoiceNumber,
  issuedAt: Temporal.Instant.from("2026-08-01T10:00:00Z"),
  document: manualDocument,
};
/** Another customer's invoice. */
const foreignInvoice: Invoice = {
  ...reservationInvoice,
  id: invoiceIdSchema.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb99"),
  dotyposCustomerId: DotyposCustomerIdSchema.make("60999"),
};

let stored: readonly Invoice[];
let reads: string[];

beforeEach(() => {
  stored = [reservationInvoice, manualInvoice, foreignInvoice];
  reads = [];
});

/**
 * The real invoice service over an invoice store that, like its SQL, reads
 * only the asked customer's rows, and an account that is still active.
 */
const invoiceStore = (
  failure?: AccountingRecordUnavailable
): CustomerApiTestOptions["services"] => ({
  ...linkedAccountServices,
  invoices: CustomerInvoiceService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(CustomerAccountLinkRepository, {
          findActivityState: () =>
            Effect.succeed({
              kind: "active",
              email: testEmailAddress("owner"),
              deletionRequestedAt: null,
            }),
        }),
        Layer.mock(InvoiceRepository, {
          listForCustomer: (customerId) =>
            Effect.suspend(() => {
              reads.push(`list:${customerId}`);
              return failure
                ? Effect.fail(failure)
                : Effect.succeed(
                    stored.filter(
                      (invoice) => invoice.dotyposCustomerId === customerId
                    )
                  );
            }),
          findForCustomer: (customerId, invoiceId) =>
            Effect.suspend(() => {
              reads.push(`find:${customerId}:${invoiceId}`);
              return failure
                ? Effect.fail(failure)
                : Effect.succeed(
                    stored.find(
                      (invoice) =>
                        invoice.id === invoiceId &&
                        invoice.dotyposCustomerId === customerId
                    ) ?? null
                  );
            }),
        })
      )
    )
  ),
});

const storageFailure = new AccountingRecordUnavailable({
  operation: "decrypt",
  reference: { type: "invoiceId", id: reservationInvoice.id },
  message: "synthetic decryption failure",
});

/** Services whose account has no Dotypos customer profile yet. */
const profileMissing: CustomerApiTestOptions["services"] = {
  ...invoiceStore(),
  currentAccount: currentAccountResolving((session) => ({
    kind: "profile-missing",
    session,
    reviewMarker: "absent",
  })),
};

describe("listInvoices", () => {
  const listInvoices: CustomerApiCall = { method: "GET", path: "/invoices" };

  testCustomerEndpointGuards(listInvoices);

  test("lists the account's own invoices, newest issue first, each with its order", async () => {
    const api = makeCustomerApiTestServer({ services: invoiceStore() });

    const response = await api.handle(customerApiRequest(listInvoices));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      invoices: [
        {
          id: reservationInvoice.id,
          invoiceNumber: coworkDocument.invoiceNumber,
          issuedOn: "2026-08-10",
          total: getInvoiceTotal(coworkDocument),
          orderId: reservationId,
          reservation: {
            productName: getWorkspaceProductTierTitle("open-space", "en-US"),
            startsAt: cowork?.startsAt,
            endsAt: cowork?.endsAt,
          },
        },
        {
          id: manualInvoice.id,
          invoiceNumber: manualDocument.invoiceNumber,
          issuedOn: "2026-08-01",
          total: getInvoiceTotal(manualDocument),
        },
      ],
    });
    expect(reads).toEqual([`list:${testLinkedAccount.dotyposCustomerId}`]);
  });

  test("names what each order booked in the asked locale, with an office's seats", async () => {
    const meetingRoomDocument = makeMeetingRoomInvoiceDocument("cs-CZ");
    const officeDocument = makeOfficeInvoiceDocument("cs-CZ");
    stored = [
      {
        ...reservationInvoice,
        invoiceNumber: meetingRoomDocument.invoiceNumber,
        document: meetingRoomDocument,
      },
      {
        ...reservationInvoice,
        id: invoiceIdSchema.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb25"),
        invoiceNumber: officeDocument.invoiceNumber,
        document: officeDocument,
      },
    ];
    const api = makeCustomerApiTestServer({ services: invoiceStore() });

    const response = await api.handle(
      customerApiRequest({ ...listInvoices, path: "/invoices?locale=cs-CZ" })
    );

    expect(response.status).toBe(200);
    const meetingRoom = getInvoicedReservation(meetingRoomDocument);
    const office = getInvoicedReservation(officeDocument);
    const { invoices } = (await response.json()) as {
      invoices: { reservation?: unknown }[];
    };
    expect(invoices.map((invoice) => invoice.reservation)).toEqual([
      {
        productName: getWorkspaceMeetingRoomProductTitle("cs-CZ"),
        startsAt: meetingRoom?.startsAt,
        endsAt: meetingRoom?.endsAt,
      },
      {
        productName: getWorkspaceOfficeProductTitle("cs-CZ"),
        seats: office?.seats,
        startsAt: office?.startsAt,
        endsAt: office?.endsAt,
      },
    ]);
    expect(getWorkspaceMeetingRoomProductTitle("cs-CZ")).not.toBe(
      getWorkspaceMeetingRoomProductTitle("en-US")
    );
  });

  test("lists a large manual total as plain decimal text", async () => {
    stored = [
      {
        ...manualInvoice,
        document: makeTestManualInvoiceDocument("en-US", "10000000000000000"),
      },
    ];
    const api = makeCustomerApiTestServer({ services: invoiceStore() });

    const response = await api.handle(customerApiRequest(listInvoices));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      invoices: [{ total: { amount: "10000000000000000" } }],
    });
  });

  test("lists none for an account without invoices", async () => {
    stored = [foreignInvoice];
    const api = makeCustomerApiTestServer({ services: invoiceStore() });

    const response = await api.handle(customerApiRequest(listInvoices));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ invoices: [] });
  });

  test("asks an account without a Dotypos profile to complete it, reading no invoices", async () => {
    const api = makeCustomerApiTestServer({ services: profileMissing });

    const response = await api.handle(customerApiRequest(listInvoices));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerAccountLinkRequired",
      reason: "profile-missing",
    });
    expect(reads).toEqual([]);
  });

  test("answers an account awaiting deletion as deletion pending", async () => {
    const api = makeCustomerApiTestServer({
      session: { ...testCustomerSession, deletionRequested: true },
      services: invoiceStore(),
    });

    const response = await api.handle(customerApiRequest(listInvoices));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerAccountLinkRequired",
      reason: "deletion-pending",
    });
    expect(reads).toEqual([]);
  });

  test("answers unavailable when the invoices can't be read", async () => {
    const api = makeCustomerApiTestServer({
      services: invoiceStore(storageFailure),
    });

    const response = await api.handle(customerApiRequest(listInvoices));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});

describe("getInvoicePdf", () => {
  const getInvoicePdf = (invoiceId: string): CustomerApiCall => ({
    method: "GET",
    path: `/invoices/${invoiceId}/pdf`,
  });

  testCustomerEndpointGuards(getInvoicePdf(reservationInvoice.id));

  test("downloads the account's own invoice as a PDF named by its number", async () => {
    const api = makeCustomerApiTestServer({ services: invoiceStore() });

    const response = await api.handle(
      customerApiRequest(getInvoicePdf(manualInvoice.id))
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${manualDocument.invoiceNumber}.pdf"`
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(body.subarray(0, 5))).toBe("%PDF-");
  });

  test.each([
    ["another customer's invoice", foreignInvoice.id],
    ["an unknown invoice", "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb00"],
    ["text that is no invoice id", "WS-FV-2026-000042"],
  ])("answers %s as not found", async (_, invoiceId) => {
    const api = makeCustomerApiTestServer({ services: invoiceStore() });

    const response = await api.handle(
      customerApiRequest(getInvoicePdf(invoiceId))
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ _tag: "CustomerInvoiceNotFound" });
    // Only the account's own customer's invoices are ever looked up.
    expect(reads).toEqual([
      `find:${testLinkedAccount.dotyposCustomerId}:${invoiceId}`,
    ]);
  });

  test("asks an account without a Dotypos profile to complete it, reading no invoice", async () => {
    const api = makeCustomerApiTestServer({ services: profileMissing });

    const response = await api.handle(
      customerApiRequest(getInvoicePdf(reservationInvoice.id))
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerAccountLinkRequired",
      reason: "profile-missing",
    });
    expect(reads).toEqual([]);
  });

  test("answers unavailable when the invoice can't be read", async () => {
    const api = makeCustomerApiTestServer({
      services: invoiceStore(storageFailure),
    });

    const response = await api.handle(
      customerApiRequest(getInvoicePdf(reservationInvoice.id))
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});
