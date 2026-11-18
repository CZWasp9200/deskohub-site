import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService, DotyposVersionConflict } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Schema } from "effect";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
} from "@/features/accounting/accounting-document-snapshot";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { createReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import {
  recordEffectTrace,
  startEffectTrace,
} from "@/shared/testing/effect-trace.test-utils";
import { AccountingDocumentSnapshots } from "./accounting-document-snapshots";
import { InvoiceRepository } from "./invoice.repository";
import { ReservationInvoiceService } from "./reservation-invoice.service";

mock.module("server-only", () => ({}));

const { InvoiceEmailDeliveryError, InvoiceEmailDeliveryService } = await import(
  "./invoice-email-delivery.service"
);

const paymentAttemptId = paymentAttemptIdSchema.make("payment-attempt-1");
const personalAddress = {
  line1: "Synthetic 1",
  city: "Praha",
  postalCode: "100 00",
  country: "CZ",
};

describe("reservation invoice processing", () => {
  test("does nothing for personal reservations without an invoice request", async () => {
    const harness = makeHarness(
      makeSource({ purpose: "personal", invoice: "none" })
    );

    await runProcessing(harness);

    expect(harness.updateBilling).not.toHaveBeenCalled();
    expect(harness.issue).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  test("issues and delivers a requested personal invoice from frozen details", async () => {
    const harness = makeHarness(
      makeSource({
        purpose: "personal",
        invoice: "requested",
        address: personalAddress,
      })
    );

    await runProcessing(harness);

    expect(harness.updateBilling).toHaveBeenCalledWith("dotypos-customer-1", {
      addressLine1: "Synthetic 1",
      addressLine2: "",
      city: "Praha",
      zip: "100 00",
      country: "CZ",
      companyName: "",
      companyId: "",
      vatId: "",
    });
    expect(harness.issue).toHaveBeenCalledWith({
      paymentAttemptId,
      buyer: {
        kind: "person",
        legalName: "Ada Lovelace",
        address: personalAddress,
      },
    });
    expect(harness.deliver).toHaveBeenCalledWith({ paymentAttemptId });
  });

  test("business reservations are always invoiced", async () => {
    const source = makeSource({
      purpose: "business",
      invoice: "required",
      buyer: {
        kind: "business",
        legalName: "Synthetic Company s.r.o.",
        companyId: "12345678",
        address: personalAddress,
      },
    });
    const harness = makeHarness(source);

    await runProcessing(harness);

    expect(harness.updateBilling).toHaveBeenCalledWith("dotypos-customer-1", {
      addressLine1: "Synthetic 1",
      addressLine2: "",
      city: "Praha",
      zip: "100 00",
      country: "CZ",
      companyName: "Synthetic Company s.r.o.",
      companyId: "12345678",
      vatId: "",
    });
    expect(harness.issue).toHaveBeenCalledWith({
      paymentAttemptId,
      buyer: source.billing?.purpose === "business" ? source.billing.buyer : {},
    });
    expect(harness.deliver).toHaveBeenCalledTimes(1);
  });

  test("legacy snapshots remain ineligible for automatic invoicing", async () => {
    const { billing: _billing, ...legacySource } = makeSource({
      purpose: "personal",
      invoice: "requested",
      address: personalAddress,
    });
    const harness = makeHarness(
      Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)(legacySource)
    );

    await runProcessing(harness);

    expect(harness.updateBilling).not.toHaveBeenCalled();
    expect(harness.issue).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  test("does not overwrite billing after the invoice has been issued", async () => {
    const harness = makeHarness(
      makeSource({
        purpose: "personal",
        invoice: "requested",
        address: personalAddress,
      }),
      { existingInvoice: {} }
    );

    await runProcessing(harness);

    expect(harness.updateBilling).not.toHaveBeenCalled();
    expect(harness.issue).toHaveBeenCalledTimes(1);
    expect(harness.deliver).toHaveBeenCalledTimes(1);
  });

  test("issues for the reservation's active payment attempt", async () => {
    const activePaymentAttemptId = paymentAttemptIdSchema.make(
      "payment-attempt-active"
    );
    const harness = makeHarness(
      makeSource({
        purpose: "personal",
        invoice: "requested",
        address: personalAddress,
      }),
      { reservation: { activePaymentAttemptId } }
    );

    const { exit, trace } = await traceProcessing(harness);

    expect(exit._tag).toBe("Success");
    expect(trace).toEqual([
      "span ReservationInvoiceService.issueAfterFulfillment",
      `call reservations.findById(${harness.source?.workspaceReservationId})`,
      "call accountingSnapshots.find(payment-attempt-active)",
      "call invoices.findLiveByPaymentAttemptId(payment-attempt-active)",
      "call dotypos.updateCustomerBillingDetails(dotypos-customer-1; addressLine1=Synthetic 1, addressLine2=, city=Praha, zip=100 00, country=CZ, companyName=, companyId=, vatId=)",
      "call invoices.issue(paymentAttemptId=payment-attempt-active, buyer=<Object>)",
      "call deliveries.deliverByPaymentAttemptId(paymentAttemptId=payment-attempt-active)",
    ]);
  });

  test.each([
    ["has no active payment attempt", { activePaymentAttemptId: null }],
    ["is missing", null],
  ] as const)(
    "skips with a warning when the reservation %s",
    async (_, reservation) => {
      const harness = makeHarness(
        makeSource({
          purpose: "personal",
          invoice: "requested",
          address: personalAddress,
        }),
        { reservation }
      );

      const { exit, trace } = await traceProcessing(harness);

      expect(exit._tag).toBe("Success");
      expect(trace).toEqual([
        "span ReservationInvoiceService.issueAfterFulfillment",
        `call reservations.findById(${harness.source?.workspaceReservationId})`,
        `Warn Reservation invoice processing skipped: payment attempt missing (workspaceReservationId=${harness.source?.workspaceReservationId}) {} in ReservationInvoiceService.issueAfterFulfillment`,
      ]);
      expect(harness.findSnapshot).not.toHaveBeenCalled();
      expect(harness.issue).not.toHaveBeenCalled();
      expect(harness.deliver).not.toHaveBeenCalled();
    }
  );

  test("does not issue when committed billing persistence fails", async () => {
    const billingFailure = new DotyposVersionConflict({
      operation: "patchCustomer",
    });
    const harness = makeHarness(
      makeSource({
        purpose: "personal",
        invoice: "requested",
        address: personalAddress,
      }),
      { billingFailure }
    );

    await expect(runProcessing(harness)).rejects.toBe(billingFailure);
    expect(harness.issue).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  test("does nothing more when a concurrent issuance committed the frozen buyer first", async () => {
    const source = makeSource({
      purpose: "personal",
      invoice: "requested",
      address: personalAddress,
    });
    const harness = makeHarness(source, {
      issuedInvoice: {
        document: {
          ...makeCoworkInvoiceDocument("en-US"),
          buyer: {
            kind: "person",
            legalName: "Ada Lovelace",
            address: personalAddress,
          },
        },
      },
      issueChanged: false,
    });

    await runProcessing(harness);

    expect(harness.updateBilling).toHaveBeenCalledTimes(1);
    expect(harness.issue).toHaveBeenCalledTimes(1);
    expect(harness.deliver).toHaveBeenCalledTimes(1);
  });

  test("fails when the invoice delivery after fulfillment fails", async () => {
    const deliveryFailure = new InvoiceEmailDeliveryError({
      code: "email_delivery_failed",
      paymentAttemptId,
      message: "Customer invoice email delivery failed.",
      customerDelivered: false,
    });
    const harness = makeHarness(
      makeSource({
        purpose: "personal",
        invoice: "requested",
        address: personalAddress,
      }),
      { deliveryFailure }
    );

    await expect(runProcessing(harness)).rejects.toBe(deliveryFailure);
    expect(harness.issue).toHaveBeenCalledTimes(1);
  });

  test("rejects an invalid capability before loading the reservation", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source);

    const state = await runPostOrderState(harness, "invalid-token");

    expect(state).toBe("unavailable");
    expect(harness.findReservation).not.toHaveBeenCalled();
  });

  test("creates a personal invoice from a protected post-order request", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source);
    const accessToken = await Effect.runPromise(
      createReservationAccessToken({
        orderId: source.workspaceReservationId,
        locale: "en-US",
      })
    );

    const state = await runPostOrderState(harness, accessToken);
    const result = await runPostOrderCreate(harness, accessToken);

    expect(state).toBe("create");
    expect(result).toEqual({ status: "created", delivered: true });
    expect(harness.issue).toHaveBeenCalledWith({
      paymentAttemptId,
      buyer: {
        kind: "person",
        legalName: "Ada Lovelace",
        address: personalAddress,
      },
      provenance: { source: "post-order-link" },
    });
  });

  test("reconciles a losing concurrent request to the issued buyer", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const committedAddress = { ...personalAddress, line1: "Winner 1" };
    const harness = makeHarness(source, {
      issuedInvoice: {
        document: {
          ...makeCoworkInvoiceDocument("en-US"),
          buyer: {
            kind: "person",
            legalName: "Ada Lovelace",
            address: committedAddress,
          },
        },
      },
      issueChanged: false,
    });
    const accessToken = await Effect.runPromise(
      createReservationAccessToken({
        orderId: source.workspaceReservationId,
        locale: "en-US",
      })
    );

    const result = await runPostOrderCreate(harness, accessToken);

    expect(result).toEqual({ status: "already-issued", delivered: true });
    expect(harness.updateBilling).toHaveBeenCalledTimes(2);
    expect(harness.updateBilling).toHaveBeenLastCalledWith(
      "dotypos-customer-1",
      expect.objectContaining({ addressLine1: "Winner 1" })
    );
  });

  test("does not offer customer resend when only the internal copy failed", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, {
      deliveryFailure: new InvoiceEmailDeliveryError({
        code: "email_delivery_failed",
        paymentAttemptId,
        message: "Internal invoice email delivery failed.",
        customerDelivered: true,
      }),
    });
    const accessToken = await Effect.runPromise(
      createReservationAccessToken({
        orderId: source.workspaceReservationId,
        locale: "en-US",
      })
    );

    const result = await runPostOrderCreate(harness, accessToken);

    expect(result).toEqual({ status: "created", delivered: true });
  });

  test("refuses a losing concurrent request whose issued buyer is not a person", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, {
      issuedInvoice: {
        document: {
          ...makeCoworkInvoiceDocument("en-US"),
          buyer: {
            kind: "business",
            legalName: "Synthetic Company s.r.o.",
            companyId: "12345678",
            address: personalAddress,
          },
        },
      },
      issueChanged: false,
    });

    await expect(
      runPostOrderCreate(harness, await makeAccessToken(source))
    ).rejects.toMatchObject({ _tag: "PostOrderInvoiceUnavailableError" });
    expect(harness.updateBilling).toHaveBeenCalledTimes(1);
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  test("does not deliver when Dotypos refuses the committed buyer of a lost race", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const reconcileBillingFailure = new DotyposVersionConflict({
      operation: "patchCustomer",
    });
    const harness = makeHarness(source, {
      issuedInvoice: {
        document: {
          ...makeCoworkInvoiceDocument("en-US"),
          buyer: {
            kind: "person",
            legalName: "Ada Lovelace",
            address: { ...personalAddress, line1: "Winner 1" },
          },
        },
      },
      issueChanged: false,
      reconcileBillingFailure,
    });

    await expect(
      runPostOrderCreate(harness, await makeAccessToken(source))
    ).rejects.toBe(reconcileBillingFailure);
    expect(harness.updateBilling).toHaveBeenCalledTimes(2);
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  test("offers customer resend when the delivery failure does not say whether the customer copy went out", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, {
      deliveryFailure: new InvoiceEmailDeliveryError({
        code: "invoice_load_failed",
        paymentAttemptId,
        message: "Invoice could not be loaded for delivery.",
      }),
    });

    const result = await runPostOrderCreate(
      harness,
      await makeAccessToken(source)
    );

    expect(result).toEqual({ status: "created", delivered: false });
  });

  test("offers customer resend when the customer copy failed", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, {
      deliveryFailure: new InvoiceEmailDeliveryError({
        code: "email_delivery_failed",
        paymentAttemptId,
        message: "Customer invoice email delivery failed.",
        customerDelivered: false,
      }),
    });

    const result = await runPostOrderCreate(
      harness,
      await makeAccessToken(source)
    );

    expect(result).toEqual({ status: "created", delivered: false });
  });

  test("returns an issued invoice without issuing or delivering again", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, { existingInvoice: {} });

    const result = await runPostOrderCreate(
      harness,
      await makeAccessToken(source)
    );

    expect(result).toEqual({ status: "already-issued", delivered: true });
    expect(harness.updateBilling).not.toHaveBeenCalled();
    expect(harness.issue).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  test("refuses creation and resend when the post-order page is unavailable", async () => {
    const source = makeSource({
      purpose: "personal",
      invoice: "requested",
      address: personalAddress,
    });
    const harness = makeHarness(source);
    const accessToken = await makeAccessToken(source);

    await expect(
      runPostOrderCreate(harness, accessToken)
    ).rejects.toMatchObject({ _tag: "PostOrderInvoiceUnavailableError" });
    await expect(
      runPostOrderResend(harness, accessToken)
    ).rejects.toMatchObject({ _tag: "PostOrderInvoiceUnavailableError" });
    expect(harness.updateBilling).not.toHaveBeenCalled();
    expect(harness.issue).not.toHaveBeenCalled();
    expect(harness.resend).not.toHaveBeenCalled();
  });

  test("is unavailable without a capability, before loading the reservation", async () => {
    const harness = makeHarness(
      makeSource({ purpose: "personal", invoice: "none" })
    );

    const state = await runPostOrderState(harness, undefined);

    expect(state).toBe("unavailable");
    expect(harness.findReservation).not.toHaveBeenCalled();
  });

  test.each([
    ["is missing", null],
    ["is in another locale", { locale: "cs" }],
    ["is unpaid", { paymentState: "pending" }],
    ["is unconfirmed", { reservationState: "held" }],
    [
      "has no delivered access code",
      { fulfillmentState: "processing", fulfilledAt: null },
    ],
    ["has no active payment attempt", { activePaymentAttemptId: null }],
  ] as const)(
    "is unavailable when the reservation %s",
    async (_, reservation) => {
      const source = makeSource({ purpose: "personal", invoice: "none" });
      const harness = makeHarness(source, { reservation });

      const state = await runPostOrderState(
        harness,
        await makeAccessToken(source)
      );

      expect(state).toBe("unavailable");
      expect(harness.findSnapshot).not.toHaveBeenCalled();
    }
  );

  test.each([
    ["is missing", () => null],
    [
      "has no delivery recipient",
      ({ delivery: _delivery, ...source }: AccountingDocumentSnapshot) =>
        source,
    ],
    [
      "belongs to another reservation",
      (source: AccountingDocumentSnapshot) => ({
        ...source,
        workspaceReservationId: "other-reservation",
      }),
    ],
    [
      "belongs to another customer",
      (source: AccountingDocumentSnapshot) => ({
        ...source,
        dotyposCustomerId: "other-customer",
      }),
    ],
  ] as const)("is unavailable when the snapshot %s", async (_, snapshotOf) => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, {
      snapshot: snapshotOf(source) as AccountingDocumentSnapshot | null,
    });

    const state = await runPostOrderState(
      harness,
      await makeAccessToken(source)
    );

    expect(state).toBe("unavailable");
    expect(harness.findInvoice).not.toHaveBeenCalled();
  });

  test.each([
    [
      "the reservation is a business one",
      { reservation: { reservationPurpose: "business" } },
    ],
    [
      "the snapshot already requested an invoice",
      {
        snapshot: makeSource({
          purpose: "personal",
          invoice: "requested",
          address: personalAddress,
        }),
      },
    ],
    [
      "the snapshot has no billing selection",
      {
        snapshot: (() => {
          const { billing: _billing, ...legacy } = makeSource({
            purpose: "personal",
            invoice: "none",
          });
          return Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)(
            legacy
          );
        })(),
      },
    ],
    [
      "the snapshot buyer is not a person",
      {
        snapshot: Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)({
          ...makeSource({ purpose: "personal", invoice: "none" }),
          buyer: {
            kind: "business",
            legalName: "Synthetic Company s.r.o.",
            companyId: "12345678",
            address: personalAddress,
          },
        }),
      },
    ],
  ] as const)("does not offer creation when %s", async (_, options) => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, {
      reservation: { reservationPurpose: "personal" },
      ...options,
    });

    const state = await runPostOrderState(
      harness,
      await makeAccessToken(source)
    );

    expect(state).toBe("unavailable");
    expect(harness.findInvoice).toHaveBeenCalledTimes(1);
  });

  describe("after the reservation's invoice was cancelled", () => {
    const cancelledInvoice = {
      cancellation: {
        cancelledAt: Temporal.Instant.from("2026-08-14T09:00:00Z"),
        cause: "reservation_cancellation",
        correctiveDocumentNumber: "WS-OD-2026-000001",
      },
    };
    const requestedSource = () =>
      makeSource({
        purpose: "personal",
        invoice: "requested",
        address: personalAddress,
      });

    test("offers creating a replacement where it offered creating the invoice, and never a resend", async () => {
      const source = makeSource({ purpose: "personal", invoice: "none" });
      const harness = makeHarness(source, {
        reservation: { reservationPurpose: "personal" },
        latestInvoice: cancelledInvoice,
      });
      const accessToken = await makeAccessToken(source);

      expect(await runPostOrderState(harness, accessToken)).toBe("create");
      await expect(
        runPostOrderResend(harness, accessToken)
      ).rejects.toMatchObject({ _tag: "PostOrderInvoiceUnavailableError" });
      expect(harness.resend).not.toHaveBeenCalled();
    });

    test("is cancelled, without creation or resend, when the reservation asked for its invoice", async () => {
      const source = requestedSource();
      const harness = makeHarness(source, { latestInvoice: cancelledInvoice });
      const accessToken = await makeAccessToken(source);

      expect(await runPostOrderState(harness, accessToken)).toBe("cancelled");
      for (const request of [runPostOrderCreate, runPostOrderResend]) {
        await expect(request(harness, accessToken)).rejects.toMatchObject({
          _tag: "PostOrderInvoiceUnavailableError",
        });
      }
      expect(harness.issue).not.toHaveBeenCalled();
      expect(harness.resend).not.toHaveBeenCalled();
      expect(harness.findLatestInvoice).toHaveBeenCalledWith(
        source.workspaceReservationId
      );
    });

    test.each(["cancelling", "cancelled"] as const)(
      "is cancelled, without creation, while the reservation is %s",
      async (reservationState) => {
        const source = makeSource({ purpose: "personal", invoice: "none" });
        const harness = makeHarness(source, {
          reservation: { reservationState, reservationPurpose: "personal" },
          latestInvoice: cancelledInvoice,
        });
        const accessToken = await makeAccessToken(source);

        expect(await runPostOrderState(harness, accessToken)).toBe("cancelled");
        await expect(
          runPostOrderCreate(harness, accessToken)
        ).rejects.toMatchObject({ _tag: "PostOrderInvoiceUnavailableError" });
        expect(harness.issue).not.toHaveBeenCalled();
        expect(harness.findSnapshot).not.toHaveBeenCalled();
      }
    );

    test.each([
      [
        "the reservation is cancelled with a live latest invoice",
        {
          reservation: { reservationState: "cancelled" },
          latestInvoice: { cancellation: null },
        },
      ],
      [
        "the reservation is cancelled without an invoice",
        {
          reservation: { reservationState: "cancelled" },
        },
      ],
      [
        "the reservation is in another locale",
        {
          reservation: { reservationState: "cancelled", locale: "cs" },
          latestInvoice: cancelledInvoice,
        },
      ],
    ] as const)("is unavailable when %s", async (_, options) => {
      const source = requestedSource();
      const harness = makeHarness(source, options);

      expect(
        await runPostOrderState(harness, await makeAccessToken(source))
      ).toBe("unavailable");
    });
  });

  test("resends an existing invoice only through the customer resend path", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, { existingInvoice: {} });
    const accessToken = await Effect.runPromise(
      createReservationAccessToken({
        orderId: source.workspaceReservationId,
        locale: "en-US",
      })
    );

    await runPostOrderResend(harness, accessToken);

    expect(harness.resend).toHaveBeenCalledWith({ paymentAttemptId });
    expect(harness.updateBilling).not.toHaveBeenCalled();
    expect(harness.issue).not.toHaveBeenCalled();
  });
});

