import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Context, Effect, Layer } from "effect";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { mockAdministrationActionRequest } from "@/shared/testing/workspace-action-request.test-utils";

interface RecordedProvenance {
  readonly source: string;
  readonly administrator: AdministratorAccountActor;
}

const { access } = await mockAdministrationActionRequest({
  administrator: "fixture-operator",
});

const nextCacheModule = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCacheModule,
  revalidatePath: () => undefined,
}));

const creations: RecordedProvenance[] = [];
const previews: RecordedProvenance[] = [];

class StubInvoiceAdministrationService extends Context.Service<
  StubInvoiceAdministrationService,
  {
    readonly create: (
      input: { readonly invoiceId: string },
      provenance: RecordedProvenance
    ) => Effect.Effect<unknown>;
    readonly preview: (
      input: { readonly invoiceId: string },
      provenance: RecordedProvenance
    ) => Effect.Effect<Uint8Array>;
  }
>()("@test/InvoiceAdministrationService") {}

mock.module("./invoice-administration.service", () => ({
  InvoiceAdministrationService: Object.assign(
    StubInvoiceAdministrationService,
    {
      Live: Layer.succeed(
        StubInvoiceAdministrationService,
        StubInvoiceAdministrationService.of({
          create: (input, provenance) =>
            Effect.sync(() => creations.push(provenance)).pipe(
              Effect.as({
                invoiceId: input.invoiceId,
                invoiceNumber: "WS-FV-2026-000001",
                changed: true,
                needsAttention: false,
              })
            ),
          preview: (_, provenance) =>
            Effect.sync(() => previews.push(provenance)).pipe(
              Effect.as(new Uint8Array([37, 80, 68, 70]))
            ),
        })
      ),
    }
  ),
}));

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

describe("Admin UI invoice actions", () => {
  beforeEach(() => {
    access.set("administrator");
    creations.length = 0;
    previews.length = 0;
  });

  test("records an invoice created in the Admin UI with the admin-ui source and the signed-in administrator", async () => {
    const { createAdministrationInvoice } = await import("./actions");

    const result = await createAdministrationInvoice(invoiceInput);

    expect(result).toMatchObject({
      data: { invoiceId: invoiceInput.invoiceId },
    });
    expect(creations).toEqual([
      { source: "admin-ui", administrator: access.administrator },
    ]);
  });

  test("previews an Admin UI invoice with the admin-ui source and the signed-in administrator", async () => {
    const { previewAdministrationInvoice } = await import("./actions");

    const result = await previewAdministrationInvoice(invoiceInput);

    expect(result).toMatchObject({
      data: {
        dataUrl: expect.stringMatching(/^data:application\/pdf;base64,/),
      },
    });
    expect(previews).toEqual([
      { source: "admin-ui", administrator: access.administrator },
    ]);
  });
});
