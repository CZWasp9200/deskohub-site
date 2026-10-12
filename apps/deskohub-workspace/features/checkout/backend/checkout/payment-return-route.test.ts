import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { checkoutPaymentReturnGet } from "./checkout-payment-return-route.server";

const invoke = (
  search = "",
  params = { locale: "en-US", orderId: "order-id" }
) =>
  checkoutPaymentReturnGet(
    new Request(
      `https://deskohub.test/en-US/checkout/pay/return/order-id${search}`
    ),
    { params: Promise.resolve(params) }
  );

describe("checkout pay return route", () => {
  test("hands a cookie-less provider return to the protected status page", async () => {
    const response = await invoke("?paymentid=synthetic-payment");

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://deskohub.test/en-US/reservation/status/order-id"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.text()).toBe("");
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  test("preserves explicit return outcomes for status reconciliation", async () => {
    for (const outcome of ["success", "cancelled"]) {
      const response = await invoke(`?outcome=${outcome}`);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `https://deskohub.test/en-US/reservation/status/order-id?outcome=${outcome}`
      );
    }
  });

  test("discards unknown outcomes and provider query parameters", async () => {
    const response = await invoke(
      "?outcome=untrusted&paymentid=synthetic-payment&redirectUrl=https://elsewhere.test&accessToken=untrusted"
    );

    expect(response.headers.get("location")).toBe(
      "https://deskohub.test/en-US/reservation/status/order-id"
    );
  });

  test("rejects invalid route params", async () => {
    for (const params of [
      { locale: "en-US", orderId: "" },
      { locale: "sk-SK", orderId: "order-id" },
    ]) {
      const response = await invoke("", params);
      expect(response.status).toBe(404);
    }
  });
});
