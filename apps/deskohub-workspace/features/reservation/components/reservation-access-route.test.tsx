import "@/shared/polyfills/temporal";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { prerender } from "react-dom/static";
import type { OrderKind } from "@/features/order";

mock.module("server-only", () => ({}));
const nextServer = await import("next/server");
mock.module("next/server", () => ({
  ...nextServer,
  connection: () => Promise.resolve(),
}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

/** What `notFound` throws. */
class NotFoundSignal extends Error {}
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  notFound: () => {
    throw new NotFoundSignal("Not found");
  },
}));

const nextHeaders = await import("next/headers");
mock.module("next/headers", () => ({
  ...nextHeaders,
  cookies: () => Promise.resolve({ get: () => undefined }),
  headers: () => Promise.resolve(new Headers()),
}));

let orderKind: OrderKind | undefined = "reservation";
const orderKindReads: string[] = [];
mock.module("@/features/order/backend/order-kind", () => ({
  loadOrderKind: async (id: string) => {
    orderKindReads.push(id);
    return orderKind;
  },
}));

const accessReads: string[] = [];
const accessService = {
  getAccess: ({ orderId }: { readonly orderId: string }) =>
    Effect.sync(() => {
      accessReads.push(orderId);
      return { state: "unavailable" };
    }),
};
class ReservationAccessService extends Context.Service<
  ReservationAccessService,
  typeof accessService
>()("@deskohub-workspace/reservation/ReservationAccessService") {
  static Live = Layer.succeed(this, accessService);
}
mock.module(
  "@/features/reservation/backend/reservation-access.service",
  () => ({
    ReservationAccessService,
  })
);

mock.module(
  "@/features/reservation/components/reservation-access-page",
  () => ({
    ReservationAccessPage: ({
      access,
      orderId,
    }: {
      readonly access: { readonly state: string };
      readonly orderId: string;
    }) => <section data-access={access.state} data-order={orderId} />,
  })
);

const { ReservationAccessRoute } = await import("./reservation-access-route");

const orderId = "reservation-access-route";

const renderRoute = async (order = orderId) => {
  const errors: unknown[] = [];
  const { prelude } = await prerender(
    await ReservationAccessRoute({
      params: Promise.resolve({ orderId: order }),
    }),
    {
      onError: (error) => {
        errors.push(error);
      },
    }
  );
  return { errors, html: await new Response(prelude).text() };
};

describe("ReservationAccessRoute", () => {
  afterEach(() => {
    orderKind = "reservation";
    orderKindReads.length = 0;
    accessReads.length = 0;
  });

  test("serves the reservation access page for a reservation order", async () => {
    const { errors, html } = await renderRoute();

    expect(errors).toEqual([]);
    expect(orderKindReads).toEqual([orderId]);
    expect(accessReads).toEqual([orderId]);
    expect(html).toContain(`data-order="${orderId}"`);
  });

  test("serves the reservation access page for an order id no order has", async () => {
    orderKind = undefined;

    const { errors, html } = await renderRoute();

    expect(errors).toEqual([]);
    expect(accessReads).toEqual([orderId]);
    expect(html).toContain('data-access="unavailable"');
  });

  test("answers a pass purchase order with not found without reading reservation access", async () => {
    orderKind = "pass-purchase";

    const { errors } = await renderRoute();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(NotFoundSignal);
    expect(accessReads).toEqual([]);
  });

  test("answers an invalid order id with not found before reading the order", async () => {
    const { errors } = await renderRoute("");

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(NotFoundSignal);
    expect(orderKindReads).toEqual([]);
    expect(accessReads).toEqual([]);
  });
});