const issueAfterFulfillment = Effect.fnUntraced(function* (
  harness: ReturnType<typeof makeHarness>
) {
  const service = yield* ReservationInvoiceService;
  yield* service.issueAfterFulfillment({
    reservationId: harness.source?.workspaceReservationId as never,
  });
});

const runProcessing = (harness: ReturnType<typeof makeHarness>) =>
  runWithHarness(harness, issueAfterFulfillment(harness));

/** Runs the issuance with every collaborator call, span and log recorded. */
const traceProcessing = async (harness: ReturnType<typeof makeHarness>) => {
  const trace = startEffectTrace();
  const exit = await runWithHarness(
    {
      ...harness,
      accountingSnapshots: trace.recordCalls(
        "accountingSnapshots",
        harness.accountingSnapshots
      ),
      dotypos: trace.recordCalls("dotypos", harness.dotypos),
      invoices: trace.recordCalls("invoices", harness.invoices),
      deliveries: trace.recordCalls("deliveries", harness.deliveries),
      reservations: trace.recordCalls("reservations", harness.reservations),
    },
    recordEffectTrace(trace, issueAfterFulfillment(harness))
  );
  return { exit, trace: trace.entries };
};

const makeAccessToken = (source: AccountingDocumentSnapshot) =>
  Effect.runPromise(
    createReservationAccessToken({
      orderId: source.workspaceReservationId,
      locale: "en-US",
    })
  );

