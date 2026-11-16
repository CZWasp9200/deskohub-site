import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  CheckoutPaymentPageService,
  type PaymentPageReopening,
  type PaymentPageReopeningInput,
} from "@/features/checkout/backend/checkout/checkout-payment-page.service";
import { getReservationAccessCookieName } from "@/features/reservation/backend/reservation-access-cookie";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { mockWorkspaceActionRequest } from "@/shared/testing/workspace-action-request.test-utils";

mock.module("server-only", () => ({}));

const request = await mockWorkspaceActionRequest();
const { reopenPaymentPageForVisitor, reopenPaymentPageSchema } = await import(
  "./reopen-payment-page.server"
);

const orderId = "reservation-reopen-action" as WorkspaceReservationId;

/** What a client may send, including fields the action must ignore. */
type ClientInput = {
  readonly orderId: string;
  readonly locale: string;
  readonly providerRedirectUrl?: string;
  readonly returnTarget?: { readonly kind: string };
};

const reopenWith = async (
  input: ClientInput,
  answer: PaymentPageReopening = { state: "not_found" }
) => {
  const reopen = mock((_input: PaymentPageReopeningInput) =>
    Effect.succeed(answer)
  );
  const validated = await reopenPaymentPageSchema["~standard"].validate(input);
  if (validated.issues) throw new Error("The reopening input was rejected");
  const result = await Effect.runPromise(
    reopenPaymentPageForVisitor(validated.value).pipe(
      Effect.provide(Layer.succeed(CheckoutPaymentPageService, { reopen }))
    )
  );
  return { reopen, result };
};

describe("reopening a payment page from the status page", () => {
  beforeEach(() => {
    request.reset();
  });

  test("asks the service with the order's access cookie and the page locale", async () => {
    request.setCookie(getReservationAccessCookieName(orderId), "access-cookie");

    const { reopen } = await reopenWith({ orderId, locale: "cs-CZ" });

    expect(reopen).toHaveBeenCalledTimes(1);
    expect(reopen.mock.calls[0]?.[0]).toEqual({
      accessCookie: "access-cookie",
      locale: "cs-CZ",
      orderId,
    });
  });

  test("asks without a cookie when the visitor holds none for the order", async () => {
    request.setCookie(
      getReservationAccessCookieName("another-order" as WorkspaceReservationId),
      "other-cookie"
    );

    const { reopen } = await reopenWith({ orderId, locale: "en-US" });

    expect(reopen.mock.calls[0]?.[0].accessCookie).toBeUndefined();
  });

  test("never takes a payment page URL or return target from the client", async () => {
    const { reopen } = await reopenWith({
      orderId,
      locale: "en-US",
      providerRedirectUrl: "https://attacker.example.test/pay",
      returnTarget: { kind: "app" },
    });

    expect(Object.keys(reopen.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      "accessCookie",
      "locale",
      "orderId",
    ]);
  });

  test.each<PaymentPageReopening>([
    { state: "opened", providerRedirectUrl: "https://payments.example.test" },
    { state: "not_found" },
    { state: "closed", reason: "window_elapsed" },
  ])("returns the service's $state answer", async (answer) => {
    const { result } = await reopenWith({ orderId, locale: "en-US" }, answer);

    expect(result).toEqual(answer);
  });

  test.each([
    { orderId: "", locale: "en-US" },
    { orderId, locale: "xx-XX" },
    { locale: "en-US" },
  ])("rejects an incomplete or foreign input", async (input) => {
    const validated =
      await reopenPaymentPageSchema["~standard"].validate(input);

    expect(validated.issues?.length).toBeGreaterThan(0);
  });
});
