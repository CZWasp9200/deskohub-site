import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationDotyposCustomerId,
  AdministrationInvoiceCreateInput,
  AdministrationInvoiceId,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Logger, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  makeCoworkInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "@/features/accounting/invoice.test-utils";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { ReservationAdministrationService } from "@/features/administration/reservation-administration.service";
import {
  type Invoice,
  InvoiceRepository,
  type UnreadableInvoice,
} from "../backend/invoice.repository";
import { InvoiceArchiveRepository } from "../backend/invoice-archive.repository";
import { InvoiceCancellationRepository } from "../backend/invoice-cancellation.repository";
import { InvoiceCancellationService } from "../backend/invoice-cancellation.service";
import {
  type InvoiceDeliverySummary,
  InvoiceEmailDeliveryRepository,
} from "../backend/invoice-email-delivery.repository";
import {
  type InvoiceEmailDeliveryResult,
  InvoiceEmailDeliveryService,
} from "../backend/invoice-email-delivery.service";
import {
  formatCorrectiveDocumentNumber,
  makeCorrectiveDocument,
} from "../corrective-document";
import {
  type InvoiceAdministrationListItem,
  InvoiceAdministrationService,
  type InvoiceAdministrationUnreadableListItem,
  sortInvoiceAdministrationItems,
} from "./invoice-administration.service";
import {
  liveInvoiceCancellationFakes,
  liveInvoiceStanding,
} from "./invoice-administration.service.test-utils";
import { ManualInvoiceCreationRequests } from "./manual-invoice-creation-requests.service";

const input = Schema.decodeUnknownSync(AdministrationInvoiceCreateInput)({
  invoiceId: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23",
  customer: {
    kind: "new",
    details: {
      kind: "person",
      email: testEmailAddress("synthetic"),
      firstName: "Synthetic",
      lastName: "Customer",
      address: {
        line1: "Test street 1",
        city: "Prague",
        postalCode: "100 00",
        country: "CZ",
      },
    },
  },
  locale: "cs-CZ",
  serviceDate: "2026-08-18",
  payment: { status: "due", date: "2026-09-01" },
  currency: "CZK",
  lines: [{ description: "Space rental", price: "1000" }],
});

const issuer = {
  source: "admin-ui",
  administrator: {
    accountId: customerAccountIdSchema.make(crypto.randomUUID()),
    email: testEmailAddress("invoice-administrator"),
  },
} as const;

const deliveredEverywhere: InvoiceDeliverySummary = {
  customer: "accepted",
  internal: "accepted",
  needsAttention: false,
};

const deliveryLedger = (
  summaryOf: (invoiceId: string) => InvoiceDeliverySummary = () =>
    deliveredEverywhere
) =>
  Layer.mock(InvoiceEmailDeliveryRepository, {
    status: (invoiceIds) =>
      Effect.succeed(
        new Map(invoiceIds.map((id) => [id, summaryOf(id)] as const))
      ),
  });

