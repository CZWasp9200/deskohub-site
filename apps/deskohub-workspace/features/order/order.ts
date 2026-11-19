import { Schema } from "effect";

/**
 * What an order commits to: one reservation, or one pass purchase. A pass
 * purchase pays for a pass rather than a reservation.
 */
export const orderKinds = ["reservation", "pass-purchase"] as const;

export const orderKindSchema = Schema.Literals(orderKinds).annotate({
  identifier: "OrderKind",
  description: "What a Deskohub order commits to.",
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
