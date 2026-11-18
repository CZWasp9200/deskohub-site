import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Predicate } from "effect";
import { administrationHref } from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { mockAdministrationActionRequest } from "@/shared/testing/workspace-action-request.test-utils";

const revalidatedPaths: string[] = [];

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({
  cacheLife: () => undefined,
  cacheTag: () => undefined,
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));
const { access } = await mockAdministrationActionRequest({
  administrator: "invoice-administration-actions",
  referer: "https://deskohub.test/en-US/admin/invoices",
});
mock.module("@/features/i18n/server/revalidate-localized-path", () => ({
  revalidateLocalizedPath: (path: string) => {
    revalidatedPaths.push(path);
  },
}));

const { InvoiceAdministrationService } = await import(
  "./invoice-administration.service"
);
const { AdministrationService } = await import(
  "@/features/administration/administration.service"
);
const { InvoiceAdministrationNotFoundError } = await import(
  "./invoice-administration-identifier"
);
const { InvoiceCancellationError } = await import(
  "@/features/accounting/invoice-cancellation"
);
const { InvoiceArchiveError } = await import(
  "@/features/accounting/invoice-archive"
);
const { ReservationAdministrationError } = await import(
  "@/features/administration/reservation-administration.service"
);
const { getReservationCancellationErrorMessage } = await import(
  "@/features/administration/reservation-error-messages"
);
const { getInvoiceCancellationErrorMessage } = await import(
  "./invoice-display"
);

type Calls = Array<{ readonly method: string; readonly args: unknown[] }>;
type Fakes = Record<
  string,
  (...args: never[]) => Effect.Effect<unknown, unknown>
>;

const calls: Calls = [];
let invoices: Fakes = {};
let reservations: Fakes = {};

// Answers only the calls a test sets; any other call is a test failure.
const fakeLayer = <I, S>(
  tag: Parameters<typeof Layer.succeed<I, S>>[0],
  fakes: () => Fakes
) =>
  Layer.succeed(
    tag,
    new Proxy({} as S, {
      get: (_, method) => {
        if (!Predicate.isString(method)) return undefined;
        return (...args: unknown[]) => {
          calls.push({ method, args });
          const fake = fakes()[method];
          return fake
            ? (fake as (...args: unknown[]) => Effect.Effect<unknown, unknown>)(
                ...args
              )
            : Effect.die(`unexpected ${method}`);
        };
      },
    })
  );

const originalInvoicesLive = InvoiceAdministrationService.Live;
const originalAdministrationLive = AdministrationService.Live;
InvoiceAdministrationService.Live = fakeLayer(
  InvoiceAdministrationService,
  () => invoices
) as never;
AdministrationService.Live = fakeLayer(
  AdministrationService,
  () => reservations
) as never;

// Imported after the fakes, since the actions take the layers on load.
const {
  archiveAdministrationInvoice,
  cancelAdministrationInvoice,
  createAdministrationInvoice,
  previewAdministrationInvoice,
  previewAdministrationInvoiceCancellation,
  retryAdministrationInvoice,
} = await import("./actions");

afterAll(() => {
  InvoiceAdministrationService.Live = originalInvoicesLive;
  AdministrationService.Live = originalAdministrationLive;
});

beforeEach(() => {
  access.set("administrator");
  calls.length = 0;
  invoices = {};
  reservations = {};
  revalidatedPaths.length = 0;
});

const locale = "en-US" as const;
const invoiceId = "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21";
const reservationId = "01980000-0000-7000-8000-00000000abcd";

const invoicePaths = [
  administrationHref("/[locale]/admin/invoices"),
  administrationHref("/[locale]/admin/invoices/[invoiceId]", { invoiceId }),
];

const liveDetail = (
  plan: { customerNotice: "owed" | "not_owed"; reservation: string },
  reservation: string | null = reservationId
) => ({
  id: invoiceId,
  invoiceNumber: "2026000001",
  reservationId: reservation,
  cancellationPlan: plan,
});

const reservationDetail = {
  canCancel: true,
  reservation: {
    type: "cowork",
    date: "2026-09-30",
    startsAt: null,
    product: { kind: "cowork", tier: "open-space" },
  },
};

const cancellation = {
  cancelledAt: "2026-10-01T10:00:00Z",
  cause: "invoice_cancellation",
  source: "admin-ui",
  actor: testEmailAddress("invoice-cancelling-operator"),
  correctiveDocumentNumber: "WS-OD-2026-000001",
  correctiveDocumentIssuedAt: "2026-10-01T10:00:00Z",
  correctiveDocumentPdfUrl: "/admin/invoices/x/corrective-document",
  notices: {
    customer: "accepted",
    internal: "accepted",
    needsAttention: false,
  },
};