describe("InvoiceAdministrationService", () => {
  test("projects reservation and customer references", async () => {
    const document = {
      ...makeCoworkInvoiceDocument("en-US"),
      // Late evening UTC is already the next calendar day in Prague.
      fulfilledAt: "2026-08-10T22:30:00Z" as never,
    };
    const invoice = {
      id: invoiceIdSchema.make("01980000-0000-7000-8000-000000000009"),
      workspaceReservationId: "workspace-reservation",
      paymentAttemptId: "payment-attempt",
      dotyposCustomerId: "dotypos-customer",
      invoiceNumber: document.invoiceNumber,
      issuedAt: Temporal.Instant.from(document.issuedAt),
      document,
      ...liveInvoiceStanding,
    } satisfies Invoice;
    const failedInternally: InvoiceDeliverySummary = {
      customer: "accepted",
      internal: "failed",
      needsAttention: true,
    };
    const manualDocument = makeTestManualInvoiceDocument("en-US");
    const manualInvoice = {
      id: manualDocument.invoiceId,
      workspaceReservationId: null,
      paymentAttemptId: null,
      dotyposCustomerId: manualDocument.dotyposCustomerId,
      invoiceNumber: manualDocument.invoiceNumber,
      issuedAt: Temporal.Instant.from(manualDocument.issuedAt),
      document: manualDocument,
      ...liveInvoiceStanding,
    } satisfies Invoice;
    const layer = InvoiceAdministrationService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(DotyposService, {}),
          Layer.mock(InvoiceRepository, {
            findById: () => Effect.succeed(invoice),
            list: () => Effect.succeed([manualInvoice, invoice]),
          }),
          deliveryLedger((id) =>
            id === invoice.id ? failedInternally : deliveredEverywhere
          ),
          Layer.mock(InvoiceEmailDeliveryService, {}),
          Layer.mock(ManualInvoiceCreationRequests, {}),
          Layer.mock(WorkspaceDatabase, {}),
          liveInvoiceCancellationFakes
        )
      )
    );

    const result = await Effect.gen(function* () {
      const service = yield* InvoiceAdministrationService;
      return yield* Effect.all([
        service.list(),
        service.get(invoice.id, { includeArchived: true }),
      ]);
    }).pipe(Effect.provide(layer), Effect.runPromise);

    for (const projected of [result[0].items[0], result[1]]) {
      expect(projected).toMatchObject({
        customerId: "dotypos-customer",
        reservationId: "workspace-reservation",
        delivery: { customer: "accepted", internal: "failed" },
        needsAttention: true,
      });
    }
    expect(result[0].items[1]).toMatchObject({
      reservationId: null,
      delivery: { customer: "accepted", internal: "accepted" },
      needsAttention: false,
    });
    expect(result[1].serviceDate).toBe("2026-08-11");
  });

  test("signals a searched customer without a name or email", async () => {
    const email = testEmailAddress("unnamed-search");
    const layer = InvoiceAdministrationService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(DotyposService, {
            searchCustomers: () =>
              Effect.succeed([
                { id: "dotypos-customer-unnamed" },
                { id: "dotypos-customer-email", email: ` ${email} ` },
              ] as never),
          }),
          Layer.mock(InvoiceRepository, {}),
          Layer.mock(InvoiceEmailDeliveryRepository, {}),
          Layer.mock(InvoiceEmailDeliveryService, {}),
          Layer.mock(ManualInvoiceCreationRequests, {}),
          Layer.mock(WorkspaceDatabase, {}),
          liveInvoiceCancellationFakes
        )
      )
    );

    const customers = await Effect.gen(function* () {
      const service = yield* InvoiceAdministrationService;
      return yield* service.searchCustomers("synthetic");
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(customers).toMatchObject([
      { displayName: "Unnamed customer", hasName: false },
      { displayName: email, hasName: true },
    ]);
  });

  test("projects searched customers' billing details and skips deleted ones", async () => {
    const businessEmail = testEmailAddress("business-search");
    const personEmail = testEmailAddress("person-search");
    const layer = InvoiceAdministrationService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(DotyposService, {
            searchCustomers: () =>
              Effect.succeed([
                {
                  id: "dotypos-customer-business",
                  companyName: " Synthetic s.r.o. ",
                  companyId: " 12345678 ",
                  vatId: " CZ12345678 ",
                  firstName: " Ada ",
                  email: ` ${businessEmail} `,
                  phone: " +420 777 000 000 ",
                  addressLine1: " Test street 1 ",
                  addressLine2: " Floor 2 ",
                  city: " Prague ",
                  zip: " 100 00 ",
                  country: " sk ",
                },
                {
                  id: "dotypos-customer-person",
                  firstName: "Grace",
                  lastName: "Hopper",
                  email: personEmail,
                  phone: "  ",
                  addressLine2: " ",
                  vatId: "CZ0",
                },
                { id: "dotypos-customer-deleted", deleted: true },
              ] as never),
          }),
          Layer.mock(InvoiceRepository, {}),
          Layer.mock(InvoiceEmailDeliveryRepository, {}),
          Layer.mock(InvoiceEmailDeliveryService, {}),
          Layer.mock(ManualInvoiceCreationRequests, {}),
          Layer.mock(WorkspaceDatabase, {}),
          liveInvoiceCancellationFakes
        )
      )
    );

    const customers = await Effect.gen(function* () {
      const service = yield* InvoiceAdministrationService;
      return yield* service.searchCustomers("synthetic");
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(customers).toEqual([
      {
        id: "dotypos-customer-business",
        displayName: "Ada",
        hasName: true,
        lifecycle: "active",
        email: businessEmail,
        details: {
          kind: "business",
          companyName: "Synthetic s.r.o.",
          companyId: "12345678",
          vatId: "CZ12345678",
          email: businessEmail,
          phone: "+420 777 000 000",
          firstName: "Ada",
          lastName: undefined,
          address: {
            line1: "Test street 1",
            line2: "Floor 2",
            city: "Prague",
            postalCode: "100 00",
            country: "SK",
          },
        },
      },
      {
        id: "dotypos-customer-person",
        displayName: "Grace Hopper",
        hasName: true,
        lifecycle: "active",
        email: personEmail,
        details: {
          kind: "person",
          firstName: "Grace",
          lastName: "Hopper",
          email: personEmail,
          address: {
            line1: "",
            city: "",
            postalCode: "",
            country: "CZ",
          },
        },
      },
    ]);
  });

  describe("retrying an invoice's email delivery", () => {
    const stored = makeTestManualInvoiceDocument("en-US");
    const invoice = {
      id: stored.invoiceId,
      workspaceReservationId: null,
      paymentAttemptId: null,
      dotyposCustomerId: stored.dotyposCustomerId,
      invoiceNumber: stored.invoiceNumber,
      issuedAt: Temporal.Instant.from(stored.issuedAt),
      document: stored,
      ...liveInvoiceStanding,
    } satisfies Invoice;

    const retryWith = (
      found: Invoice | null,
      delivery: InvoiceEmailDeliveryResult,
      summary: InvoiceDeliverySummary = deliveredEverywhere
    ) => {
      const deliverByInvoiceId = mock(() => Effect.succeed(delivery));
      const layer = InvoiceAdministrationService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, {}),
            Layer.mock(InvoiceRepository, {
              findById: () => Effect.succeed(found),
            }),
            deliveryLedger(() => summary),
            Layer.mock(InvoiceEmailDeliveryService, { deliverByInvoiceId }),
            Layer.mock(ManualInvoiceCreationRequests, {}),
            Layer.mock(WorkspaceDatabase, {}),
            liveInvoiceCancellationFakes
          )
        )
      );
      const run = Effect.gen(function* () {
        const service = yield* InvoiceAdministrationService;
        return yield* service.retry(invoice.id);
      }).pipe(Effect.provide(layer));
      return { deliverByInvoiceId, run };
    };

    test("reports a delivery that sent something and the remaining attention", async () => {
      const { deliverByInvoiceId, run } = retryWith(
        invoice,
        { status: "delivered", changed: true },
        { customer: "accepted", internal: "failed", needsAttention: true }
      );

      expect(await Effect.runPromise(run)).toEqual({
        invoiceId: AdministrationInvoiceId.make(invoice.id),
        changed: true,
        needsAttention: true,
        notices: null,
        reservationId: null,
      });
      expect(deliverByInvoiceId).toHaveBeenCalledWith({
        invoiceId: invoice.id,
      });
    });

    test("names the reservation a reservation invoice bills", async () => {
      const { run } = retryWith(
        {
          ...invoice,
          workspaceReservationId: "workspace-reservation" as never,
        },
        { status: "delivered", changed: true }
      );

      expect(await Effect.runPromise(run)).toMatchObject({
        reservationId: "workspace-reservation",
      });
    });

    test("reports no change when the delivery found nothing to send", async () => {
      const { run } = retryWith(invoice, { status: "not_issued" });

      expect(await Effect.runPromise(run)).toMatchObject({
        changed: false,
        needsAttention: false,
      });
    });

    test("fails as not found without delivering for an unknown invoice", async () => {
      const { deliverByInvoiceId, run } = retryWith(null, {
        status: "delivered",
        changed: true,
      });

      expect(await Effect.runPromise(Effect.flip(run))).toMatchObject({
        _tag: "InvoiceAdministrationNotFoundError",
        invoiceId: invoice.id,
      });
      expect(deliverByInvoiceId).not.toHaveBeenCalled();
    });
  });

  test("renders a PDF preview without touching providers or persistence", async () => {
    const providerMutation = mock(() => Effect.die("provider mutation"));
    const repositoryMutation = mock(() => Effect.die("repository mutation"));
    const deliveryMutation = mock(() => Effect.die("delivery mutation"));
    const claimMutation = mock(() => Effect.die("claim mutation"));
    const layer = InvoiceAdministrationService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(DotyposService, { createCustomer: providerMutation }),
          Layer.mock(InvoiceRepository, { issueManual: repositoryMutation }),
          Layer.mock(InvoiceEmailDeliveryRepository, {}),
          Layer.mock(InvoiceEmailDeliveryService, {
            deliverByInvoiceId: deliveryMutation,
          }),
          Layer.mock(ManualInvoiceCreationRequests, { claim: claimMutation }),
          Layer.mock(WorkspaceDatabase, {}),
          liveInvoiceCancellationFakes
        )
      )
    );

    const pdf = await Effect.gen(function* () {
      const service = yield* InvoiceAdministrationService;
      return yield* service.preview(input, issuer);
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
    expect(providerMutation).not.toHaveBeenCalled();
    expect(repositoryMutation).not.toHaveBeenCalled();
    expect(deliveryMutation).not.toHaveBeenCalled();
    expect(claimMutation).not.toHaveBeenCalled();
  });

  test("downloads a stored invoice as a PDF named by its number", async () => {
    const document = makeCoworkInvoiceDocument("en-US");
    const invoice = {
      id: invoiceIdSchema.make("01980000-0000-7000-8000-000000000010"),
      workspaceReservationId: "workspace-reservation",
      paymentAttemptId: "payment-attempt",
      dotyposCustomerId: "dotypos-customer",
      invoiceNumber: document.invoiceNumber,
      issuedAt: Temporal.Instant.from(document.issuedAt),
      document,
      ...liveInvoiceStanding,
    } satisfies Invoice;
    const findById = mock((id: string) =>
      Effect.succeed(id === invoice.id ? invoice : null)
    );
    const layer = InvoiceAdministrationService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(DotyposService, {}),
          Layer.mock(InvoiceRepository, { findById }),
          Layer.mock(InvoiceEmailDeliveryRepository, {}),
          Layer.mock(InvoiceEmailDeliveryService, {}),
          Layer.mock(ManualInvoiceCreationRequests, {}),
          Layer.mock(WorkspaceDatabase, {}),
          liveInvoiceCancellationFakes
        )
      )
    );
    const missingId = "01980000-0000-7000-8000-000000000011";

    const [pdf, missing] = await Effect.gen(function* () {
      const service = yield* InvoiceAdministrationService;
      return yield* Effect.all([
        service.getPdf(invoice.id, { includeArchived: true }),
        Effect.flip(service.getPdf(missingId, { includeArchived: true })),
      ]);
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(Buffer.from(pdf.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.fileName).toBe(`${document.invoiceNumber}.pdf`);
    expect(missing).toMatchObject({
      _tag: "InvoiceAdministrationNotFoundError",
      invoiceId: missingId,
    });
  });
});

