import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { SqlError } from "effect/unstable/sql";
import type { Invoice } from "@/features/accounting/backend/invoice.repository";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import { InvoiceCancellationRepository } from "@/features/accounting/backend/invoice-cancellation.repository";
import { AccountingRecordUnavailable } from "@/features/accounting/backend/sealed-accounting-json";
import {
  type CorrectiveDocument,
  correctiveDocumentNumberSchema,
  makeCorrectiveDocument,
} from "@/features/accounting/corrective-document";
import {
  getCustomerInvoiceStatus,
  getCustomerInvoiceSummary,
} from "@/features/accounting/customer-invoice";
import {
  makeCoworkInvoiceDocument,
  makeMeetingRoomInvoiceDocument,
  makeOfficeInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "@/features/accounting/invoice.test-utils";
import { InvoiceCancellationError } from "@/features/accounting/invoice-cancellation";
import {
  type InvoiceId,
  invoiceIdSchema,
} from "@/features/accounting/manual-invoice";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountIdSchema,
  customerAccountUnavailable,
} from "../customer-account";
import { CurrentCustomerAccount } from "./current-customer-account";
import {
  type ResolvedStanding,
  testResolvedStandings,
} from "./current-customer-account.test-utils";
import {
  type CustomerAccountActivityState,
  CustomerAccountLinkRepository,
} from "./customer-account-link.repository";
import {
  CustomerInvoiceNotFoundError,
  CustomerInvoiceService,
  CustomerInvoicesLoadError,
  CustomerInvoicesUnavailableError,
} from "./customer-invoice.service";

const accountId: CustomerAccountId = customerAccountIdSchema.make(
  "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a01"
);
const dotyposCustomerId = DotyposCustomerIdSchema.make("dotypos-customer-ada");

const dueInvoice: Invoice = {
  id: invoiceIdSchema.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23"),
  workspaceReservationId: null,
  paymentAttemptId: null,
  dotyposCustomerId,
  invoiceNumber: makeTestManualInvoiceDocument("en-US").invoiceNumber,
  issuedAt: Temporal.Instant.from("2026-08-20T10:00:00Z"),
  // Due 2026-09-01.
  document: makeTestManualInvoiceDocument("en-US", "450.50"),
  cancellation: null,
  archivedAt: null,
  replacesInvoiceId: null,
  replacedByInvoiceId: null,
};
const coworkDocument = makeCoworkInvoiceDocument("en-US");
const paidInvoice: Invoice = {
  id: invoiceIdSchema.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb24"),
  workspaceReservationId: "reservation-1",
  paymentAttemptId: "payment-attempt-1",
  dotyposCustomerId,
  invoiceNumber: coworkDocument.invoiceNumber,
  issuedAt: Temporal.Instant.from("2026-08-10T10:00:00Z"),
  document: coworkDocument,
  cancellation: null,
  archivedAt: null,
  replacesInvoiceId: null,
  replacedByInvoiceId: null,
};

const correctiveDocumentNumber =
  correctiveDocumentNumberSchema.make("WS-OD-2026-000007");
/** Cancelled and then hidden from the administration's invoice list. */
const cancelledInvoice: Invoice = {
  ...paidInvoice,
  id: invoiceIdSchema.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb25"),
  cancellation: {
    cancelledAt: Temporal.Instant.from("2026-08-25T09:00:00Z"),
    cause: "invoice_cancellation",
    correctiveDocumentNumber,
  },
  archivedAt: Temporal.Instant.from("2026-08-26T09:00:00Z"),
};
const correctiveDocument: CorrectiveDocument = makeCorrectiveDocument({
  invoice: cancelledInvoice,
  cause: "invoice_cancellation",
  actor: {
    source: "admin-ui",
    administrator: {
      accountId: customerAccountIdSchema.make(
        "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a02"
      ),
      email: testEmailAddress("administrator"),
    },
  },
  documentNumber: correctiveDocumentNumber,
  issuedAt: Temporal.Instant.from("2026-08-25T09:00:00Z"),
});

// 22:30 UTC on 2026-09-01 is already 2026-09-02 in Prague, so the due
// invoice is overdue only by the Prague date.
const now = Temporal.Instant.from("2026-09-01T22:30:00Z");
const pragueToday = plainDateStringSchema.make("2026-09-02");