describe("previewAdministrationInvoiceCancellation", () => {
  test("reads the plan as the Admin UI sees it, with the reservation facts when it cancels the reservation", async () => {
    invoices = {
      get: () =>
        Effect.succeed(
          liveDetail({
            customerNotice: "owed",
            reservation: "cancels_reservation",
          })
        ),
    };
    reservations = { loadReservation: () => Effect.succeed(reservationDetail) };

    const result = await previewAdministrationInvoiceCancellation({
      invoiceId,
    });

    expect(calls.find((call) => call.method === "get")?.args).toEqual([
      invoiceId,
      { includeArchived: false },
    ]);
    expect(result.data).toMatchObject({
      state: "live",
      invoiceNumber: "2026000001",
      customerNotice: "owed",
      reservation: {
        reservationId,
      },
    });
  });

  test.each(["none", "already_cancelled", "cancellation_in_progress"])(
    "reads no reservation when the plan's reservation is %s",
    async (reservation) => {
      invoices = {
        get: () =>
          Effect.succeed(
            liveDetail({ customerNotice: "not_owed", reservation })
          ),
      };

      const result = await previewAdministrationInvoiceCancellation({
        invoiceId,
      });

      expect(result.data).toMatchObject({ state: "live", reservation: null });
      expect(calls.map((call) => call.method)).toEqual(["get"]);
    }
  );

  test("reports an invoice cancelled meanwhile", async () => {
    invoices = {
      get: () =>
        Effect.succeed({
          ...liveDetail({ customerNotice: "owed", reservation: "none" }),
          cancellationPlan: null,
        }),
    };

    const result = await previewAdministrationInvoiceCancellation({
      invoiceId,
    });

    expect(result.data).toEqual({ state: "cancelled" });
  });

  test("words a hidden or unknown invoice as not found", async () => {
    invoices = {
      get: () =>
        Effect.fail(new InvoiceAdministrationNotFoundError({ invoiceId })),
    };

    const result = await previewAdministrationInvoiceCancellation({
      invoiceId,
    });

    expect(result.serverError).toBe(
      m.accountingInvoiceNotFound({}, { locale })
    );
  });
});

