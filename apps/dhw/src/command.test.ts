import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationActorEmail,
  AdministrationCustomerReservationActivity,
  AdministrationDiscountCodeId,
  AdministrationDiscountGroupList,
  AdministrationDotyposCustomerId,
  AdministrationInvoiceCreateInput,
  AdministrationInvoiceCreationDefaults,
  AdministrationInvoiceId,
  AdministrationLegacyUsername,
  AdministrationOverview,
  AdministrationReservationActivity,
  type AdministrationReservationDetailType,
  type AdministrationReservationRestorationResultType,
  AdministrationStandaloneAccessCodeAttemptId,
  type AdministrationStandaloneAccessCodeAttemptIdType,
  type AdministrationStandaloneAccessCodeCreateInputType,
  AdministrationStandaloneAccessCodeCreationOutcome,
  type AdministrationStandaloneAccessCodeCreationOutcomeType,
  AdministrationStandaloneAccessCodeName,
  AdministrationVoucherId,
  AdministrationWorkspaceReservationId,
  CliAccessToken,
  type CliAccessTokenType,
  CliMutationRejected,
  CliMutationUncertain,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliSessionId,
  type CliSessionType,
  CliStandaloneAccessCodeCleanupRequired,
  CliStandaloneAccessCodeReconciled,
  toAdministrationActorName,
} from "@deskohub/workspace-admin-api";
import { BunServices } from "@effect/platform-bun";
import { Console, Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { AccessCodeAttemptStore } from "./access-codes/access-code-attempt-store.service";
import { WorkspaceAdminApiClient } from "./api/workspace-admin-api-client.service";
import { AuthenticationService } from "./authentication/authentication.service";
import { dhwCommand } from "./command";
import { DhwConfig } from "./config/dhw-config.service";

const syntheticEmail = testEmailAddress("synthetic");

const previewInvoiceInput = Schema.decodeUnknownSync(
  AdministrationInvoiceCreateInput
)({
  invoiceId: "01980000-0000-7000-8000-000000000019",
  customer: {
    kind: "new",
    details: {
      kind: "person",
      email: syntheticEmail,
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
  serviceDate: "2026-08-10",
  payment: { status: "due", date: "2026-08-24" },
  currency: "CZK",
  lines: [{ description: "Synthetic service", price: "1000" }],
});

const accessToken = Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43));
const sessionId = Schema.decodeUnknownSync(CliSessionId)(
  "01980000-0000-7000-8000-000000000000"
);
const codeId = Schema.decodeUnknownSync(AdministrationDiscountCodeId)(
  "01980000-0000-7000-8000-000000000001"
);
const voucherId = Schema.decodeUnknownSync(AdministrationVoucherId)(
  "01980000-0000-7000-8000-000000000002"
);
const reservationId = Schema.decodeUnknownSync(
  AdministrationWorkspaceReservationId
)("reservation-test");
const cleanupTargetAttemptId = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeAttemptId
)("01980000-0000-7000-8000-000000000043");
const cleanupTarget = {
  attemptId: cleanupTargetAttemptId,
  name: Schema.decodeUnknownSync(AdministrationStandaloneAccessCodeName)(
    "Booth A"
  ),
};
const session = {
  id: sessionId,
  approvedBy: null,
  approvedByEmail: null,
  clientName: "test client",
  cliVersion: "1.3.0",
  buildTarget: "development" as const,
  createdAt: "2026-08-10T10:00:00.000Z",
  lastUsedAt: "2026-08-10T10:00:00.000Z",
  expiresAt: null,
};
const accountApproverEmail = AdministrationActorEmail.make(
  testEmailAddress("admin")
);
const accountApprover = {
  approvedBy: toAdministrationActorName(accountApproverEmail),
  approvedByEmail: accountApproverEmail,
};
const createdAccessCodeOutcome = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeCreationOutcome
)({
  outcome: "created",
  attemptId: "01980000-0000-7000-8000-000000000042",
  providerCredentialId: "pin-1",
  name: "Booth A",
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
  issuedAt: "2026-09-10T08:00:00Z",
  pin: "7654321",
}) satisfies AdministrationStandaloneAccessCodeCreationOutcomeType;
const alreadyCreatedAccessCodeOutcome = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeCreationOutcome
)({
  outcome: "already-created",
  attemptId: "01980000-0000-7000-8000-000000000042",
  providerCredentialId: "pin-1",
  name: "Booth A",
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
  issuedAt: "2026-09-10T08:00:00Z",
}) satisfies AdministrationStandaloneAccessCodeCreationOutcomeType;