type Fixture = {
  /** The resolved standing, or the session read's failure. */
  standing: ResolvedStanding | CustomerAccountAccessError;
  activity: Effect.Effect<CustomerAccountActivityState, SqlError.SqlError>;
  list: Effect.Effect<readonly Invoice[], AccountingRecordUnavailable>;
  find: (
    invoiceId: string
  ) => Effect.Effect<Invoice | null, AccountingRecordUnavailable>;
  correctiveDocument: (
    invoiceId: InvoiceId
  ) => Effect.Effect<CorrectiveDocument | null, InvoiceCancellationError>;
};

let fixture: Fixture;
let events: string[];

beforeEach(() => {
  events = [];
  fixture = {
    standing: {
      ...testResolvedStandings.linked,
      account: { accountId, dotyposCustomerId },
    },
    activity: Effect.succeed({
      kind: "active",
      email: testEmailAddress("owner"),
      deletionRequestedAt: null,
    }),
    list: Effect.succeed([dueInvoice, paidInvoice]),
    find: (invoiceId) =>
      Effect.succeed(
        [dueInvoice, cancelledInvoice].find(({ id }) => id === invoiceId) ??
          null
      ),
    correctiveDocument: (invoiceId) =>
      Effect.succeed(
        invoiceId === cancelledInvoice.id ? correctiveDocument : null
      ),
  };
});

const serviceLayer = () =>
  CustomerInvoiceService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(CurrentCustomerAccount, {
          resolve: Effect.suspend(() => {
            events.push("resolve");
            const { standing } = fixture;
            return standing instanceof CustomerAccountAccessError
              ? Effect.fail(standing)
              : Effect.succeed(standing);
          }),
        }),
        Layer.mock(CustomerAccountLinkRepository, {
          findActivityState: (id) =>
            Effect.suspend(() => {
              events.push(`activity:${id}`);
              return fixture.activity;
            }),
        }),
        Layer.mock(InvoiceRepository, {
          listForCustomer: (customerId) =>
            Effect.suspend(() => {
              events.push(`list:${customerId}`);
              return fixture.list;
            }),
          findForCustomer: (customerId, invoiceId) =>
            Effect.suspend(() => {
              events.push(`find:${customerId}:${invoiceId}`);
              return fixture.find(invoiceId);
            }),
        }),
        Layer.mock(InvoiceCancellationRepository, {
          loadCorrectiveDocument: (invoiceId) =>
            Effect.suspend(() => {
              events.push(`corrective:${invoiceId}`);
              return fixture.correctiveDocument(invoiceId);
            }),
        })
      )
    )
  );

const provideService = <A, E>(
  operation: (service: CustomerInvoiceService["Service"]) => Effect.Effect<A, E>
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(now.epochMilliseconds);
    return yield* Effect.flatMap(CustomerInvoiceService, operation);
  }).pipe(Effect.provide(Layer.merge(serviceLayer(), TestClock.layer())));

const run = <A, E>(
  operation: (service: CustomerInvoiceService["Service"]) => Effect.Effect<A, E>
) => Effect.runPromise(provideService(operation));

const runFailure = <A, E>(
  operation: (service: CustomerInvoiceService["Service"]) => Effect.Effect<A, E>
) => Effect.runPromise(Effect.flip(provideService(operation)));

/** Each refused authority, and the refusal the unavailable error carries. */
const deniedAuthorities: readonly (readonly [
  string,
  Pick<Fixture, "standing"> | Pick<Fixture, "activity">,
  CustomerAccountAccessError,
])[] = [
  [
    "a signed-out session",
    { standing: testResolvedStandings["signed out"] },
    new CustomerAccountAccessError({ reason: "unauthenticated" }),
  ],
  [
    "an unverified email",
    { standing: testResolvedStandings.unverified },
    new CustomerAccountAccessError({ reason: "unverified-email" }),
  ],
  [
    "authentication that isn't configured",
    {
      standing: new CustomerAccountAccessError({ reason: "not-configured" }),
    },
    new CustomerAccountAccessError({ reason: "not-configured" }),
  ],
  [
    "an account without a Dotypos customer",
    { standing: testResolvedStandings["profile missing"] },
    new CustomerAccountAccessError({
      reason: "link-required",
      linkReason: "not-found",
    }),
  ],
  [
    "an account whose customers only support can link",
    { standing: testResolvedStandings["support required, ambiguous"] },
    new CustomerAccountAccessError({
      reason: "link-required",
      linkReason: "ambiguous",
    }),
  ],
  [
    "a review account",
    { standing: testResolvedStandings["review account"] },
    customerAccountUnavailable("account.review"),
  ],
  [
    "an account awaiting deletion",
    { standing: testResolvedStandings["awaiting deletion"] },
    new CustomerAccountAccessError({
      reason: "link-required",
      linkReason: "deletion-requested",
    }),
  ],
  [
    "an account with deletion pending",
    {
      activity: Effect.succeed({
        kind: "active",
        email: testEmailAddress("owner"),
        deletionRequestedAt: new Date("2026-09-01T10:00:00Z"),
      }),
    },
    new CustomerAccountAccessError({
      reason: "link-required",
      linkReason: "deletion-requested",
    }),
  ],
  [
    "an account whose login is gone",
    { activity: Effect.succeed({ kind: "missing" }) },
    new CustomerAccountAccessError({ reason: "unauthenticated" }),
  ],
];