const item = (
  id: string,
  overrides: Partial<InvoiceAdministrationListItem> = {}
): InvoiceAdministrationListItem => ({
  id: AdministrationInvoiceId.make(id),
  invoiceNumber: id,
  issuedAt: "2026-08-18T10:00:00.000Z",
  customerId: AdministrationDotyposCustomerId.make(id),
  customerName: id,
  reservationId: null,
  total: "0",
  currency: "CZK",
  paymentStatus: "paid",
  source: "legacy",
  actor: null,
  delivery: { customer: "accepted", internal: "accepted" },
  needsAttention: false,
  ...overrides,
});

describe("invoice administration sorting", () => {
  test("groups attention only by default and compares decimal totals exactly", () => {
    const olderAttention = item("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21", {
      issuedAt: "2026-01-01T00:00:00.000Z",
      needsAttention: true,
      total: "900719925474099312345678.01",
    });
    const newer = item("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb22", {
      issuedAt: "2026-08-18T00:00:00.000Z",
      total: "900719925474099312345678.02",
    });

    expect(sortInvoiceAdministrationItems([newer, olderAttention], {})).toEqual(
      [olderAttention, newer]
    );
    expect(
      sortInvoiceAdministrationItems([olderAttention, newer], {
        sort: "total",
        direction: "asc",
      })
    ).toEqual([olderAttention, newer]);
    expect(
      sortInvoiceAdministrationItems([olderAttention, newer], {
        sort: "issuedAt",
        direction: "desc",
      })
    ).toEqual([newer, olderAttention]);
  });

  test("orders an unreadable invoice by its issue time, and after readable invoices by fields its document holds", () => {
    const readable = item("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21", {
      issuedAt: "2026-08-18T00:00:00.000Z",
    });
    const unreadable = {
      documentUnavailable: true,
      id: AdministrationInvoiceId.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb22"),
      invoiceNumber: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb22",
      issuedAt: "2026-08-19T00:00:00.000Z",
      cancelledAt: null,
      archivedAt: null,
      replacesInvoiceId: null,
      replacedByInvoiceId: null,
    } satisfies InvoiceAdministrationUnreadableListItem;

    expect(sortInvoiceAdministrationItems([readable, unreadable], {})).toEqual([
      unreadable,
      readable,
    ]);
    for (const direction of ["asc", "desc"] as const) {
      expect(
        sortInvoiceAdministrationItems([unreadable, readable], {
          sort: "customer",
          direction,
        })
      ).toEqual([readable, unreadable]);
    }
  });

  test("sorts payment status only when explicitly requested", () => {
    const paid = item("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21");
    const overdue = item("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb22", {
      paymentStatus: "overdue",
      needsAttention: true,
    });

    expect(
      sortInvoiceAdministrationItems([overdue, paid], {
        sort: "paymentStatus",
        direction: "asc",
      })
    ).toEqual([overdue, paid]);
  });
});

