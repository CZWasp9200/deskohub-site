import "@/shared/polyfills/temporal";
import { ReservationInvitees } from "@/features/reservation-invitees/backend/reservation-invitees.service";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { makeAccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import { AccountingDocumentSnapshots } from "@/features/accounting/backend/accounting-document-snapshots";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import {
  canonicalPromotionCodeSchema,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { ReservationBillingSelection } from "@/features/reservation/reservation-billing";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import { PaymentRetryHoldService } from "../holds/payment-retry-hold.service";
import { AttemptPromotionCodesRepository } from "../repositories/attempt-promotion-codes.repository";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import {
  type PaymentAttempt,
  PaymentAttemptRepository,
} from "../repositories/payment-attempt.repository";
import {
  CheckoutPaymentRetryService,
  type PaymentRetryPreparation,
} from "./checkout-payment-retry.service";
import { CheckoutPricingService } from "./checkout-pricing.service";
import {
  paymentPricingFrom,
  type RepricedPayment,
} from "./checkout-pricing.service.mock";
import { PayState } from "./pay-state";
import { getPayStateBinding } from "./pay-state-contract";
import {
  PaymentRetryProviderCheck,
  type PaymentRetryProviderState,
} from "./payment-retry-provider-check";
import { PaymentRetryUnavailableError } from "./payment-retry-unavailable";

const orderId = workspaceReservationIdSchema.make("retry-order-id");
const retriedAttemptId = paymentAttemptIdSchema.make("retried-attempt-id");
const customerEmail = testEmailAddress("retry-customer");
const accountEmail = testEmailAddress("retry-account");
const holdExpiresAt = Temporal.Now.instant().add({ minutes: 10 });

const order = { entryTier: "open-space", coffee: true } as const;
const quote = buildCoworkReservationQuote(order);

const snapshotFor = (input: {
  readonly date?: string;
  readonly deliveryEmail?: string;
  readonly billing?: ReservationBillingSelection;
}) =>
  makeAccountingDocumentSnapshot({
    workspaceReservationId: orderId,
    dotyposReservationId: "dotypos-reservation-id" as never,
    dotyposCustomerId: "dotypos-customer-id" as never,
    locale: "en-US",
    prepared: {
      kind: "cowork",
      reservation: {
        kind: "cowork",
        ...order,
        date: input.date ?? "2099-01-01",
        name: "Ada Lovelace",
        email: input.deliveryEmail ?? customerEmail,
        phone: "+420700000000",
        billing: input.billing ?? { purpose: "personal", invoice: "none" },
      },
      quote,
    } as never,
  });

const row = (overrides: Partial<WorkspaceReservation> = {}) =>
  ({
    id: orderId,
    correlationId: "correlation-id",
    checkoutSessionKey: "checkout-session-key",
    authorAccountId: "author-account-id",
    dotyposCustomerId: "dotypos-customer-id",
    reservationDetails: { kind: "cowork", ...order },
    officeContactAttends: null,
    reservationState: "held",
    paymentState: "failed",
    activePaymentAttemptId: retriedAttemptId,
    reservationHoldExpiresAt: holdExpiresAt,
    ...overrides,
  }) as WorkspaceReservation;

const attempt = (overrides: Partial<PaymentAttempt> = {}) =>
  ({
    id: retriedAttemptId,
    workspaceReservationId: orderId,
    state: "failed",
    providerOrderId: "provider-order-id",
    ...overrides,
  }) as PaymentAttempt;

type Harness = {
  readonly authorized?: boolean;
  readonly stored?: WorkspaceReservation;
  readonly current?: WorkspaceReservation | null;
  readonly newest?: PaymentAttempt | null;
  readonly recovery?: boolean;
  readonly snapshot?: ReturnType<typeof snapshotFor> | null;
  readonly provider?: PaymentRetryProviderState;
  readonly customer?: {
    readonly email?: string;
    readonly phone?: string | null;
  };
  /** The author's account links the order's own customer. */
  readonly accountOrder?: boolean;
  readonly hold?: Effect.Success<
    ReturnType<PaymentRetryHoldService["Service"]["secure"]>
  >;
  readonly enteredCode?: string;
  readonly reprice?: (quote: RepricedPayment["quote"]) => RepricedPayment;
  readonly codeUnavailable?: boolean;
  /** The bounds of the order's Dotypos reservation; undefined fails the read. */
  readonly dotyposBounds?: {
    readonly startDate: string;
    readonly endDate: string;
  };
};

const runPrepare = (harness: Harness = {}) => {
  const stored = harness.stored ?? row();
  const secure = mock(() =>
    Effect.succeed(
      harness.hold ?? {
        kind: "kept" as const,
        reservation: { ...stored, activePaymentAttemptId: null },
      }
    )
  );
  const applyDiscountCode = mock((input: { readonly quote: unknown }) =>
    harness.codeUnavailable
      ? Effect.fail({ _tag: "PromotionCodeUnavailableError" } as never)
      : Effect.succeed({
          status: "affirmed",
          priced: {
            ...(input as object),
            submittedCodeDiscountId: discountIdSchema.make("code-discount"),
          },
        } as never)
  );
  const pricing = paymentPricingFrom((input) =>
    Effect.succeed({
      quote: harness.reprice?.(input.quote as never).quote ?? input.quote,
      commitment: {},
    } as never)
  );
  const layer = CheckoutPaymentRetryService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ReservationAuthorizationService, {
          authorize: () => Effect.succeed(harness.authorized ?? true),
        }),
        Layer.mock(ReservationInvitees, {
          findBookedPeople: () => Effect.succeed(Option.none()),
        }),
        Layer.mock(WorkspaceReservationRepository, {
          findById: () => Effect.succeed(stored),
          findCurrentByCheckoutSessionKey: () =>
            Effect.succeed(
              harness.current === undefined ? stored : harness.current
            ),
        }),
        Layer.mock(PaymentAttemptRepository, {
          findNewestForReservation: () =>
            Effect.succeed(
              harness.newest === undefined ? attempt() : harness.newest
            ),
        }),
        Layer.mock(LatePaymentRecoveryRepository, {
          findLatestByWorkspaceReservationId: () =>
            Effect.succeed(harness.recovery ? ({} as never) : null),
        }),
        Layer.mock(AccountingDocumentSnapshots, {
          find: () =>
            Effect.succeed(
              harness.snapshot === undefined
                ? snapshotFor({})
                : harness.snapshot
            ),
        }),
        Layer.mock(AttemptPromotionCodesRepository, {
          find: () =>
            Effect.succeed(
              harness.enteredCode
                ? {
                    enteredCode: canonicalPromotionCodeSchema.make(
                      harness.enteredCode
                    ),
                  }
                : {}
            ),
        }),
        Layer.mock(CustomerAccountLinkRepository, {
          find: () =>
            Effect.succeed(
              harness.accountOrder ? stored.dotyposCustomerId : null
            ),
          findActivityState: () =>
            Effect.succeed({
              kind: "active",
              email: accountEmail,
              deletionRequestedAt: null,
            } as const),
        }),
        Layer.mock(DotyposService, {
          getCustomer: () =>
            Effect.succeed(
              Option.some({
                firstName: "Ada",
                lastName: "Lovelace",
                email: harness.customer?.email ?? customerEmail,
                phone:
                  harness.customer?.phone === undefined
                    ? "+420700000000"
                    : harness.customer.phone,
              } as never)
            ),
          getReservationWithoutCustomer: () =>
            harness.dotyposBounds
              ? Effect.succeed({
                  ...harness.dotyposBounds,
                  seats: "1",
                } as never)
              : Effect.fail({ _tag: "DotyposError" } as never),
        }),
        Layer.mock(PaymentRetryProviderCheck, {
          check: () => Effect.succeed(harness.provider ?? "ended_unpaid"),
        }),
        Layer.mock(PaymentRetryHoldService, { secure }),
        Layer.mock(CheckoutPricingService, {
          ...pricing,
          applyDiscountCode: applyDiscountCode as never,
        }),
        TestSealedStateKeys
      )
    )
  );
  const result = CheckoutPaymentRetryService.pipe(
    Effect.flatMap((service) => service.prepare({ orderId, locale: "en-US" })),
    Effect.provide(layer),
    Effect.runPromise
  );
  return { result, secure, applyDiscountCode };
};