const runPostOrderState = (
  harness: ReturnType<typeof makeHarness>,
  accessToken: ReservationAccessToken | undefined
) =>
  runWithHarness(
    harness,
    Effect.gen(function* () {
      const service = yield* ReservationInvoiceService;
      return yield* service.getPostOrderState({
        orderId: harness.source?.workspaceReservationId as never,
        locale: "en-US",
        accessToken,
      });
    })
  );

const runPostOrderCreate = (
  harness: ReturnType<typeof makeHarness>,
  accessToken: ReservationAccessToken
) =>
  runWithHarness(
    harness,
    Effect.gen(function* () {
      const service = yield* ReservationInvoiceService;
      return yield* service.createPostOrderInvoice({
        orderId: harness.source?.workspaceReservationId as never,
        locale: "en-US",
        accessToken,
        address: personalAddress,
      });
    })
  );

const runPostOrderResend = (
  harness: ReturnType<typeof makeHarness>,
  accessToken: ReservationAccessToken
) =>
  runWithHarness(
    harness,
    Effect.gen(function* () {
      const service = yield* ReservationInvoiceService;
      yield* service.resendPostOrderInvoice({
        orderId: harness.source?.workspaceReservationId as never,
        locale: "en-US",
        accessToken,
      });
    })
  );