describe("CustomerInvoiceService.list", () => {
  test("summarizes the account's own invoices on the Prague date", async () => {
    const summaries = await run((service) => service.list({ locale: "en-US" }));

    const paid = getCustomerInvoiceSummary(paidInvoice, pragueToday);
    expect(summaries).toEqual([
      getCustomerInvoiceSummary(dueInvoice, pragueToday),
      {
        ...paid,
        reservation: paid.reservation && {
          ...paid.reservation,
          productName: getWorkspaceProductTierTitle("open-space", "en-US"),
        },
      },
    ]);
    expect(summaries[0]?.paymentStatus).toBe("overdue");
    expect(events).toEqual([
      "resolve",
      `activity:${accountId}`,
      `list:${dotyposCustomerId}`,
    ]);
  });

  test("lists a cancelled invoice marked cancelled with its corrective document, also once it is hidden from the administration", async () => {
    fixture.list = Effect.succeed([dueInvoice, cancelledInvoice]);

    const [live, cancelled] = await run((service) =>
      service.list({ locale: "en-US" })
    );

    expect(live?.cancellation).toBeNull();
    expect(live && getCustomerInvoiceStatus(live)).toBe("overdue");
    expect(cancelled).toMatchObject({
      id: cancelledInvoice.id,
      invoiceNumber: cancelledInvoice.invoiceNumber,
      paymentStatus: "paid",
      cancellation: { correctiveDocumentNumber },
    });
    expect(cancelled && getCustomerInvoiceStatus(cancelled)).toBe("cancelled");
  });
  test.each(["en-US", "cs-CZ"] as const)(
    "says what each order-backed invoice was for, named by the %s catalog",
    async (locale) => {
      const orderInvoice = (
        suffix: string,
        document: Invoice["document"]
      ): Invoice => ({
        ...paidInvoice,
        id: invoiceIdSchema.make(`018f47d2-8f7c-7c5e-9f9a-6ef21f90cc${suffix}`),
        workspaceReservationId: `reservation-${suffix}`,
        invoiceNumber: document.invoiceNumber,
        document,
      });
      const office = makeOfficeInvoiceDocument(locale);
      fixture.list = Effect.succeed([
        orderInvoice("01", makeCoworkInvoiceDocument(locale)),
        orderInvoice("02", makeMeetingRoomInvoiceDocument(locale)),
        orderInvoice("03", office),
        dueInvoice,
      ]);

      const [cowork, meetingRoom, officeSummary, manual] = await run(
        (service) => service.list({ locale })
      );

      expect(cowork?.reservation).toMatchObject({
        product: { kind: "cowork", tier: "open-space" },
        productName: getWorkspaceProductTierTitle("open-space", locale),
        seats: null,
      });
      expect(meetingRoom?.reservation).toMatchObject({
        product: { kind: "meeting-room" },
        productName: getWorkspaceMeetingRoomProductTitle(locale),
        seats: null,
      });
      expect(officeSummary?.reservation).toMatchObject({
        product: { kind: "office" },
        productName: getWorkspaceOfficeProductTitle(locale),
        seats: "seats" in office.reservation ? office.reservation.seats : -1,
      });
      // A cowork day invoices the whole Prague day, whatever hours it opens.
      const coworkDay = Temporal.PlainDate.from(
        "date" in coworkDocument.reservation
          ? coworkDocument.reservation.date
          : ""
      );
      const pragueMidnight = (day: Temporal.PlainDate) =>
        day.toZonedDateTime({ timeZone: "Europe/Prague" }).toInstant();
      expect(
        Temporal.Instant.from(cowork?.reservation?.startsAt ?? "")
      ).toEqual(pragueMidnight(coworkDay));
      expect(Temporal.Instant.from(cowork?.reservation?.endsAt ?? "")).toEqual(
        pragueMidnight(coworkDay.add({ days: 1 }))
      );
      for (const summary of [meetingRoom, officeSummary]) {
        expect(summary?.reservation?.startsAt).toBeString();
        expect(summary?.reservation?.endsAt).toBeString();
      }
      expect(manual?.reservation).toBeNull();
      // The names come from the catalog alone: the list reads nothing else.
      expect(events).toEqual([
        "resolve",
        `activity:${accountId}`,
        `list:${dotyposCustomerId}`,
      ]);
    }
  );

  test("re-authorizes on every call", async () => {
    await run((service) =>
      Effect.andThen(
        service.list({ locale: "en-US" }),
        service.list({ locale: "en-US" })
      )
    );

    expect(events.filter((event) => event === "resolve")).toHaveLength(2);
    expect(
      events.filter((event) => event.startsWith("activity:"))
    ).toHaveLength(2);
  });

  test.each(deniedAuthorities)(
    "is unavailable to %s without reading invoices",
    async (_, denial, refusal) => {
      Object.assign(fixture, denial);

      const error = await runFailure((service) =>
        service.list({ locale: "en-US" })
      );

      expect(error).toEqual(
        new CustomerInvoicesUnavailableError({ account: refusal })
      );
      expect(events.some((event) => event.startsWith("list:"))).toBe(false);
    }
  );

  test("fails to load when the session can't be read", async () => {
    fixture.standing = testResolvedStandings["Dotypos lookup unavailable"];

    const error = await runFailure((service) =>
      service.list({ locale: "en-US" })
    );

    expect(error).toEqual(
      new CustomerInvoicesLoadError({ code: "account.authority" })
    );
    expect(events.some((event) => event.startsWith("list:"))).toBe(false);
  });

  test("fails to load when the account's activity can't be read", async () => {
    fixture.activity = Effect.fail(
      new SqlError.SqlError({
        reason: new SqlError.UnknownError({
          cause: new Error("synthetic connection refused"),
          message: "synthetic connection refused",
          operation: "query",
        }),
      })
    );

    const error = await runFailure((service) =>
      service.list({ locale: "en-US" })
    );

    expect(error).toEqual(
      new CustomerInvoicesLoadError({ code: "account.authority" })
    );
    expect(events.some((event) => event.startsWith("list:"))).toBe(false);
  });

  test("fails to load without the storage cause when invoices can't be read", async () => {
    fixture.list = Effect.fail(
      new AccountingRecordUnavailable({
        operation: "decrypt",
        reference: { type: "invoiceId", id: dueInvoice.id },
        message: "synthetic decryption failure",
      })
    );

    const error = await runFailure((service) =>
      service.list({ locale: "en-US" })
    );

    expect(error).toEqual(
      new CustomerInvoicesLoadError({ code: "invoice.read" })
    );
  });
});