describe("dhw mutation commands", () => {
  test("requires reauthentication before a legacy session can create invoices", async () => {
    const { layer } = makeCommandLayer();

    const error = await runCommand(
      ["--json", "invoices", "create", "--input", "invoice.json", "--yes"],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({
      _tag: "AuthenticationRequiredError",
      message: expect.stringContaining("dhw auth"),
    });
  });

  test("reuses the invoice id from the input file across create retries", async () => {
    const invoiceId = "01980000-0000-7000-8000-000000000009";
    const inputPath = `/tmp/dhw-invoice-${crypto.randomUUID()}.json`;
    const creations: unknown[] = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createInvoice: (_accessToken, input) =>
        Effect.sync(() => {
          creations.push(input);
          return {
            invoiceId: input.invoiceId,
            invoiceNumber: "WS-FV-2026-000001",
            changed: true,
            needsAttention: false,
          };
        }),
    });
    await Bun.write(
      inputPath,
      JSON.stringify({
        invoiceId,
        customer: {
          kind: "new",
          details: {
            kind: "person",
            email: syntheticEmail,
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
        serviceDate: "2026-08-10",
        payment: { status: "due", date: "2026-08-24" },
        currency: "CZK",
        lines: [{ description: "Space rental", price: "1000" }],
      })
    );

    try {
      const args = [
        "--json",
        "invoices",
        "create",
        "--input",
        inputPath,
        "--yes",
      ];
      await runCommand(args, layer).pipe(Effect.runPromise);
      await runCommand(args, layer).pipe(Effect.runPromise);
    } finally {
      await Bun.file(inputPath).delete();
    }

    expect(creations).toHaveLength(2);
    expect(creations).toEqual([
      expect.objectContaining({ invoiceId }),
      expect.objectContaining({ invoiceId }),
    ]);
  });

  test("previews an invoice from a strict input file and writes the PDF", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dhw-command-invoice-"));
    const inputPath = join(directory, "invoice.json");
    const outputPath = join(directory, "preview.pdf");
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const previews: unknown[] = [];
    const { layer, output } = makeCommandLayer({
      previewInvoice: (_accessToken, input) =>
        Effect.sync(() => {
          previews.push(input);
          return pdf;
        }),
    });
    await writeFile(inputPath, JSON.stringify(previewInvoiceInput));

    try {
      await runCommand(
        [
          "--json",
          "invoices",
          "preview",
          "--input",
          inputPath,
          "--output",
          outputPath,
        ],
        layer
      ).pipe(Effect.runPromise);

      expect(previews).toEqual([previewInvoiceInput]);
      expect(await readFile(outputPath)).toEqual(Buffer.from(pdf));
      expect(JSON.parse(output.join(""))).toEqual({
        invoiceId: previewInvoiceInput.invoiceId,
        path: outputPath,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects invoice preview input with an unknown property before the API call", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dhw-command-invoice-"));
    const inputPath = join(directory, "invoice.json");
    const previews: unknown[] = [];
    const { layer } = makeCommandLayer({
      previewInvoice: (_accessToken, input) =>
        Effect.sync(() => {
          previews.push(input);
          return new Uint8Array();
        }),
    });
    await writeFile(
      inputPath,
      JSON.stringify({ ...previewInvoiceInput, unknownProperty: true })
    );

    try {
      const error = await runCommand(
        ["--json", "invoices", "preview", "--input", inputPath],
        layer
      ).pipe(Effect.flip, Effect.runPromise);

      expect(error).toMatchObject({ _tag: "InvalidMutationInputError" });
      expect(previews).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("prints invoice creation defaults as JSON", async () => {
    const defaults = Schema.decodeUnknownSync(
      AdministrationInvoiceCreationDefaults
    )({
      currencies: [{ code: "CZK", exponent: 2, name: "Czech koruna" }],
      defaultCurrency: "CZK",
      defaultServiceDate: "2026-08-10",
      defaultDueDate: "2026-08-24",
      suggestedVariableSymbol: "260810",
    });
    const { layer, output } = makeCommandLayer({
      getInvoiceCreationDefaults: () => Effect.succeed(defaults),
    });

    await runCommand(["--json", "invoices", "defaults"], layer).pipe(
      Effect.runPromise
    );

    expect(JSON.parse(output.join(""))).toEqual(defaults);
  });

  test("passes a decoded customer ID to the activity command and prints its JSON", async () => {
    const customerId = "customer-1";
    const decodedCustomerId = Schema.decodeUnknownSync(
      AdministrationDotyposCustomerId
    )(customerId);
    const activity = Schema.decodeUnknownSync(
      AdministrationCustomerReservationActivity
    )({
      from: "2026-08-01",
      to: "2026-08-02",
      dates: [{ date: "2026-08-01", count: 2, category: "meeting-room" }],
    });
    const requestedCustomerIds: AdministrationDotyposCustomerId[] = [];
    const { layer, output } = makeCommandLayer({
      getCustomerReservationActivity: (_accessToken, decodedCustomerId) =>
        Effect.sync(() => {
          requestedCustomerIds.push(decodedCustomerId);
          return activity;
        }),
    });

    await runCommand(
      ["--json", "customers", "activity", customerId],
      layer
    ).pipe(Effect.runPromise);

    expect(requestedCustomerIds).toEqual([decodedCustomerId]);
    expect(JSON.parse(output.join(""))).toEqual(activity);
  });

  test("prints global reservation activity as JSON", async () => {
    const activity = Schema.decodeUnknownSync(
      AdministrationReservationActivity
    )({
      from: "2026-08-01",
      to: "2026-08-02",
      dates: [{ date: "2026-08-01", count: 2 }],
    });
    const { layer, output } = makeCommandLayer({
      getReservationActivity: () => Effect.succeed(activity),
    });

    await runCommand(["--json", "reservations", "activity"], layer).pipe(
      Effect.runPromise
    );

    expect(JSON.parse(output.join(""))).toEqual(activity);
  });

  test("prints unavailable global reservation activity for people", async () => {
    const activity = Schema.decodeUnknownSync(
      AdministrationReservationActivity
    )({
      from: "2026-08-01",
      to: "2026-08-02",
      dates: null,
    });
    const { layer, output } = makeCommandLayer({
      getReservationActivity: () => Effect.succeed(activity),
    });

    await runCommand(["reservations", "activity"], layer).pipe(
      Effect.runPromise
    );

    expect(output.join("")).toBe(
      "Reservation activity 2026-08-01 to 2026-08-02: unavailable"
    );
  });

  test("includes refund attention in overview JSON", async () => {
    const overview = Schema.decodeUnknownSync(AdministrationOverview)({
      today: { completed: 1, unavailable: false, value: 2 },
      upcoming: { completed: 3, unavailable: false, value: 4 },
      lastSevenDays: { completed: 5, unavailable: false, value: 6 },
      uniqueCustomers: {
        customers: [],
        unavailable: false,
        value: 7,
      },
      newCustomers: {
        customers: [],
        unavailable: false,
        value: 8,
      },
      refundAttention: { unavailable: false, value: 9 },
    });
    const { layer, output } = makeCommandLayer({
      getOverview: () => Effect.succeed(overview),
    });

    await runCommand(["--json", "overview"], layer).pipe(Effect.runPromise);

    expect(JSON.parse(output.join("")).refundAttention).toEqual(
      overview.refundAttention
    );
  });

  test("requires explicit confirmation for non-interactive revocation", async () => {
    let revocations = 0;
    const { layer } = makeCommandLayer({
      revokeSession: () =>
        Effect.sync(() => {
          revocations += 1;
          return { changed: true };
        }),
    });

    const error = await runCommand(
      ["--json", "sessions", "revoke", sessionId],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({ _tag: "ConfirmationRequiredError" });
    expect(revocations).toBe(0);
  });

  test("confirms reservation cancellation and forwards the email choice", async () => {
    const cancellations: unknown[] = [];
    const { layer } = makeCommandLayer({
      cancelReservation: (_accessToken, id, input) =>
        Effect.sync(() => {
          cancellations.push({ id, input });
          return {
            outcome: "cancelled",
            email: "sent",
            invoice: null,
          } as const;
        }),
    });

    await runCommand(
      [
        "--json",
        "reservations",
        "cancel",
        reservationId,
        "--force",
        "--send-cancellation-email",
        "--yes",
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(cancellations).toEqual([
      {
        id: reservationId,
        input: {
          confirmedConsequences: { invoice: false, customerNotice: false },
          force: true,
          sendCancellationEmail: true,
        },
      },
    ]);
  });

  test("confirms a reservation cancellation's invoice consequence as it read it", async () => {
    const cancellations: unknown[] = [];
    const invoices = [
      { state: "live", customerNotice: "owed" },
      { state: "live", customerNotice: "not_owed" },
      { state: "cancelled", customerNotice: "owed" },
    ] as const;
    let read = 0;
    const { layer } = makeCommandLayer({
      getReservation: () =>
        Effect.succeed({
          accessGrant: null,
          invoice: {
            id: "01980000-0000-7000-8000-0000000000b1",
            invoiceNumber: "WS-FV-2026-000001",
            archived: false,
            ...invoices[read++],
          },
        } as never),
      cancelReservation: (_accessToken, _id, input) =>
        Effect.sync(() => {
          cancellations.push(input.confirmedConsequences);
          return {
            outcome: "cancelled",
            email: "not_requested",
            invoice: null,
          } as const;
        }),
    });

    for (const _ of invoices) {
      await runCommand(
        ["--json", "reservations", "cancel", reservationId, "--yes"],
        layer
      ).pipe(Effect.runPromise);
    }

    expect(cancellations).toEqual([
      { invoice: true, customerNotice: true },
      { invoice: true, customerNotice: false },
      { invoice: false, customerNotice: false },
    ]);
  });

  test("restores a reservation with the refund acknowledgement and email choice", async () => {
    const restorations: unknown[] = [];
    const result = {
      outcome: "restored",
      email: "sent",
      access: "issued",
    } as const;
    const { layer, output } = makeCommandLayer({
      restoreReservation: (_accessToken, id, input) =>
        Effect.sync(() => {
          restorations.push({ id, input });
          return result;
        }),
    });

    await runCommand(
      [
        "--json",
        "reservations",
        "restore",
        reservationId,
        "--acknowledge-refunded-payment",
        "--send-restoration-email",
        "--yes",
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(restorations).toEqual([
      {
        id: reservationId,
        input: { acknowledgeRefundedPayment: true, sendRestorationEmail: true },
      },
    ]);
    expect(JSON.parse(output.join(""))).toEqual(result);
  });

  test("restores without acknowledging a refund or emailing unless asked", async () => {
    const restorations: unknown[] = [];
    const { layer } = makeCommandLayer({
      restoreReservation: (_accessToken, _id, input) =>
        Effect.sync(() => {
          restorations.push(input);
          return {
            outcome: "restored",
            email: "not_requested",
            access: "not_needed",
          } as const;
        }),
    });

    await runCommand(
      ["--json", "reservations", "restore", reservationId, "--yes"],
      layer
    ).pipe(Effect.runPromise);

    expect(restorations).toEqual([
      { acknowledgeRefundedPayment: false, sendRestorationEmail: false },
    ]);
  });

  test("requires explicit confirmation for non-interactive restoration", async () => {
    let restorations = 0;
    const { layer } = makeCommandLayer({
      restoreReservation: () =>
        Effect.sync(() => {
          restorations += 1;
          return {
            outcome: "restored",
            email: "not_requested",
            access: "not_needed",
          } as const;
        }),
    });

    const error = await runCommand(
      ["--json", "reservations", "restore", reservationId],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({ _tag: "ConfirmationRequiredError" });
    expect(restorations).toBe(0);
  });

  test("fails a refund refusal with the server's message, which names the refunded amount", async () => {
    const refusal = new CliMutationRejected({
      message: "Synthetic refund refusal naming 250.00 CZK",
    });
    const { layer, output } = makeCommandLayer({
      restoreReservation: () => Effect.fail(refusal),
    });

    const error = await runCommand(
      ["reservations", "restore", reservationId, "--yes"],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toBeInstanceOf(CliMutationRejected);
    expect(error).toMatchObject({ message: refusal.message });
    expect(output).toEqual([]);
  });

  test("reports each restore result field on one line and names the reservation when access failed", async () => {
    const reportLine = async (
      result: AdministrationReservationRestorationResultType
    ) => {
      const { layer, output } = makeCommandLayer({
        restoreReservation: () => Effect.succeed(result),
      });
      await runCommand(
        ["reservations", "restore", reservationId, "--yes"],
        layer
      ).pipe(Effect.runPromise);
      expect(output).toHaveLength(1);
      return output[0] ?? "";
    };
    const base = {
      outcome: "restored",
      email: "not_requested",
      access: "not_needed",
    } as const;
    const variations = {
      outcome: ["restored", "already_confirmed"],
      email: ["not_requested", "sent", "failed", "not_available"],
      access: ["issued", "failed", "not_needed"],
    } as const;

    for (const [field, values] of Object.entries(variations)) {
      const lines = [];
      for (const value of values) {
        lines.push(await reportLine({ ...base, [field]: value }));
      }
      // Each value of one field reads differently with the others fixed.
      expect(new Set(lines).size).toBe(values.length);
    }
    expect(await reportLine({ ...base, access: "failed" })).toContain(
      reservationId
    );
  });

  test("shows who booked a reservation for someone else", async () => {
    const output: string[] = [];
    const capturedOutput = Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => {
        output.push(args.join(" "));
      },
    } satisfies Console.Console);
    const detail = (author: AdministrationReservationDetailType["author"]) =>
      ({
        author,
        accessGrant: null,
        discounts: [],
        orders: [],
        paymentAttempts: [],
        reservation: {
          id: reservationId,
          customerId: "booked-for-customer",
          customer: null,
          date: "2026-08-10",
          startsAt: null,
          typeLabel: "Cowork",
          status: { label: "Held" },
        },
      }) as unknown as AdministrationReservationDetailType;

    for (const author of [
      {
        kind: "account" as const,
        customerId: null,
        displayName: "Ada Author",
        email: testEmailAddress("ada-author"),
      },
      {
        kind: "account" as const,
        customerId: null,
        displayName: "Inactive Author",
        email: "",
      },
      { kind: "deleted" as const },
      { kind: "unavailable" as const },
      null,
    ]) {
      const { layer } = makeCommandLayer({
        getReservation: () => Effect.succeed(detail(author)),
      });
      await runCommand(
        ["reservations", "get", reservationId],
        Layer.mergeAll(layer, capturedOutput)
      ).pipe(Effect.runPromise);
    }

    const authorLines = output.filter((line) => line.startsWith("Booked by"));
    expect(authorLines).toHaveLength(4);
    const [withEmail, withoutEmail, ...others] = authorLines;
    expect(withEmail).toContain(`<${testEmailAddress("ada-author")}>`);
    expect(withoutEmail).toEndWith("Inactive Author");
    expect(withoutEmail).not.toContain("<");
    expect(others).toEqual([
      "Booked by: deleted account",
      "Booked by: unavailable",
    ]);
  });

  test("shows when an early-setup meeting room is held from", async () => {
    const output: string[] = [];
    const capturedOutput = Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => {
        output.push(args.join(" "));
      },
    } satisfies Console.Console);
    const detail = (setupStartsAt: string | null) =>
      ({
        author: null,
        accessGrant: null,
        discounts: [],
        orders: [],
        paymentAttempts: [],
        reservation: {
          id: reservationId,
          customerId: "meeting-room-customer",
          customer: null,
          date: "2026-08-10",
          startsAt: "2026-08-10T08:00:00Z",
          endsAt: "2026-08-10T09:00:00Z",
          setupStartsAt,
          typeLabel: "Meeting Room",
          status: { label: "Paid" },
        },
      }) as unknown as AdministrationReservationDetailType;

    for (const setupStartsAt of ["2026-08-10T07:45:00Z", null]) {
      const { layer } = makeCommandLayer({
        getReservation: () => Effect.succeed(detail(setupStartsAt)),
      });
      await runCommand(
        ["reservations", "get", reservationId],
        Layer.mergeAll(layer, capturedOutput)
      ).pipe(Effect.runPromise);
    }

    expect(output.filter((line) => line.startsWith("Early setup"))).toEqual([
      "Early setup: from 2026-08-10T07:45:00Z, booked 2026-08-10T08:00:00Z to 2026-08-10T09:00:00Z",
    ]);
  });

  test("dry-runs the product-details backfill across every batch without confirmation", async () => {
    const requests: unknown[] = [];
    const nextReservationId = Schema.decodeUnknownSync(
      AdministrationWorkspaceReservationId
    )("reservation-next");
    const { layer } = makeCommandLayer({
      backfillReservationProductDetails: (_accessToken, input) =>
        Effect.sync(() => {
          requests.push(input);
          return input.after === null
            ? {
                updated: 2,
                alreadyComplete: 1,
                unresolved: [
                  {
                    reservationId,
                    family: "office" as const,
                    reason: "dotypos_seats_invalid" as const,
                  },
                ],
                nextCursor: nextReservationId,
              }
            : {
                updated: 1,
                alreadyComplete: 3,
                unresolved: [],
                nextCursor: null,
              };
        }),
    });
    const output: string[] = [];
    const capturedOutput = Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => {
        output.push(args.join(" "));
      },
    } satisfies Console.Console);

    await runCommand(
      ["--json", "reservations", "backfill-product-details", "--dry-run"],
      Layer.mergeAll(layer, capturedOutput)
    ).pipe(Effect.runPromise);

    expect(requests).toEqual([
      { dryRun: true, after: null },
      { dryRun: true, after: nextReservationId },
    ]);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      {
        dryRun: true,
        updated: 3,
        alreadyComplete: 4,
        unresolved: [
          {
            reservationId,
            family: "office",
            reason: "dotypos_seats_invalid",
          },
        ],
      },
    ]);
  });

  test("requires confirmation before the product-details backfill writes", async () => {
    const requests: unknown[] = [];
    const { layer } = makeCommandLayer({
      backfillReservationProductDetails: (_accessToken, input) =>
        Effect.sync(() => {
          requests.push(input);
          return {
            updated: 0,
            alreadyComplete: 0,
            unresolved: [],
            nextCursor: null,
          };
        }),
    });

    const error = await runCommand(
      ["--json", "reservations", "backfill-product-details"],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    expect(error).toMatchObject({ _tag: "ConfirmationRequiredError" });
    expect(requests).toEqual([]);

    await runCommand(
      ["--json", "reservations", "backfill-product-details", "--yes"],
      layer
    ).pipe(Effect.runPromise);
    expect(requests).toEqual([{ dryRun: false, after: null }]);
  });

  test("dry-runs a legacy administrator backfill and prints its JSON result", async () => {
    const legacyUsername = AdministrationLegacyUsername.make("legacy-admin");
    const email = testEmailAddress("legacy-admin");
    const requests: unknown[] = [];
    const result = {
      dryRun: true,
      administratorRole: "granted" as const,
      cliSessions: { linked: 2, alreadyLinked: 1, linkedToOtherAccount: 3 },
      manualInvoices: { linked: 4, alreadyLinked: 5, linkedToOtherAccount: 6 },
      standaloneAccessCodeEvents: {
        linked: 7,
        alreadyLinked: 8,
        linkedToOtherAccount: 9,
      },
    };
    const { layer } = makeCommandLayer({
      backfillLegacyAdministrator: (_accessToken, input) =>
        Effect.sync(() => {
          requests.push(input);
          return result;
        }),
    });
    const output: string[] = [];
    const capturedOutput = Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => {
        output.push(args.join(" "));
      },
    } satisfies Console.Console);

    await runCommand(
      [
        "--json",
        "administrators",
        "backfill-legacy",
        "--legacy-username",
        legacyUsername,
        "--email",
        email,
        "--dry-run",
      ],
      Layer.mergeAll(layer, capturedOutput)
    ).pipe(Effect.runPromise);

    expect(requests).toEqual([{ legacyUsername, email, dryRun: true }]);
    expect(output.map((line) => JSON.parse(line))).toEqual([result]);
  });

  test("requires confirmation for a real legacy administrator backfill", async () => {
    const legacyUsername = AdministrationLegacyUsername.make("legacy-admin");
    const email = testEmailAddress("legacy-admin");
    const requests: unknown[] = [];
    const { layer } = makeCommandLayer({
      backfillLegacyAdministrator: (_accessToken, input) =>
        Effect.sync(() => {
          requests.push(input);
          return {
            dryRun: false,
            administratorRole: "granted" as const,
            cliSessions: {
              linked: 1,
              alreadyLinked: 0,
              linkedToOtherAccount: 0,
            },
            manualInvoices: {
              linked: 1,
              alreadyLinked: 0,
              linkedToOtherAccount: 0,
            },
            standaloneAccessCodeEvents: {
              linked: 1,
              alreadyLinked: 0,
              linkedToOtherAccount: 0,
            },
          };
        }),
    });
    const args = [
      "--json",
      "administrators",
      "backfill-legacy",
      "--legacy-username",
      legacyUsername,
      "--email",
      email,
    ];

    const error = await runCommand(args, layer).pipe(
      Effect.flip,
      Effect.runPromise
    );
    expect(error).toMatchObject({ _tag: "ConfirmationRequiredError" });
    expect(requests).toEqual([]);

    await runCommand([...args, "--yes"], layer).pipe(Effect.runPromise);
    expect(requests).toEqual([{ legacyUsername, email, dryRun: false }]);
  });

  test("formats legacy administrator backfill counts for operators", async () => {
    const result = {
      dryRun: true,
      administratorRole: "already_granted" as const,
      cliSessions: { linked: 2, alreadyLinked: 1, linkedToOtherAccount: 3 },
      manualInvoices: { linked: 4, alreadyLinked: 5, linkedToOtherAccount: 6 },
      standaloneAccessCodeEvents: {
        linked: 7,
        alreadyLinked: 8,
        linkedToOtherAccount: 9,
      },
    };
    const { layer } = makeCommandLayer({
      backfillLegacyAdministrator: () => Effect.succeed(result),
    });
    const output: string[] = [];
    const capturedOutput = Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => {
        output.push(args.join(" "));
      },
    } satisfies Console.Console);

    await runCommand(
      [
        "administrators",
        "backfill-legacy",
        "--legacy-username",
        "legacy-admin",
        "--email",
        testEmailAddress("legacy-admin"),
        "--dry-run",
      ],
      Layer.mergeAll(layer, capturedOutput)
    ).pipe(Effect.runPromise);

    expect(output).toEqual([
      "Administrator role: already granted",
      "CLI sessions: would link 2, already linked 1, linked to another account 3",
      "Manual invoices: would link 4, already linked 5, linked to another account 6",
      "Standalone access-code events: would link 7, already linked 8, linked to another account 9",
    ]);
  });

  test("propagates CliResourceNotFound from legacy administrator backfill", async () => {
    const notFound = new CliResourceNotFound({
      message: "No active account has that email.",
    });
    const { layer } = makeCommandLayer({
      backfillLegacyAdministrator: () => Effect.fail(notFound),
    });

    const error = await runCommand(
      [
        "--json",
        "administrators",
        "backfill-legacy",
        "--legacy-username",
        "legacy-admin",
        "--email",
        testEmailAddress("legacy-admin"),
        "--dry-run",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toBe(notFound);
  });

  test("clears the local credential after revoking its own session", async () => {
    let clears = 0;
    const { layer } = makeCommandLayer({
      clear: Effect.sync(() => {
        clears += 1;
        return true;
      }),
      revokeSession: () => Effect.succeed({ changed: true }),
    });

    await runCommand(
      ["--json", "sessions", "revoke", sessionId, "--yes"],
      layer
    ).pipe(Effect.runPromise);

    expect(clears).toBe(1);
  });

  test("requires reauthentication before a legacy session can create access codes", async () => {
    const { accessCodeCreations, layer } = makeCommandLayer();

    const error = await runCommand(
      [
        "--json",
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T10:00",
        "--ends-at",
        "2026-09-10T12:00",
        "--yes",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({
      _tag: "AuthenticationRequiredError",
      message: expect.stringContaining("dhw auth"),
    });
    expect(accessCodeCreations).toHaveLength(0);
  });

  test("requires explicit confirmation before requesting an access code", async () => {
    const { accessCodeCreations, layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
    });

    const jsonError = await runCommand(
      [
        "--json",
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T10:00",
        "--ends-at",
        "2026-09-10T12:00",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    const plainError = await runCommand(
      [
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T10:00",
        "--ends-at",
        "2026-09-10T12:00",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(jsonError).toMatchObject({ _tag: "ConfirmationRequiredError" });
    expect(plainError).toMatchObject({ _tag: "ConfirmationRequiredError" });
    expect(accessCodeCreations).toHaveLength(0);
  });

  test("rejects an invalid access window before any API call", async () => {
    const { accessCodeCreations, layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
    });

    const reversedError = await runCommand(
      [
        "--json",
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T12:00",
        "--ends-at",
        "2026-09-10T10:00",
        "--yes",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    const parseError = await runCommand(
      [
        "--json",
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T10:30",
        "--ends-at",
        "2026-09-10T12:00",
        "--yes",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(reversedError).toMatchObject({ _tag: "InvalidMutationInputError" });
    expect(parseError).toBeDefined();
    expect(accessCodeCreations).toHaveLength(0);
  });

  test("reserves a fresh valid attempt id after each concluded creation and forwards the decoded request", async () => {
    const { accessCodeCreations, layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: () =>
        Effect.succeed(createdAccessCodeOutcome),
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "  Booth A  ",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.runPromise);
    await runCommand(args, layer).pipe(Effect.runPromise);

    expect(accessCodeCreations).toHaveLength(2);
    for (const creation of accessCodeCreations) {
      expect(
        Schema.is(AdministrationStandaloneAccessCodeAttemptId)(
          creation.attemptId
        )
      ).toBe(true);
      expect(JSON.stringify(creation.input)).toBe(
        JSON.stringify({
          name: "Booth A",
          startsAt: "2026-09-10T10:00",
          endsAt: "2026-09-10T12:00",
        })
      );
    }
    expect(accessCodeCreations[0]?.attemptId).not.toBe(
      accessCodeCreations[1]?.attemptId
    );
  });

  test("resumes a lost access-code creation with the reserved attempt id", async () => {
    const attemptIds: AdministrationStandaloneAccessCodeAttemptIdType[] = [];
    let responseLost = true;
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        attemptIds.push(attemptId);
        return responseLost
          ? Effect.fail(
              new CliServiceUnavailable({ message: "The response was lost." })
            )
          : Effect.succeed(createdAccessCodeOutcome);
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);
    responseLost = false;
    await runCommand(args, layer).pipe(Effect.runPromise);

    expect(attemptIds).toHaveLength(2);
    expect(attemptIds[1]).toBe(attemptIds[0]);
  });

  test("keeps the reserved attempt id recoverable when the PIN output is interrupted", async () => {
    const attemptIds: AdministrationStandaloneAccessCodeAttemptIdType[] = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        attemptIds.push(attemptId);
        return attemptIds.length === 1
          ? Effect.succeed(createdAccessCodeOutcome)
          : Effect.succeed(alreadyCreatedAccessCodeOutcome);
      },
    });
    const interruptedOutput = Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => {
        if (args.join(" ").includes("7654321")) {
          throw new Error(
            "The output was interrupted before the PIN was shown."
          );
        }
      },
    } satisfies Console.Console);
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--yes",
    ];

    const interrupted = await runCommand(
      args,
      Layer.mergeAll(layer, interruptedOutput)
    ).pipe(Effect.exit, Effect.runPromise);
    expect(Exit.isFailure(interrupted)).toBe(true);
    await runCommand(args, layer).pipe(Effect.runPromise);

    expect(attemptIds).toHaveLength(2);
    expect(attemptIds[1]).toBe(attemptIds[0]);
  });

  test("does not reuse a reserved attempt id for a changed access window", async () => {
    const attemptIds: AdministrationStandaloneAccessCodeAttemptIdType[] = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        attemptIds.push(attemptId);
        return Effect.fail(
          new CliServiceUnavailable({ message: "The response was lost." })
        );
      },
    });

    await runCommand(
      [
        "--json",
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T10:00",
        "--ends-at",
        "2026-09-10T12:00",
        "--yes",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    await runCommand(
      [
        "--json",
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T10:00",
        "--ends-at",
        "2026-09-10T13:00",
        "--yes",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(attemptIds).toHaveLength(2);
    expect(attemptIds[1]).not.toBe(attemptIds[0]);
  });

  test("reserves a fresh attempt id after a terminally rejected access-code creation", async () => {
    const attemptIds: AdministrationStandaloneAccessCodeAttemptIdType[] = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        attemptIds.push(attemptId);
        return Effect.fail(
          new CliMutationRejected({ message: "The request was rejected." })
        );
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);
    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);

    expect(attemptIds).toHaveLength(2);
    expect(attemptIds[1]).not.toBe(attemptIds[0]);
  });

  test("reserves a fresh attempt id after an uncertain provider outcome", async () => {
    const attemptIds: AdministrationStandaloneAccessCodeAttemptIdType[] = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        attemptIds.push(attemptId);
        return Effect.fail(
          new CliMutationUncertain({
            message: "The creation outcome is ambiguous.",
          })
        );
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);
    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);

    expect(attemptIds).toHaveLength(2);
    expect(attemptIds[1]).not.toBe(attemptIds[0]);
  });

  test("refuses to create an access code when the attempt cannot be reserved locally", async () => {
    const blockedPath = `/tmp/dhw-state-blocked-${crypto.randomUUID()}`;
    await Bun.write(blockedPath, "a regular file, not a state directory");
    const { accessCodeCreations, layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      stateDirectory: blockedPath,
    });

    try {
      const error = await runCommand(
        [
          "--json",
          "access-codes",
          "create",
          "Booth A",
          "--starts-at",
          "2026-09-10T10:00",
          "--ends-at",
          "2026-09-10T12:00",
          "--yes",
        ],
        layer
      ).pipe(Effect.flip, Effect.runPromise);

      expect(error).toMatchObject({
        _tag: "AccessCodeAttemptReservationError",
      });
      expect(accessCodeCreations).toHaveLength(0);
    } finally {
      await Bun.file(blockedPath).delete();
    }
  });

  test("reserves a fresh attempt id after required at-lock cleanup", async () => {
    const attemptIds: AdministrationStandaloneAccessCodeAttemptIdType[] = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        attemptIds.push(attemptId);
        return Effect.fail(
          new CliStandaloneAccessCodeCleanupRequired({
            message: "A previous attempt for this window is ambiguous.",
            cleanupTarget,
          })
        );
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);
    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);

    expect(attemptIds).toHaveLength(2);
    expect(attemptIds[1]).not.toBe(attemptIds[0]);
  });

  test("completes a confirmed reconciliation in one invocation after a lost response", async () => {
    const calls: Array<{
      readonly attemptId: AdministrationStandaloneAccessCodeAttemptIdType;
      readonly providerCredentialRemovedAttemptId?: AdministrationStandaloneAccessCodeAttemptIdType;
    }> = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (
        _accessToken,
        attemptId,
        _input,
        providerCredentialRemovedAttemptId
      ) => {
        calls.push({ attemptId, providerCredentialRemovedAttemptId });
        if (calls.length === 1) {
          return Effect.fail(
            new CliStandaloneAccessCodeReconciled({
              message:
                "Your confirmed cleanup was recorded for the earlier ambiguous attempt, which created no access code.",
            })
          );
        }
        return Effect.succeed(createdAccessCodeOutcome);
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--provider-credential-removed",
      cleanupTargetAttemptId,
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.runPromise);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.providerCredentialRemovedAttemptId).toBe(
      cleanupTargetAttemptId
    );
    expect(calls[1]?.providerCredentialRemovedAttemptId).toBeUndefined();
    expect(calls[1]?.attemptId).not.toBe(calls[0]?.attemptId);
    expect(calls[0]?.attemptId).not.toBe(cleanupTargetAttemptId);
    expect(calls[1]?.attemptId).not.toBe(cleanupTargetAttemptId);
  });

  test("forgets the rotated attempt so the next intentional command reserves a fresh id", async () => {
    const calls: Array<{
      readonly attemptId: AdministrationStandaloneAccessCodeAttemptIdType;
    }> = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        calls.push({ attemptId });
        if (calls.length === 1) {
          return Effect.fail(
            new CliStandaloneAccessCodeReconciled({
              message:
                "Your confirmed cleanup was recorded for the earlier ambiguous attempt, which created no access code.",
            })
          );
        }
        return Effect.succeed(createdAccessCodeOutcome);
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--provider-credential-removed",
      cleanupTargetAttemptId,
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.runPromise);
    await runCommand(args, layer).pipe(Effect.runPromise);

    expect(calls).toHaveLength(3);
    expect(calls[1]?.attemptId).not.toBe(calls[0]?.attemptId);
    expect(calls[2]?.attemptId).not.toBe(calls[1]?.attemptId);
    expect(calls[2]?.attemptId).not.toBe(calls[0]?.attemptId);
  });

  test("never rotates on a plain uncertain outcome", async () => {
    const calls: Array<{
      readonly providerCredentialRemovedAttemptId?: AdministrationStandaloneAccessCodeAttemptIdType;
    }> = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (
        _accessToken,
        _attemptId,
        _input,
        providerCredentialRemovedAttemptId
      ) => {
        calls.push({ providerCredentialRemovedAttemptId });
        return Effect.fail(
          new CliMutationUncertain({
            message: "The creation outcome is ambiguous.",
          })
        );
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--provider-credential-removed",
      cleanupTargetAttemptId,
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.providerCredentialRemovedAttemptId).toBe(
      cleanupTargetAttemptId
    );
  });

  test("requires confirmation and provider cleanup before reconciling access", async () => {
    const { accessMutations, layer } = makeCommandLayer();

    const confirmationError = await runCommand(
      ["--json", "reservations", "retry-access", "reservation-1"],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    const providerError = await runCommand(
      ["--json", "reservations", "reconcile-access", "reservation-1", "--yes"],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(confirmationError).toMatchObject({
      _tag: "ConfirmationRequiredError",
    });
    expect(providerError).toMatchObject({ _tag: "InvalidMutationInputError" });
    expect(accessMutations).toHaveLength(0);
  });

  test("prints discount groups as the API result in JSON mode", async () => {
    const discountGroups = Schema.decodeUnknownSync(
      AdministrationDiscountGroupList
    )({ discountGroups: [{ id: "group-1", name: "Community" }] });
    const { layer, output } = makeCommandLayer({
      listDiscountGroups: () => Effect.succeed(discountGroups),
    });

    await runCommand(["--json", "discounts", "groups"], layer).pipe(
      Effect.runPromise
    );

    expect(JSON.parse(output.join(""))).toEqual(discountGroups.discountGroups);
  });

  test("rejects percentages that cannot be represented as whole basis points", async () => {
    const { layer, mutations } = makeCommandLayer();

    await expect(
      runCommand(
        [
          "--json",
          "discounts",
          "create",
          "percentage",
          "--label-en",
          "Summer",
          "--label-cs",
          "Léto",
          "--percentage",
          "0.015",
          "--product",
          "cowork",
        ],
        layer
      ).pipe(Effect.runPromise)
    ).rejects.toBeDefined();

    expect(mutations).toHaveLength(0);
  });

  test("maps exact percentages and validates the complete mutation", async () => {
    const { layer, mutations } = makeCommandLayer();

    await runCommand(
      [
        "--json",
        "discounts",
        "create",
        "percentage",
        "--label-en",
        "Summer",
        "--label-cs",
        "Léto",
        "--percentage",
        "0.01",
        "--product",
        "cowork",
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(mutations).toEqual([
      {
        kind: "create-discount",
        discount: {
          labels: { "cs-CZ": "Léto", "en-US": "Summer" },
          adjustment: { kind: "percentage", basisPoints: 1 },
          products: [{ kind: "cowork" }],
        },
      },
    ]);
  });

  test("rejects every cowork tier combined with a single tier before making a request", async () => {
    const { layer, mutations } = makeCommandLayer();

    const error = await runCommand(
      [
        "--json",
        "discounts",
        "create",
        "percentage",
        "--label-en",
        "Summer",
        "--label-cs",
        "Léto",
        "--percentage",
        "10",
        "--product",
        "cowork",
        "--product",
        "cowork:open-space",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({ _tag: "InvalidMutationInputError" });
    expect(mutations).toHaveLength(0);
  });

  describe("discount code service dates", () => {
    const discountId = "019c91dd-c560-7e55-b9d8-c95065efd51d";
    const updateArgs = [
      "--json",
      "codes",
      "update",
      codeId,
      "SUMMER10",
      discountId,
      "--enabled",
      "true",
    ];
    const createArgs = [
      "--json",
      "codes",
      "create",
      "existing",
      "SUMMER10",
      discountId,
    ];
    const sentCode = (mutations: ReadonlyArray<unknown>) =>
      (mutations[0] as { readonly code: Record<string, unknown> }).code;

    test("sends both dates on create and update", async () => {
      for (const args of [createArgs, updateArgs]) {
        const { layer, mutations } = makeCommandLayer();

        await runCommand(
          [
            ...args,
            "--service-date-from",
            "2026-07-15",
            "--service-date-until",
            "2026-07-15",
          ],
          layer
        ).pipe(Effect.runPromise);

        expect(sentCode(mutations)).toMatchObject({
          serviceDateFrom: "2026-07-15",
          serviceDateUntil: "2026-07-15",
        });
      }
    });

    test("leaves the dates out without date flags so an update keeps them", async () => {
      for (const args of [createArgs, updateArgs]) {
        const { layer, mutations } = makeCommandLayer();

        await runCommand(args, layer).pipe(Effect.runPromise);

        expect(Object.keys(sentCode(mutations))).not.toContain(
          "serviceDateFrom"
        );
        expect(Object.keys(sentCode(mutations))).not.toContain(
          "serviceDateUntil"
        );
      }
    });

    test("clears the dates with explicit nulls", async () => {
      const { layer, mutations } = makeCommandLayer();

      await runCommand([...updateArgs, "--clear-service-dates"], layer).pipe(
        Effect.runPromise
      );

      expect(sentCode(mutations)).toMatchObject({
        serviceDateFrom: null,
        serviceDateUntil: null,
      });
    });

    test("rejects incomplete, combined, inverted, or invalid dates before making a request", async () => {
      for (const args of [
        [...createArgs, "--service-date-from", "2026-07-01"],
        [...updateArgs, "--service-date-until", "2026-07-31"],
        [
          ...updateArgs,
          "--clear-service-dates",
          "--service-date-from",
          "2026-07-01",
        ],
        [
          ...updateArgs,
          "--clear-service-dates",
          "--service-date-from",
          "2026-07-01",
          "--service-date-until",
          "2026-07-31",
        ],
        [
          ...createArgs,
          "--service-date-from",
          "2026-07-31",
          "--service-date-until",
          "2026-07-01",
        ],
        [
          ...createArgs,
          "--service-date-from",
          "2026-02-30",
          "--service-date-until",
          "2026-03-31",
        ],
      ]) {
        const { layer, mutations } = makeCommandLayer();

        await expect(
          runCommand(args, layer).pipe(Effect.runPromise)
        ).rejects.toBeDefined();
        expect(mutations).toHaveLength(0);
      }
    });

    test("names the conflicting flags as an input error", async () => {
      const { layer } = makeCommandLayer();

      const error = await runCommand(
        [
          ...updateArgs,
          "--clear-service-dates",
          "--service-date-until",
          "2026-07-31",
        ],
        layer
      ).pipe(Effect.flip, Effect.runPromise);

      expect(error).toMatchObject({ _tag: "InvalidMutationInputError" });
    });
  });

  test("rejects duplicate product flags before making a request", async () => {
    const { layer, mutations } = makeCommandLayer();

    const error = await runCommand(
      [
        "--json",
        "discounts",
        "create",
        "percentage",
        "--label-en",
        "Summer",
        "--label-cs",
        "Léto",
        "--percentage",
        "10",
        "--product",
        "cowork",
        "--product",
        "cowork",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({ _tag: "InvalidMutationInputError" });
    expect(mutations).toHaveLength(0);
  });
});

describe("dhw invoices cancellation and archive", () => {
  const invoiceId = "01980000-0000-7000-8000-0000000000c1";
  const billedReservationId = "01980000-0000-7000-8000-0000000000c2";
  const cancellation = {
    cancelledAt: "2026-11-15T10:00:00Z",
    cause: "invoice_cancellation",
    source: "dhw-cli",
    actor: "administrator",
    correctiveDocumentNumber: "WS-OD-2026-000001",
    correctiveDocumentIssuedAt: "2026-11-15T10:00:00Z",
    correctiveDocumentPdfUrl: `/admin/invoices/${invoiceId}/corrective-document`,
    notices: {
      customer: "accepted",
      internal: "accepted",
      needsAttention: false,
    },
  } as const;
  const liveInvoice = (plan: {
    readonly customerNotice: "owed" | "not_owed";
    readonly reservation:
      | "none"
      | "cancels_reservation"
      | "already_cancelled"
      | "cancellation_in_progress";
  }) =>
    ({
      id: invoiceId,
      invoiceNumber: "WS-FV-2026-000009",
      reservationId: plan.reservation === "none" ? null : billedReservationId,
      cancellation: null,
      archivedAt: null,
      cancellationPlan: plan,
    }) as never;
  const reservationDetail = {
    reservation: {
      id: billedReservationId,
      date: "2026-11-20",
      startsAt: null,
      typeLabel: "Meeting room",
      customer: null,
      customerId: "customer-c1",
      status: { label: "Confirmed" },
    },
    invoice: null,
  } as never;
  const cancelled = {
    invoiceId: AdministrationInvoiceId.make(invoiceId),
    outcome: "cancelled",
    cancellation,
    reservation: null,
  } as const;

  test("sends exactly the confirmations of the plan it read", async () => {
    const plans = [
      { customerNotice: "owed", reservation: "none" },
      { customerNotice: "not_owed", reservation: "already_cancelled" },
      { customerNotice: "owed", reservation: "cancels_reservation" },
    ] as const;
    const sent: unknown[] = [];
    const reservationReads: string[] = [];
    let read = 0;
    const { layer } = makeCommandLayer({
      getInvoice: () => Effect.succeed(liveInvoice(plans[read++]!)),
      getReservation: (_accessToken, id) =>
        Effect.sync(() => {
          reservationReads.push(id);
          return reservationDetail;
        }),
      cancelInvoice: (_accessToken, id, input) =>
        Effect.sync(() => {
          sent.push({ id, input });
          return cancelled;
        }),
    });

    for (const _ of plans) {
      await runCommand(
        [
          "--json",
          "invoices",
          "cancel",
          invoiceId,
          "--send-cancellation-email",
          "--yes",
        ],
        layer
      ).pipe(Effect.runPromise);
    }

    expect(reservationReads).toEqual([billedReservationId]);
    expect(sent).toEqual([
      { id: invoiceId, input: { confirmedCustomerNotice: true } },
      { id: invoiceId, input: { confirmedCustomerNotice: false } },
      {
        id: invoiceId,
        input: {
          confirmedCustomerNotice: true,
          reservation: {
            sendCancellationEmail: true,
          },
        },
      },
    ]);
  });

  test("refuses without confirmation, while the reservation is cancelling, and replays a cancelled invoice", async () => {
    const invoices = [
      liveInvoice({ customerNotice: "owed", reservation: "none" }),
      liveInvoice({
        customerNotice: "owed",
        reservation: "cancellation_in_progress",
      }),
      {
        ...(liveInvoice({
          customerNotice: "owed",
          reservation: "cancels_reservation",
        }) as object),
        reservationId: null,
      } as never,
      {
        id: invoiceId,
        invoiceNumber: "WS-FV-2026-000009",
        reservationId: null,
        cancellation,
        archivedAt: null,
        cancellationPlan: null,
      } as never,
    ];
    let read = 0;
    let cancellations = 0;
    const { layer } = makeCommandLayer({
      getInvoice: () => Effect.succeed(invoices[read++]!),
      cancelInvoice: () =>
        Effect.sync(() => {
          cancellations += 1;
          return cancelled;
        }),
    });

    const unconfirmed = await runCommand(
      ["--json", "invoices", "cancel", invoiceId],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    const inProgress = await runCommand(
      ["--json", "invoices", "cancel", invoiceId, "--yes"],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    const unnamedReservation = await runCommand(
      ["--json", "invoices", "cancel", invoiceId, "--yes"],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    await runCommand(
      ["--json", "invoices", "cancel", invoiceId, "--yes"],
      layer
    ).pipe(Effect.runPromise);

    expect(unconfirmed).toMatchObject({
      _tag: "ConfirmationRequiredError",
      operation: "administration.cancelInvoice",
    });
    expect(inProgress).toMatchObject({ _tag: "InvalidMutationInputError" });
    expect(unnamedReservation).toMatchObject({
      _tag: "InvalidMutationInputError",
    });
    expect(cancellations).toBe(0);
  });

  test("archives only with confirmation", async () => {
    const archives: string[] = [];
    const { layer } = makeCommandLayer({
      getInvoice: () =>
        Effect.succeed({ invoiceNumber: "WS-FV-2026-000009" } as never),
      archiveInvoice: (_accessToken, id) =>
        Effect.sync(() => {
          archives.push(id);
          return {
            invoiceId: id,
            archivedAt: "2026-11-15T11:00:00Z",
            changed: true,
          };
        }),
    });

    const unconfirmed = await runCommand(
      ["--json", "invoices", "archive", invoiceId],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    await runCommand(
      ["--json", "invoices", "archive", invoiceId, "--yes"],
      layer
    ).pipe(Effect.runPromise);

    expect(unconfirmed).toMatchObject({
      _tag: "ConfirmationRequiredError",
      operation: "administration.archiveInvoice",
    });
    expect(archives).toEqual([invoiceId]);
  });

  test("lists archived invoices only with the flag", async () => {
    const queries: unknown[] = [];
    const { layer } = makeCommandLayer({
      listInvoices: (_accessToken, query) =>
        Effect.sync(() => {
          queries.push(query);
          return { items: [], total: 0, page: 1, pageSize: 50, pageCount: 1 };
        }),
    });

    await runCommand(["--json", "invoices", "list"], layer).pipe(
      Effect.runPromise
    );
    await runCommand(
      ["--json", "invoices", "list", "--include-archived"],
      layer
    ).pipe(Effect.runPromise);

    expect(queries).toEqual([{}, { includeArchived: true }]);
  });

  test("downloads the credit note with --corrective", async () => {
    const downloads: string[] = [];
    const pdf = (kind: string) => (_accessToken: unknown, id: string) =>
      Effect.sync(() => {
        downloads.push(`${kind}:${id}`);
        return new Uint8Array([37, 80, 68, 70]);
      });
    const directory = await mkdtemp(join(tmpdir(), "dhw-command-invoice-"));
    const { layer } = makeCommandLayer({
      getInvoicePdf: pdf("invoice"),
      getInvoiceCorrectiveDocumentPdf: pdf("corrective"),
    });

    try {
      await runCommand(
        [
          "--json",
          "invoices",
          "download",
          invoiceId,
          "--corrective",
          "--output",
          join(directory, "credit-note.pdf"),
        ],
        layer
      ).pipe(Effect.runPromise);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    expect(downloads).toEqual([`corrective:${invoiceId}`]);
  });
});

const runCommand = <R>(
  args: ReadonlyArray<string>,
  layer: Layer.Layer<R, never, never>
) =>
  Command.runWith(dhwCommand, { version: "1.3.0" })(args).pipe(
    Effect.provide(layer)
  );

const makeCommandLayer = ({
  backfillLegacyAdministrator = () => Effect.die("not used"),
  backfillReservationProductDetails = () => Effect.die("not used"),
  cancelReservation = () =>
    Effect.succeed({
      outcome: "already_cancelled",
      email: "not_requested",
      invoice: null,
    }),
  restoreReservation = () => Effect.die("not used"),
  clear = Effect.succeed(true),
  createInvoice = () => Effect.die("not used"),
  createStandaloneAccessCode = () => Effect.die("not used"),
  getCustomerReservationActivity = () => Effect.die("not used"),
  getReservationActivity = () => Effect.die("not used"),
  getInvoiceCreationDefaults = () => Effect.die("not used"),
  getInvoice = () => Effect.die("not used"),
  cancelInvoice = () => Effect.die("not used"),
  archiveInvoice = () => Effect.die("not used"),
  listInvoices = () => Effect.die("not used"),
  getInvoicePdf = () => Effect.die("not used"),
  getInvoiceCorrectiveDocumentPdf = () => Effect.die("not used"),
  getOverview = () => Effect.die("not used"),
  listDiscountGroups = () => Effect.die("not used"),
  previewInvoice = () => Effect.die("not used"),
  getReservation = () =>
    Effect.succeed({
      accessGrant: { updatedAt: "2026-08-10T10:00:00.000Z" },
    } as never),
  authenticatedSession = session,
  revokeSession = () => Effect.succeed({ changed: false }),
  stateDirectory = `/tmp/dhw-command-test-${crypto.randomUUID()}`,
}: {
  readonly backfillLegacyAdministrator?: WorkspaceAdminApiClient["Service"]["backfillLegacyAdministrator"];
  readonly backfillReservationProductDetails?: WorkspaceAdminApiClient["Service"]["backfillReservationProductDetails"];
  readonly cancelReservation?: WorkspaceAdminApiClient["Service"]["cancelReservation"];
  readonly restoreReservation?: WorkspaceAdminApiClient["Service"]["restoreReservation"];
  readonly clear?: AuthenticationService["Service"]["clear"];
  readonly createInvoice?: WorkspaceAdminApiClient["Service"]["createInvoice"];
  readonly createStandaloneAccessCode?: WorkspaceAdminApiClient["Service"]["createStandaloneAccessCode"];
  readonly getCustomerReservationActivity?: WorkspaceAdminApiClient["Service"]["getCustomerReservationActivity"];
  readonly getReservationActivity?: WorkspaceAdminApiClient["Service"]["getReservationActivity"];
  readonly getInvoiceCreationDefaults?: WorkspaceAdminApiClient["Service"]["getInvoiceCreationDefaults"];
  readonly getInvoice?: WorkspaceAdminApiClient["Service"]["getInvoice"];
  readonly cancelInvoice?: WorkspaceAdminApiClient["Service"]["cancelInvoice"];
  readonly archiveInvoice?: WorkspaceAdminApiClient["Service"]["archiveInvoice"];
  readonly listInvoices?: WorkspaceAdminApiClient["Service"]["listInvoices"];
  readonly getInvoicePdf?: WorkspaceAdminApiClient["Service"]["getInvoicePdf"];
  readonly getInvoiceCorrectiveDocumentPdf?: WorkspaceAdminApiClient["Service"]["getInvoiceCorrectiveDocumentPdf"];
  readonly getOverview?: WorkspaceAdminApiClient["Service"]["getOverview"];
  readonly listDiscountGroups?: WorkspaceAdminApiClient["Service"]["listDiscountGroups"];
  readonly previewInvoice?: WorkspaceAdminApiClient["Service"]["previewInvoice"];
  readonly getReservation?: WorkspaceAdminApiClient["Service"]["getReservation"];
  readonly authenticatedSession?: CliSessionType;
  readonly revokeSession?: WorkspaceAdminApiClient["Service"]["revokeSession"];
  readonly stateDirectory?: string;
} = {}) => {
  const mutations: unknown[] = [];
  const accessMutations: unknown[] = [];
  const accessCodeCreations: Array<{
    readonly accessToken: Redacted.Redacted<CliAccessTokenType>;
    readonly attemptId: AdministrationStandaloneAccessCodeAttemptIdType;
    readonly input: AdministrationStandaloneAccessCodeCreateInputType;
    readonly providerCredentialRemovedAttemptId?: AdministrationStandaloneAccessCodeAttemptIdType;
  }> = [];
  const output: string[] = [];
  const api = Layer.succeed(WorkspaceAdminApiClient, {
    ...({} as WorkspaceAdminApiClient["Service"]),
    backfillLegacyAdministrator,
    backfillReservationProductDetails,
    cancelReservation,
    restoreReservation,
    createInvoice,
    createStandaloneAccessCode: (
      accessToken: Redacted.Redacted<CliAccessTokenType>,
      attemptId: AdministrationStandaloneAccessCodeAttemptIdType,
      input: AdministrationStandaloneAccessCodeCreateInputType,
      providerCredentialRemovedAttemptId?: AdministrationStandaloneAccessCodeAttemptIdType
    ) =>
      Effect.suspend(() => {
        accessCodeCreations.push({
          accessToken,
          attemptId,
          input,
          providerCredentialRemovedAttemptId,
        });
        return createStandaloneAccessCode(
          accessToken,
          attemptId,
          input,
          providerCredentialRemovedAttemptId
        );
      }),
    getCustomerReservationActivity,
    getReservationActivity,
    getInvoiceCreationDefaults,
    getInvoice,
    cancelInvoice,
    archiveInvoice,
    listInvoices,
    getInvoicePdf,
    getInvoiceCorrectiveDocumentPdf,
    getOverview,
    getReservation,
    listDiscountGroups,
    mutateDiscounts: (_accessToken, _requestId, mutation) =>
      Effect.sync(() => {
        mutations.push(mutation);
        return {
          kind: mutation.kind,
          createdDiscountId: null,
          createdCodeId:
            mutation.kind === "create-code" ||
            mutation.kind === "create-customer-code"
              ? codeId
              : null,
          createdVoucherId:
            mutation.kind === "create-voucher" ||
            mutation.kind === "create-customer-voucher"
              ? voucherId
              : null,
        };
      }),
    mutateReservationAccess: (
      _accessToken,
      _requestId,
      reservationId,
      mutation
    ) =>
      Effect.sync(() => {
        accessMutations.push([reservationId, mutation]);
        const timestamp = "2026-08-10T10:00:00.000Z";
        return {
          id: "access-1",
          state: "issued" as const,
          provider: "igloohome",
          credentialType: "algopin-hourly",
          deviceId: "EK1X16f8898a",
          providerCredentialId: "pin-1",
          accessName: `Deskohub ${reservationId}`,
          scheduledStartsAt: timestamp,
          startsAt: timestamp,
          endsAt: timestamp,
          provisioningStartedAt: timestamp,
          issuedAt: timestamp,
          failedAt: null,
          failureCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      }),
    previewInvoice,
    revokeSession,
  });
  const console = Layer.succeed(Console.Console, {
    ...globalThis.console,
    log: (...args: ReadonlyArray<unknown>) => {
      output.push(args.join(" "));
    },
  } satisfies Console.Console);
  const authentication = Layer.succeed(AuthenticationService, {
    current: Effect.succeed(
      Option.some({
        accessToken: Redacted.make(accessToken),
        session: authenticatedSession,
      })
    ),
    save: () => Effect.void,
    clear,
  });
  const config = Layer.succeed(DhwConfig, {
    baseUrl: new URL("https://workspace.example.test"),
    requestHeaders: {},
    isCi: true,
    stateDirectory,
    updateChecksDisabled: true,
  });

  return {
    accessCodeCreations,
    accessMutations,
    mutations,
    layer: Layer.mergeAll(
      api,
      authentication,
      console,
      AccessCodeAttemptStore.Default
    ).pipe(Layer.provideMerge(config), Layer.provideMerge(BunServices.layer)),
    output,
  };
};
