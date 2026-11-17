import { Schema } from "effect";

export const orderKinds = ["reservation"] as const;

export const orderKindSchema = Schema.Literals(orderKinds).annotate({
  identifier: "OrderKind",
  description: "The fulfillment family of a Deskohub order.",
});

export type OrderKind = typeof orderKindSchema.Type;

export const orderPaymentStates = [
  "not_started",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
] as const;

export type OrderPaymentState = (typeof orderPaymentStates)[number];

/**
 * The payment states of an order whose payment ended without being paid. Only
 * a payment retry pays it again, and that retry moves it on from them.
 */
export const endedUnpaidPaymentStates = [
  "failed",
  "cancelled",
  "expired",
] as const satisfies readonly OrderPaymentState[];

export const isEndedUnpaidPaymentState = (state: string): boolean =>
  endedUnpaidPaymentStates.some((ended) => ended === state);

export const orderFulfillmentStates = [
  "not_started",
  "processing",
  "awaiting_delivery",
  "fulfilled",
  "failed",
] as const;

export type OrderFulfillmentState = (typeof orderFulfillmentStates)[number];

export const orderIdSchema = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("OrderId"))
  .annotate({
    identifier: "OrderId",
    description: "Database-generated identifier of one persisted order.",
  });

export type OrderId = typeof orderIdSchema.Type;