const openReady = async (preparation: PaymentRetryPreparation) => {
  if (preparation.state !== "ready") {
    throw new Error(`expected a ready retry, got ${preparation.state}`);
  }
  return {
    preparation,
    state: await PayState.open(preparation.payState.freshPayStateToken).pipe(
      Effect.provide(TestSealedStateKeys),
      Effect.runPromise
    ),
  };
};

describe("CheckoutPaymentRetryService.prepare", () => {
  test("issues an order-bound Pay state on the secured hold, asking for the terms again", async () => {
    const { result, secure } = runPrepare();
    const { preparation, state } = await openReady(await result);

    expect(secure).toHaveBeenCalledTimes(1);
    expect(getPayStateBinding(state)).toEqual({
      kind: "order",
      retriedAttemptId,
    });
    expect(state.checkoutSessionId).toBeUndefined();
    expect(state.changedKeys).toBeUndefined();
    expect(state.orderId).toBe(orderId);
    expect(state.reservation).toMatchObject({
      kind: "cowork",
      date: "2099-01-01",
      name: "Ada Lovelace",
      email: customerEmail,
      billing: { purpose: "personal", invoice: "none" },
    });
    expect(Temporal.Instant.from(state.holdExpiresAt!).epochMilliseconds).toBe(
      holdExpiresAt.epochMilliseconds
    );
    expect(preparation.checkout.changedKeys).toBeUndefined();
    expect(preparation.checkout.orderId).toBe(orderId);
  });

  test("asks to accept a price that changed since the ended payment", async () => {
    const { result } = runPrepare({
      reprice: (signed) => ({
        quote: {
          ...signed,
          fingerprint: "repriced",
          payment: {
            ...signed.payment,
            expectedPrice: {
              ...signed.payment.expectedPrice,
              value: signed.payment.expectedPrice.value + 1000,
            },
          },
        } as never,
        commitment: {} as never,
      }),
    });
    const { preparation, state } = await openReady(await result);

    expect(state.changedKeys).toBeDefined();
    expect(preparation.checkout.changedKeys).toBeDefined();
    expect(getPayStateBinding(state)?.kind).toBe("order");
  });

  test("applies again the code the ended payment was priced with", async () => {
    const { result, applyDiscountCode } = runPrepare({ enteredCode: "SPRING" });
    const { state } = await openReady(await result);

    expect(applyDiscountCode).toHaveBeenCalledTimes(1);
    expect(state.submittedCode).toBe("SPRING");
    expect(state.changedKeys).toBeUndefined();
  });

  test("leaves out a code that no longer applies, through the ordinary affirmation", async () => {
    const { result } = runPrepare({
      enteredCode: "SPRING",
      codeUnavailable: true,
    });
    const { state } = await openReady(await result);

    expect(state.submittedCode).toBeUndefined();
  });

  test("books an account's own order with the account's login email", async () => {
    const { result } = runPrepare({
      accountOrder: true,
      customer: { email: testEmailAddress("dotypos-record") },
      snapshot: snapshotFor({ deliveryEmail: accountEmail }),
    });
    const { preparation, state } = await openReady(await result);

    expect(state.reservation.email).toBe(accountEmail);
    expect(preparation.details).toEqual({
      bookingFor: "self",
      contact: { name: "Ada Lovelace", email: accountEmail },
      billing: { purpose: "personal", invoice: "none" },
    });
  });

  test("keeps the details of an order booked for someone else, invoiced to a company", async () => {
    const billing = {
      purpose: "business",
      invoice: "required",
      buyer: {
        kind: "business",
        legalName: "Analytical Engines s.r.o.",
        companyId: "27074358",
        vatId: "CZ27074358",
        address: {
          line1: "Na Pankráci 1",
          city: "Praha",
          postalCode: "140 00",
          country: "CZ",
        },
      },
    } as const satisfies ReservationBillingSelection;
    const { result } = runPrepare({ snapshot: snapshotFor({ billing }) });
    const { preparation, state } = await openReady(await result);

    expect(preparation.details).toEqual({
      bookingFor: "someone-else",
      contact: { name: "Ada Lovelace", email: customerEmail },
      billing,
    });
    expect(state.reservation.billing).toEqual(billing);
  });

  test.each<[string, Harness, PaymentRetryPreparation]>([
    [
      "an order the visitor may not see",
      { authorized: false },
      { state: "not_found" },
    ],
    [
      "a paid order",
      { stored: row({ paymentState: "paid" }) },
      { state: "not_retryable", reason: "paid" },
    ],
    [
      "an order whose late payment is being recovered",
      { recovery: true },
      { state: "not_retryable", reason: "late_payment" },
    ],
    [
      "an order whose payment is still under way",
      {
        stored: row({ paymentState: "pending" }),
        newest: attempt({ state: "pending" }),
      },
      { state: "not_retryable", reason: "payment_in_progress" },
    ],
    [
      "an order whose active attempt isn't its newest",
      { newest: attempt({ id: paymentAttemptIdSchema.make("other-attempt") }) },
      { state: "not_retryable", reason: "needs_review" },
    ],
    [
      "an order a newer submission replaced",
      { current: row({ id: workspaceReservationIdSchema.make("newer") }) },
      { state: "not_retryable", reason: "superseded" },
    ],
    [
      "an order without the accepted snapshot",
      { snapshot: null },
      { state: "not_retryable", reason: "details_unavailable" },
    ],
    [
      "a reservation that has ended",
      { snapshot: snapshotFor({ date: "2020-01-01" }) },
      { state: "not_retryable", reason: "reservation_ended" },
    ],
    [
      "a contact whose email isn't the one the order's documents go to",
      { customer: { email: testEmailAddress("someone-else") } },
      { state: "not_retryable", reason: "details_unavailable" },
    ],
    [
      "a contact without a phone",
      { customer: { phone: null } },
      { state: "not_retryable", reason: "details_unavailable" },
    ],
    [
      "an attempt without a provider order",
      { provider: "no_provider_order" },
      { state: "not_retryable", reason: "needs_review" },
    ],
    [
      "a reservation the hold service won't book again",
      { hold: { kind: "refused", reason: "not_retryable" } },
      { state: "not_retryable", reason: "reservation_cancelled" },
    ],
    [
      "a hold Dotypos keeps for an operator",
      { hold: { kind: "refused", reason: "release_refused" } },
      { state: "not_retryable", reason: "needs_review" },
    ],
    [
      "a spot taken after the hold was released",
      { hold: { kind: "spot_unavailable" } },
      { state: "spot_unavailable" },
    ],
  ])("refuses %s", async (_name, harness, expected) => {
    const { result } = runPrepare(harness);

    expect(await result).toEqual(expected);
  });

  test("never touches the hold while the provider shows money may still move", async () => {
    const { result, secure } = runPrepare({ provider: "may_settle" });

    expect(await result).toEqual({ state: "payment_settling" });
    expect(secure).not.toHaveBeenCalled();
  });

  test("never secures a hold for an order it can't rebuild", async () => {
    const { result, secure } = runPrepare({ customer: { phone: null } });

    await result;
    expect(secure).not.toHaveBeenCalled();
  });

  test("books an overnight Reserved Desk again as an overnight stay", async () => {
    const { result, secure } = runPrepare({
      stored: row({
        reservationDetails: {
          kind: "cowork",
          entryTier: "reserved-desk",
          coffee: true,
        },
        dotyposReservationId: "dotypos-reservation-id" as never,
      }),
      // Prague winter time (UTC+1): noon on 2099-01-01 to noon on 2099-01-02.
      dotyposBounds: {
        startDate: "2099-01-01T11:00:00Z",
        endDate: "2099-01-02T11:00:00Z",
      },
    });
    const { state } = await openReady(await result);

    expect(secure).toHaveBeenCalledWith(
      expect.objectContaining({
        recreated: expect.objectContaining({
          reservation: expect.objectContaining({ stay: "overnight" }),
        }),
      })
    );
    expect(state.reservation).toMatchObject({
      entryTier: "reserved-desk",
      stay: "overnight",
    });
  });

  test("fails as unavailable, to ask again, while the order's Dotypos reservation can't be read", async () => {
    const { result, secure } = runPrepare({
      stored: row({
        reservationDetails: {
          kind: "cowork",
          entryTier: "reserved-desk",
          coffee: true,
        },
        dotyposReservationId: "dotypos-reservation-id" as never,
      }),
    });

    await expect(result).rejects.toBeInstanceOf(PaymentRetryUnavailableError);
    expect(secure).not.toHaveBeenCalled();
  });

  test("fails as unavailable, to ask again, while another run releases the hold", async () => {
    const { result } = runPrepare({
      hold: { kind: "refused", reason: "release_in_progress" },
    });

    await expect(result).rejects.toBeInstanceOf(PaymentRetryUnavailableError);
  });
});