describe("CustomerInvoiceService.pdf", () => {
  test("renders the account's own invoice named by its number", async () => {
    const file = await run((service) => service.pdf(dueInvoice.id));

    expect(file.fileName).toBe(`${dueInvoice.invoiceNumber}.pdf`);
    expect(new TextDecoder().decode(file.bytes.subarray(0, 5))).toBe("%PDF-");
    expect(events).toEqual([
      "resolve",
      `activity:${accountId}`,
      `find:${dotyposCustomerId}:${dueInvoice.id}`,
    ]);
  });

  test("is not found when the customer has no invoice with the id", async () => {
    const error = await runFailure((service) =>
      service.pdf("not-an-invoice-id")
    );

    expect(error).toEqual(new CustomerInvoiceNotFoundError());
  });

  test.each(deniedAuthorities)(
    "is unavailable to %s without reading the invoice",
    async (_, denial, refusal) => {
      Object.assign(fixture, denial);

      const error = await runFailure((service) => service.pdf(dueInvoice.id));

      expect(error).toEqual(
        new CustomerInvoicesUnavailableError({ account: refusal })
      );
      expect(events.some((event) => event.startsWith("find:"))).toBe(false);
    }
  );

  test("fails to load when the invoice can't be read", async () => {
    fixture.find = () =>
      Effect.fail(
        new AccountingRecordUnavailable({
          operation: "decrypt",
          reference: { type: "invoiceId", id: dueInvoice.id },
          message: "synthetic decryption failure",
        })
      );

    const error = await runFailure((service) => service.pdf(dueInvoice.id));

    expect(error).toEqual(
      new CustomerInvoicesLoadError({ code: "invoice.read" })
    );
  });
});