const runWithHarness = <A, E>(
  harness: ReturnType<typeof makeHarness>,
  effect: Effect.Effect<A, E, ReservationInvoiceService>
) =>
  effect.pipe(
    Effect.provide(
      ReservationInvoiceService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(
              AccountingDocumentSnapshots,
              harness.accountingSnapshots
            ),
            Layer.mock(DotyposService, harness.dotypos),
            Layer.mock(InvoiceRepository, harness.invoices),
            Layer.mock(InvoiceEmailDeliveryService, harness.deliveries),
            Layer.mock(WorkspaceReservationRepository, harness.reservations)
          )
        )
      )
    ),
    Effect.runPromise
  );

const makeHarness = (
  source: AccountingDocumentSnapshot | null,
  options: {
    readonly billingFailure?: DotyposVersionConflict;
    readonly reconcileBillingFailure?: DotyposVersionConflict;
    readonly existingInvoice?: object;
    /** The reservation's latest invoice, cancelled or not. */
    readonly latestInvoice?: object;
    readonly issuedInvoice?: object;
    readonly issueChanged?: boolean;
    readonly deliveryFailure?: InstanceType<typeof InvoiceEmailDeliveryError>;
    readonly reservation?: object | null;
    readonly snapshot?: AccountingDocumentSnapshot | null;
  } = {}
) => {
  const issue = mock(() =>
    Effect.succeed({
      invoice: (options.issuedInvoice ?? {}) as never,
      changed: options.issueChanged ?? true,
    })
  );
  const deliver = mock(() =>
    options.deliveryFailure
      ? Effect.fail(options.deliveryFailure)
      : Effect.succeed({ status: "delivered" as const, changed: true })
  );
  let billingUpdates = 0;
  const updateBilling = mock(() => {
    billingUpdates += 1;
    const failure =
      billingUpdates === 1
        ? options.billingFailure
        : (options.reconcileBillingFailure ?? options.billingFailure);
    return failure ? Effect.fail(failure) : Effect.void;
  });
  const findReservation = mock(() =>
    Effect.succeed(
      source && options.reservation !== null
        ? ({
            id: source.workspaceReservationId,
            locale: source.locale,
            paymentState: "paid",
            reservationState: "confirmed",
            fulfillmentState: "fulfilled",
            fulfilledAt: Temporal.Instant.from("2026-08-13T12:00:00Z"),
            activePaymentAttemptId: paymentAttemptId,
            reservationPurpose: source.billing?.purpose ?? null,
            dotyposCustomerId: source.dotyposCustomerId,
            ...options.reservation,
          } as never)
        : null
    )
  );
  const resend = mock(() =>
    Effect.succeed({ status: "delivered" as const, changed: true })
  );

  const findSnapshot = mock(() =>
    Effect.succeed(options.snapshot === undefined ? source : options.snapshot)
  );
  const findInvoice = mock(() =>
    Effect.succeed((options.existingInvoice ?? null) as never)
  );
  const findLatestInvoice = mock(() =>
    Effect.succeed(
      (options.latestInvoice ?? options.existingInvoice ?? null) as never
    )
  );

  return {
    accountingSnapshots: {
      find: findSnapshot,
    },
    invoices: {
      findLiveByPaymentAttemptId: findInvoice,
      findLatestByReservationId: findLatestInvoice,
      issue,
    },
    dotypos: {
      updateCustomerBillingDetails: updateBilling,
    },
    deliveries: {
      deliverByPaymentAttemptId: deliver,
      resendCustomerByPaymentAttemptId: resend,
    },
    reservations: { findById: findReservation },
    source,
    findReservation,
    findSnapshot,
    findInvoice,
    findLatestInvoice,
    updateBilling,
    issue,
    deliver,
    resend,
  };
};

const makeSource = (
  billing: NonNullable<AccountingDocumentSnapshot["billing"]>
): AccountingDocumentSnapshot => {
  const document = makeCoworkInvoiceDocument("en-US");
  const {
    fulfilledAt: _fulfilledAt,
    invoiceNumber: _invoiceNumber,
    issuedAt: _issuedAt,
    paidAt: _paidAt,
    paymentAttemptId: _paymentAttemptId,
    supplier: invoiceSupplier,
    ...identity
  } = document;
  const { commercialRegister: _commercialRegister, ...supplier } =
    invoiceSupplier;

  return Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)({
    ...identity,
    supplier,
    billing,
    delivery: { email: testEmailAddress("synthetic") },
  });
};
