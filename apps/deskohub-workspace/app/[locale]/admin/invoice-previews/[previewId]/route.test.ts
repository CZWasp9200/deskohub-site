import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option, Predicate } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { mockAdministratorAccess } from "@/features/administrators/server/administrator-access.test-utils";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";

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

const { InvoicePreviews } = await import(
  "@/features/accounting/admin/invoice-previews.service"
);

const keptPreviewId = "01980000-0000-7000-8000-0000000000d1";
const expiredPreviewId = "01980000-0000-7000-8000-0000000000d2";
const bytes = Uint8Array.from([37, 80, 68, 70]);
const opens: {
  readonly id: string;
  readonly administratorAccountId: string;
}[] = [];

// Answers like the service: a preview opens only for the administrator it was
// kept for, and an expired one opens for nobody.
InvoicePreviews.Live = Layer.mock(InvoicePreviews)({
  open: (input) =>
    Effect.sync(() => {
      opens.push(input);
      return input.id === keptPreviewId &&
        input.administratorAccountId === access.administrator.accountId
        ? Option.some({ bytes, fileName: "WS-FA-2026-000001-preview.pdf" })
        : Option.none();
    }) as never,
});

const { GET } = await import("./route");

const download = (previewId: string) =>
  GET(
    new Request(
      `https://deskohub.test/en-US/admin/invoice-previews/${previewId}`
    ),
    { params: Promise.resolve({ previewId }) }
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
  access.reset();
  opens.length = 0;
});

describe("GET /admin/invoice-previews/[previewId]", () => {
  test("serves a kept preview privately to the administrator it was kept for", async () => {
    const response = await download(keptPreviewId);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Disposition")).toBe(
      'inline; filename="WS-FA-2026-000001-preview.pdf"'
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(opens).toEqual([
      {
        id: keptPreviewId,
        administratorAccountId: access.administrator.accountId,
      },
    ]);
  });

  test("answers the admin 404 to another administrator", async () => {
    const other = {
      accountId: customerAccountIdSchema.make(crypto.randomUUID()),
      email: reservationCustomerEmailSchema.make(
        testEmailAddress("other-administrator")
      ),
    };
    access.actAs(other);

    expect(await rejection(download(keptPreviewId))).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404"
    );
    expect(opens).toEqual([
      { id: keptPreviewId, administratorAccountId: other.accountId },
    ]);
  });

  test("answers the admin 404 for an expired preview", async () => {
    expect(await rejection(download(expiredPreviewId))).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404"
    );
  });

  test("answers the admin 404 for an id that names no preview, without a lookup", async () => {
    expect(await rejection(download("not-a-preview"))).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404"
    );
    expect(opens).toEqual([]);
  });

  test("answers the admin 404 to an account without the administrator grant", async () => {
    access.set("not-administrator");

    expect(await rejection(download(keptPreviewId))).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404"
    );
    expect(opens).toEqual([]);
  });
});