describe("CustomerInvoiceService.correctiveDocumentPdf", () => {
  test("renders the corrective document of the account's own cancelled invoice, named by its number", async () => {
    const file = await run((service) =>
      service.correctiveDocumentPdf(cancelledInvoice.id)
    );

    expect(file.fileName).toBe(`${correctiveDocumentNumber}.pdf`);
    expect(new TextDecoder().decode(file.bytes.subarray(0, 5))).toBe("%PDF-");
    expect(events).toEqual([
      "resolve",
      `activity:${accountId}`,
      `find:${dotyposCustomerId}:${cancelledInvoice.id}`,
      `corrective:${cancelledInvoice.id}`,
    ]);
  });

  test("is not found for an invoice that isn't cancelled, without loading a document", async () => {
    const error = await runFailure((service) =>
      service.correctiveDocumentPdf(dueInvoice.id)
    );

    expect(error).toEqual(new CustomerInvoiceNotFoundError());
    expect(events.some((event) => event.startsWith("corrective:"))).toBe(false);
  });

  test("is not found for another customer's invoice or an unknown id", async () => {
    fixture.find = () => Effect.succeed(null);

    for (const invoiceId of [cancelledInvoice.id, "not-an-invoice-id"]) {
      const error = await runFailure((service) =>
        service.correctiveDocumentPdf(invoiceId)
      );
      expect(error).toEqual(new CustomerInvoiceNotFoundError());
    }
    expect(events.some((event) => event.startsWith("corrective:"))).toBe(false);
  });

  test.each(deniedAuthorities)(
    "is unavailable to %s without reading the invoice",
    async (_, denial, refusal) => {
      Object.assign(fixture, denial);

      const error = await runFailure((service) =>
        service.correctiveDocumentPdf(cancelledInvoice.id)
      );

      expect(error).toEqual(
        new CustomerInvoicesUnavailableError({ account: refusal })
      );
      expect(events.some((event) => event.startsWith("find:"))).toBe(false);
    }
  );

  test("fails to load without the cause when the corrective document can't be read or is missing", async () => {
    for (const correctiveDocumentRead of [
      Effect.fail(
        new InvoiceCancellationError({
          code: "document_unavailable",
          invoiceId: cancelledInvoice.id,
          message: "synthetic decryption failure",
        })
      ),
      Effect.succeed(null),
    ]) {
      fixture.correctiveDocument = () => correctiveDocumentRead;

      const error = await runFailure((service) =>
        service.correctiveDocumentPdf(cancelledInvoice.id)
      );

      expect(error).toEqual(
        new CustomerInvoicesLoadError({ code: "corrective-document.read" })
      );
    }
  });
});

describe("CustomerInvoiceService.csv", () => {
  test("exports the account's invoices with headers in the locale", async () => {
    const csv = await run((service) => service.csv("cs-CZ"));

    expect(csv.filename).toBe(`invoices-${pragueToday}.csv`);
    expect(csv.rows).toEqual([
      getCustomerInvoiceSummary(dueInvoice, pragueToday),
      getCustomerInvoiceSummary(paidInvoice, pragueToday),
    ]);
    expect(csv.columns.length).toBeGreaterThan(0);
    expect(events).toEqual([
      "resolve",
      `activity:${accountId}`,
      `list:${dotyposCustomerId}`,
    ]);
  });

  test.each(deniedAuthorities)(
    "is unavailable to %s",
    async (_, denial, refusal) => {
      Object.assign(fixture, denial);

      const error = await runFailure((service) => service.csv("en-US"));

      expect(error).toEqual(
        new CustomerInvoicesUnavailableError({ account: refusal })
      );
    }
  );
});