describe("cancelAdministrationInvoice", () => {
  const cancelResult = (
    reservation: {
      readonly reservationId: string;
      readonly outcome: "cancelled";
      readonly email: "sent";
    } | null = null
  ) =>
    Effect.succeed({
      invoiceId,
      outcome: "cancelled",
      cancellation,
      reservation,
    });

  test("sends what the dialog confirmed as the verified administrator through the Admin UI", async () => {
    invoices = { cancel: () => cancelResult() };

    const result = await cancelAdministrationInvoice({
      invoiceId,
      confirmedCustomerNotice: true,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0]).toEqual({
      invoiceId,
      confirmedCustomerNotice: true,
      actor: { source: "admin-ui", administrator: access.administrator },
    });
    expect(result.data).toEqual({
      outcome: "cancelled",
      correctiveDocumentNumber: "WS-OD-2026-000001",
      reservationId: null,
      reservationEmail: null,
    });
    expect(revalidatedPaths).toEqual(invoicePaths);
  });

  test("passes the reservation confirmation and revalidates the reservation too", async () => {
    invoices = {
      cancel: () =>
        cancelResult({ reservationId, outcome: "cancelled", email: "sent" }),
    };
    const reservation = {
      sendCancellationEmail: false,
    };

    const result = await cancelAdministrationInvoice({
      invoiceId,
      confirmedCustomerNotice: false,
      reservation,
    });

    expect(calls[0]?.args[0]).toMatchObject({
      confirmedCustomerNotice: false,
      reservation,
    });
    expect(result.data).toMatchObject({
      reservationId,
      reservationEmail: "sent",
    });
    expect(revalidatedPaths).toEqual([
      ...invoicePaths,
      administrationHref("/[locale]/admin/reservations/[reservationId]", {
        reservationId,
      }),
    ]);
  });

  test("refuses unknown fields before calling the service", async () => {
    const result = await cancelAdministrationInvoice({
      invoiceId,
      confirmedCustomerNotice: true,
      force: true,
    } as never);

    expect(result.validationErrors).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  test.each([
    "reservation_confirmation_required",
    "confirmation_stale",
    "reservation_cancellation_in_progress",
    "document_unavailable",
    "persistence_failed",
    "not_found",
  ] as const)(
    "words the %s refusal in the operator's language",
    async (code) => {
      invoices = {
        cancel: () =>
          Effect.fail(
            new InvoiceCancellationError({
              code,
              invoiceId: null,
              message: "English",
            })
          ),
      };

      const result = await cancelAdministrationInvoice({
        invoiceId,
        confirmedCustomerNotice: false,
      });

      expect(result.serverError).toBe(
        getInvoiceCancellationErrorMessage(code, locale)
      );
    }
  );

  test("words a refused reservation cancellation with the reservation's reason", async () => {
    invoices = {
      cancel: () =>
        Effect.fail(
          new ReservationAdministrationError({
            code: "not_cancellable",
            reason: "confirmation_stale",
            message: "English",
          })
        ),
    };

    const result = await cancelAdministrationInvoice({
      invoiceId,
      confirmedCustomerNotice: false,
      reservation: {
        sendCancellationEmail: true,
      },
    });

    expect(result.serverError).toBe(
      getReservationCancellationErrorMessage("confirmation_stale", locale)
    );
  });

  test("rejects a caller who is no administrator before calling the service", async () => {
    access.set("signed-out");

    const result = await cancelAdministrationInvoice({
      invoiceId,
      confirmedCustomerNotice: false,
    });

    expect(result.serverError).toBeDefined();
    expect(calls).toHaveLength(0);
  });
});

describe("archiveAdministrationInvoice", () => {
  test("hides the invoice as the verified administrator and revalidates the list and detail", async () => {
    invoices = {
      archive: () =>
        Effect.succeed({
          invoiceId,
          archivedAt: "2026-10-02T10:00:00Z",
          changed: true,
        }),
    };

    const result = await archiveAdministrationInvoice({ invoiceId });

    expect(calls[0]?.args[0]).toEqual({
      invoiceId,
      actor: { source: "admin-ui", administrator: access.administrator },
    });
    expect(result.data).toMatchObject({ changed: true });
    expect(revalidatedPaths).toEqual(invoicePaths);
  });

  test("words a live invoice's refusal in the operator's language", async () => {
    invoices = {
      archive: () =>
        Effect.fail(
          new InvoiceArchiveError({
            code: "not_cancelled",
            invoiceId: invoiceId as never,
            message: "English",
          })
        ),
    };

    const result = await archiveAdministrationInvoice({ invoiceId });

    expect(result.serverError).toBe(
      m.accountingInvoiceHideErrorNotCancelled({}, { locale })
    );
  });
});

describe("retryAdministrationInvoice", () => {
  const retryResult = (reservation: string | null) =>
    Effect.succeed({
      invoiceId,
      changed: true,
      needsAttention: false,
      notices: null,
      reservationId: reservation,
    });

  test("revalidates a reservation invoice's reservation, whose cancellation shows the notice it now owes", async () => {
    invoices = { retry: () => retryResult(reservationId) };

    const result = await retryAdministrationInvoice({ invoiceId });

    expect(calls[0]?.args[0]).toBe(invoiceId);
    expect(result.data).toMatchObject({ changed: true });
    expect(revalidatedPaths).toEqual([
      ...invoicePaths,
      administrationHref("/[locale]/admin/reservations/[reservationId]", {
        reservationId,
      }),
    ]);
  });

  test("revalidates only the invoice pages of an invoice without a reservation", async () => {
    invoices = { retry: () => retryResult(null) };

    await retryAdministrationInvoice({ invoiceId });

    expect(revalidatedPaths).toEqual(invoicePaths);
  });
});

describe("Admin UI invoice creation provenance", () => {
  const invoiceInput = {
    invoiceId: "01980000-0000-7000-8000-000000000019",
    customer: {
      kind: "new" as const,
      details: {
        kind: "person" as const,
        email: testEmailAddress("admin-ui-invoice"),
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
    locale: "cs-CZ" as const,
    serviceDate: "2026-08-10",
    payment: { status: "due" as const, date: "2026-08-24" },
    currency: "CZK",
    lines: [{ description: "Space rental", price: "1000" }],
  };
  const provenanceOf = (method: string) =>
    calls.filter((call) => call.method === method).map(({ args }) => args[1]);

  test("records an invoice created in the Admin UI with the admin-ui source and the signed-in administrator", async () => {
    invoices = {
      create: () =>
        Effect.succeed({
          invoiceId: invoiceInput.invoiceId,
          invoiceNumber: "WS-FV-2026-000001",
          changed: true,
          needsAttention: false,
        }),
    };

    const result = await createAdministrationInvoice(invoiceInput);

    expect(result).toMatchObject({
      data: { invoiceId: invoiceInput.invoiceId },
    });
    expect(provenanceOf("create")).toEqual([
      { source: "admin-ui", administrator: access.administrator },
    ]);
  });

  test("previews an Admin UI invoice with the admin-ui source and the signed-in administrator", async () => {
    invoices = {
      preview: () => Effect.succeed(new Uint8Array([37, 80, 68, 70])),
    };

    const result = await previewAdministrationInvoice(invoiceInput);

    expect(result).toMatchObject({
      data: {
        dataUrl: expect.stringMatching(/^data:application\/pdf;base64,/),
      },
    });
    expect(provenanceOf("preview")).toEqual([
      { source: "admin-ui", administrator: access.administrator },
    ]);
  });
});