describe("InvoiceAdministrationService cancellation", () => {
  const invoiceId = invoiceIdSchema.make(
    "01980000-0000-7000-8000-0000000000c1"
  );
  const reservationId = "workspace-reservation-c1";
  const record = {
    invoiceId,
    cancelledAt: Temporal.Instant.from("2026-11-15T10:00:00Z"),
    cause: "invoice_cancellation",
    correctiveDocumentNumber: "WS-OD-2026-000001",
    correctiveDocumentIssuedAt: Temporal.Instant.from("2026-11-15T10:00:00Z"),
    source: "admin-ui",
    actor: {
      accountId: issuer.administrator.accountId,
      email: issuer.administrator.email,
    },
    notices: {
      customer: "not_owed",
      internal: "accepted",
      needsAttention: false,
    },
  } as const;
  const planOf = (
    reservation:
      | "none"
      | "cancels_reservation"
      | "already_cancelled"
      | "cancellation_in_progress",
    cancelled = false
  ) => ({
    invoice: {
      id: invoiceId,
      invoiceNumber: "WS-FV-2026-000009" as never,
      reservationId: reservation === "none" ? null : (reservationId as never),
      cancelled,
    },
    customerNotice: "owed" as const,
    reservation,
  });

  const makeService = (options: {
    readonly plan: ReturnType<typeof planOf>;
    readonly invoices?: readonly Invoice[];
    readonly unreadable?: readonly UnreadableInvoice[];
    readonly correctiveDocument?: ReturnType<typeof makeCorrectiveDocument>;
  }) => {
    const cancelStandalone = mock(() =>
      Effect.succeed({ outcome: "cancelled" as const, cancellation: record })
    );
    const cancelReservation = mock(() =>
      Effect.succeed({
        outcome: "cancelled" as const,
        email: "sent" as const,
        invoice: {
          outcome: "cancelled" as const,
          invoiceId,
          invoiceNumber: "WS-FV-2026-000009",
          correctiveDocumentNumber: record.correctiveDocumentNumber,
          notices: record.notices,
        },
      })
    );
    const archive = mock(() =>
      Effect.succeed({
        changed: true,
        archive: {
          invoiceId,
          archivedAt: Temporal.Instant.from("2026-11-15T11:00:00Z"),
          source: "admin-ui",
          actor: record.actor,
        },
      })
    );
    const retryNotices = mock(() =>
      Effect.succeed({
        changed: true,
        notices: {
          customer: "accepted",
          internal: "accepted",
          needsAttention: false,
        },
      })
    );
    const deliverByInvoiceId = mock(() => Effect.die("original email resent"));
    const layer = InvoiceAdministrationService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(DotyposService, {}),
          Layer.mock(InvoiceRepository, {
            findById: (id) =>
              Effect.succeed(
                (options.invoices ?? []).find((invoice) => invoice.id === id) ??
                  null
              ),
            list: () => Effect.succeed([...(options.invoices ?? [])]),
            listWithUnreadable: () =>
              Effect.succeed({
                readable: [...(options.invoices ?? [])],
                unreadable: [...(options.unreadable ?? [])],
              }),
          }),
          deliveryLedger(),
          Layer.mock(InvoiceEmailDeliveryService, { deliverByInvoiceId }),
          Layer.mock(ManualInvoiceCreationRequests, {}),
          Layer.mock(WorkspaceDatabase, {}),
          Layer.mock(InvoiceCancellationService, {
            plan: () => Effect.succeed(options.plan),
            cancelStandalone,
            retryNotices,
          }),
          Layer.mock(InvoiceCancellationRepository, {
            find: () => Effect.succeed(record),
            loadCorrectiveDocument: () =>
              Effect.succeed(options.correctiveDocument ?? null),
            findMany: (ids) =>
              Effect.succeed(
                new Map(
                  ids
                    .filter((id) => id === invoiceId)
                    .map((id) => [id, record] as const)
                )
              ),
          }),
          Layer.mock(InvoiceArchiveRepository, { archive }),
          Layer.mock(ReservationAdministrationService, {
            cancel: cancelReservation,
          })
        )
      )
    );
    const run = <A, E>(
      operation: (
        service: InvoiceAdministrationService["Service"]
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        InvoiceAdministrationService.pipe(
          Effect.flatMap(operation),
          Effect.provide(layer)
        )
      );
    return {
      archive,
      cancelReservation,
      cancelStandalone,
      deliverByInvoiceId,
      retryNotices,
      run,
    };
  };
  const reservationConfirmation = {
    sendCancellationEmail: true,
  };

  test("cancels a live reservation's invoice only through the reservation's cancellation", async () => {
    const service = makeService({ plan: planOf("cancels_reservation") });

    const refused = await service.run((administration) =>
      Effect.flip(
        administration.cancel({
          invoiceId,
          actor: issuer,
          confirmedCustomerNotice: true,
        })
      )
    );
    const cancelled = await service.run((administration) =>
      administration.cancel({
        invoiceId,
        actor: issuer,
        confirmedCustomerNotice: true,
        reservation: reservationConfirmation,
      })
    );

    expect(refused).toMatchObject({
      code: "reservation_confirmation_required",
    });
    expect(service.cancelReservation).toHaveBeenCalledTimes(1);
    expect(service.cancelReservation).toHaveBeenCalledWith({
      ...reservationConfirmation,
      reservationId,
      actor: issuer,
      confirmedConsequences: { invoice: true, customerNotice: true },
    });
    expect(service.cancelStandalone).not.toHaveBeenCalled();
    expect(cancelled).toMatchObject({
      invoiceId,
      outcome: "cancelled",
      cancellation: {
        correctiveDocumentNumber: record.correctiveDocumentNumber,
        actor: issuer.administrator.email,
        source: "admin-ui",
        cause: "invoice_cancellation",
      },
      reservation: { reservationId, outcome: "cancelled", email: "sent" },
    });
  });

  for (const plan of [
    planOf("none"),
    planOf("already_cancelled"),
    planOf("cancels_reservation", true),
  ]) {
    test(`cancels alone when the plan is ${plan.reservation}${plan.invoice.cancelled ? " and the invoice is cancelled" : ""}`, async () => {
      const service = makeService({ plan });

      const result = await service.run((administration) =>
        administration.cancel({
          invoiceId,
          actor: issuer,
          confirmedCustomerNotice: false,
        })
      );

      expect(service.cancelStandalone).toHaveBeenCalledWith({
        invoiceId,
        actor: issuer,
        confirmedCustomerNotice: false,
      });
      expect(service.cancelReservation).not.toHaveBeenCalled();
      expect(result).toMatchObject({ outcome: "cancelled", reservation: null });
    });
  }

  test("refuses while the reservation's cancellation is in progress", async () => {
    const service = makeService({ plan: planOf("cancellation_in_progress") });

    const refused = await service.run((administration) =>
      Effect.flip(
        administration.cancel({
          invoiceId,
          actor: issuer,
          confirmedCustomerNotice: true,
          reservation: reservationConfirmation,
        })
      )
    );

    expect(refused).toMatchObject({
      code: "reservation_cancellation_in_progress",
    });
    expect(service.cancelReservation).not.toHaveBeenCalled();
    expect(service.cancelStandalone).not.toHaveBeenCalled();
  });

  test("lists archived invoices only on request and hides them from Admin UI reads", async () => {
    const document = makeTestManualInvoiceDocument("en-US");
    const base = {
      workspaceReservationId: null,
      paymentAttemptId: null,
      dotyposCustomerId: document.dotyposCustomerId,
      invoiceNumber: document.invoiceNumber,
      issuedAt: Temporal.Instant.from(document.issuedAt),
      document,
      replacesInvoiceId: null,
      replacedByInvoiceId: null,
    };
    const archived = {
      ...base,
      id: invoiceId,
      cancellation: {
        cancelledAt: record.cancelledAt,
        cause: record.cause,
        correctiveDocumentNumber: record.correctiveDocumentNumber as never,
      },
      archivedAt: Temporal.Instant.from("2026-11-15T11:00:00Z"),
    } satisfies Invoice;
    const live = {
      ...base,
      id: invoiceIdSchema.make("01980000-0000-7000-8000-0000000000c2"),
      cancellation: null,
      archivedAt: null,
    } satisfies Invoice;
    const service = makeService({
      plan: planOf("none"),
      invoices: [archived, live],
    });

    const listed = await service.run((administration) => administration.list());
    const all = await service.run((administration) =>
      administration.list({ includeArchived: true })
    );
    const hidden = await service.run((administration) =>
      Effect.flip(administration.get(invoiceId, { includeArchived: false }))
    );
    const read = await service.run((administration) =>
      administration.get(invoiceId, { includeArchived: true })
    );

    expect(listed.items.map(({ id }) => id)).toEqual([live.id]);
    expect(all.items.map(({ id }) => id).toSorted()).toEqual(
      [invoiceId, live.id].toSorted()
    );
    expect(hidden._tag).toBe("InvoiceAdministrationNotFoundError");
    expect(read).toMatchObject({
      archivedAt: "2026-11-15T11:00:00Z",
      cancellation: {
        correctiveDocumentNumber: record.correctiveDocumentNumber,
      },
      cancellationPlan: null,
    });
  });

  test("lists invoices whose documents cannot be read from their unencrypted columns, by issue time, and logs them once", async () => {
    const document = makeTestManualInvoiceDocument("en-US");
    const readable = {
      id: invoiceIdSchema.make("01980000-0000-7000-8000-0000000000c2"),
      workspaceReservationId: null,
      paymentAttemptId: null,
      dotyposCustomerId: document.dotyposCustomerId,
      invoiceNumber: document.invoiceNumber,
      issuedAt: Temporal.Instant.from("2026-11-10T10:00:00Z"),
      document,
      cancellation: null,
      archivedAt: null,
      replacesInvoiceId: null,
      replacedByInvoiceId: null,
    } satisfies Invoice;
    const unreadable = (
      id: string,
      issuedAt: string,
      standing: Partial<UnreadableInvoice> = {}
    ): UnreadableInvoice => ({
      id: invoiceIdSchema.make(id),
      invoiceNumber: `WS-FV-2026-${id.slice(-6)}` as never,
      issuedAt: Temporal.Instant.from(issuedAt),
      cancellation: null,
      archivedAt: null,
      replacesInvoiceId: null,
      replacedByInvoiceId: null,
      ...standing,
    });
    const newer = unreadable(
      "01980000-0000-7000-8000-0000000000d1",
      "2026-11-12T10:00:00Z",
      {
        cancellation: {
          cancelledAt: record.cancelledAt,
          cause: record.cause,
          correctiveDocumentNumber: record.correctiveDocumentNumber as never,
        },
      }
    );
    const older = unreadable(
      "01980000-0000-7000-8000-0000000000d2",
      "2026-11-01T10:00:00Z"
    );
    const hidden = unreadable(
      "01980000-0000-7000-8000-0000000000d3",
      "2026-11-05T10:00:00Z",
      { archivedAt: Temporal.Instant.from("2026-11-15T11:00:00Z") }
    );
    const service = makeService({
      plan: planOf("none"),
      invoices: [readable],
      unreadable: [older, hidden, newer],
    });
    const warnings: unknown[] = [];
    const captureWarnings = Logger.make(({ logLevel, message }) => {
      if (logLevel === "Warn") warnings.push(message);
    });

    const listed = await service.run((administration) =>
      administration
        .listWithUnreadable({ sort: "issuedAt", direction: "desc" })
        .pipe(Effect.provide(Logger.layer([captureWarnings])))
    );
    const strict = await service.run((administration) => administration.list());

    expect(listed.items.map(({ id }) => id)).toEqual([
      newer.id,
      readable.id,
      older.id,
    ]);
    expect(listed.total).toBe(3);
    expect(listed.items[0]).toEqual({
      documentUnavailable: true,
      id: AdministrationInvoiceId.make(newer.id),
      invoiceNumber: newer.invoiceNumber,
      issuedAt: newer.issuedAt.toString(),
      cancelledAt: record.cancelledAt.toString(),
      archivedAt: null,
      replacesInvoiceId: null,
      replacedByInvoiceId: null,
    });
    expect(listed.items[1]).not.toHaveProperty("documentUnavailable");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContainEqual({
      count: 3,
      invoiceIds: [older.id, hidden.id, newer.id],
    });
    expect(strict.items.map(({ id }) => id)).toEqual([readable.id]);
  });

  test("archives with the actor and retries a cancelled invoice's notices, never its original email", async () => {
    const document = makeTestManualInvoiceDocument("en-US");
    const cancelled = {
      id: invoiceId,
      workspaceReservationId: null,
      paymentAttemptId: null,
      dotyposCustomerId: document.dotyposCustomerId,
      invoiceNumber: document.invoiceNumber,
      issuedAt: Temporal.Instant.from(document.issuedAt),
      document,
      cancellation: {
        cancelledAt: record.cancelledAt,
        cause: record.cause,
        correctiveDocumentNumber: record.correctiveDocumentNumber as never,
      },
      archivedAt: null,
      replacesInvoiceId: null,
      replacedByInvoiceId: null,
    } satisfies Invoice;
    const service = makeService({
      plan: planOf("none"),
      invoices: [cancelled],
    });

    const archived = await service.run((administration) =>
      administration.archive({ invoiceId, actor: issuer })
    );
    const retried = await service.run((administration) =>
      administration.retry(invoiceId)
    );

    expect(service.archive).toHaveBeenCalledWith({ invoiceId, actor: issuer });
    expect(archived).toEqual({
      invoiceId,
      archivedAt: "2026-11-15T11:00:00Z",
      changed: true,
    });
    expect(service.retryNotices).toHaveBeenCalledWith(invoiceId);
    expect(service.deliverByInvoiceId).not.toHaveBeenCalled();
    expect(retried).toEqual({
      invoiceId,
      changed: true,
      needsAttention: false,
      notices: {
        customer: "accepted",
        internal: "accepted",
        needsAttention: false,
      },
      reservationId: null,
    });
  });

  test("downloads a cancelled invoice's corrective document, archived or not, only within the read scope", async () => {
    const document = makeTestManualInvoiceDocument("en-US");
    const base = {
      workspaceReservationId: null,
      paymentAttemptId: null,
      dotyposCustomerId: document.dotyposCustomerId,
      invoiceNumber: document.invoiceNumber,
      issuedAt: Temporal.Instant.from(document.issuedAt),
      document,
      replacesInvoiceId: null,
      replacedByInvoiceId: null,
    };
    const archived = {
      ...base,
      id: invoiceId,
      cancellation: {
        cancelledAt: record.cancelledAt,
        cause: record.cause,
        correctiveDocumentNumber: record.correctiveDocumentNumber as never,
      },
      archivedAt: Temporal.Instant.from("2026-11-15T11:00:00Z"),
    } satisfies Invoice;
    const live = {
      ...base,
      id: invoiceIdSchema.make("01980000-0000-7000-8000-0000000000c2"),
      cancellation: null,
      archivedAt: null,
    } satisfies Invoice;
    const correctiveDocument = makeCorrectiveDocument({
      invoice: { id: invoiceId, document },
      cause: "invoice_cancellation",
      actor: issuer,
      documentNumber: formatCorrectiveDocumentNumber({
        year: 2026,
        sequence: 1,
      }),
      issuedAt: record.correctiveDocumentIssuedAt,
    });
    const service = makeService({
      plan: planOf("none"),
      invoices: [archived, live],
      correctiveDocument,
    });
    const unknownId = "01980000-0000-7000-8000-0000000000c3";

    const pdf = await service.run((administration) =>
      administration.getCorrectiveDocumentPdf(invoiceId, {
        includeArchived: true,
      })
    );
    const refusals = await service.run((administration) =>
      Effect.all(
        [
          administration.getCorrectiveDocumentPdf(invoiceId, {
            includeArchived: false,
          }),
          administration.getCorrectiveDocumentPdf(live.id, {
            includeArchived: true,
          }),
          administration.getCorrectiveDocumentPdf(unknownId, {
            includeArchived: true,
          }),
        ].map((read) => Effect.flip(read))
      )
    );
    const unavailable = await makeService({
      plan: planOf("none"),
      invoices: [archived],
    }).run((administration) =>
      Effect.flip(
        administration.getCorrectiveDocumentPdf(invoiceId, {
          includeArchived: true,
        })
      )
    );

    expect(Buffer.from(pdf.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.fileName).toBe(`${correctiveDocument.documentNumber}.pdf`);
    expect(refusals.map(({ _tag }) => _tag)).toEqual([
      "InvoiceAdministrationNotFoundError",
      "InvoiceAdministrationNotFoundError",
      "InvoiceAdministrationNotFoundError",
    ]);
    expect(unavailable).toMatchObject({
      _tag: "InvoiceCancellationError",
      code: "document_unavailable",
    });
  });
});
