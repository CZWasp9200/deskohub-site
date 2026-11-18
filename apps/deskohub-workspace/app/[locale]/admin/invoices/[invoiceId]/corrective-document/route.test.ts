import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Predicate } from "effect";
import { mockAdministratorAccess } from "@/features/administrators/server/administrator-access.test-utils";

const access = mockAdministratorAccess();

// The page gate reads the request outside a Next request scope here.
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
const nextServer = await import("next/server");
mock.module("next/server", () => ({
  ...nextServer,
  after: () => {},
  connection: () => Promise.resolve(),
}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

const { InvoiceAdministrationService } = await import(
  "@/features/accounting/admin/invoice-administration.service"
);
const { InvoiceAdministrationNotFoundError } = await import(
  "@/features/accounting/admin/invoice-administration-identifier"
);

const cancelledInvoiceId = "01980000-0000-7000-8000-0000000000c1";
const hiddenInvoiceId = "01980000-0000-7000-8000-0000000000c2";
const liveInvoiceId = "01980000-0000-7000-8000-0000000000c3";
const bytes = Uint8Array.from([37, 80, 68, 70]);
const scopes: unknown[] = [];

// Answers like the service: a live invoice has no credit note, and a hidden
// one is found only when the read scope includes hidden invoices.
InvoiceAdministrationService.Live = Layer.mock(InvoiceAdministrationService)({
  getCorrectiveDocumentPdf: (invoiceId, scope) =>
    Effect.suspend(() => {
      scopes.push(scope);
      const found =
        invoiceId === cancelledInvoiceId ||
        (invoiceId === hiddenInvoiceId && scope.includeArchived);
      return found
        ? Effect.succeed({ bytes, fileName: "WS-OD-2026-000001.pdf" as const })
        : Effect.fail(new InvoiceAdministrationNotFoundError({ invoiceId }));
    }) as never,
});

const { GET } = await import("./route");

const download = (invoiceId: string) =>
  GET(
    new Request(
      `https://deskohub.test/en-US/admin/invoices/${invoiceId}/corrective-document`
    ),
    { params: Promise.resolve({ invoiceId }) }
  );

/** The digest of the signal Next's `notFound()` throws. */
const rejection = async (response: Promise<Response>) => {
  const signal = await response.then(
    () => null,
    (cause: unknown) => cause
  );
  return Predicate.hasProperty(signal, "digest") ? signal.digest : signal;
};

beforeEach(() => {
  access.set("administrator");
  scopes.length = 0;
});

describe("GET /admin/invoices/[invoiceId]/corrective-document", () => {
  test("serves a cancelled invoice's credit note privately, read as the Admin UI sees invoices", async () => {
    const response = await download(cancelledInvoiceId);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toBe(
      'inline; filename="WS-OD-2026-000001.pdf"'
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(scopes).toEqual([{ includeArchived: false }]);
  });

  test.each([
    ["a hidden invoice", hiddenInvoiceId],
    ["an invoice that is not cancelled", liveInvoiceId],
  ])("answers the admin 404 for %s", async (_case, invoiceId) => {
    expect(await rejection(download(invoiceId))).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404"
    );
  });

  test("answers the admin 404 to an account without the administrator grant", async () => {
    access.set("not-administrator");

    expect(await rejection(download(cancelledInvoiceId))).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404"
    );
    expect(scopes).toEqual([]);
  });
});
