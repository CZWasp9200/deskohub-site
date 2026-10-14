import { describe, expect, test } from "bun:test";
import { NexiOperationIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import type { AdministrationPaymentAttempt } from "./administration.service";
import type { AdministrationOrder } from "./payment-administration.service";
import {
  buildPaymentAttemptTimeline,
  getOrderTimeline,
} from "./payment-timeline";

const providerOrderId = NexiOrderIdSchema.make("synthetic-order");

const refundedAttempt: AdministrationPaymentAttempt = {
  id: paymentAttemptIdSchema.make("synthetic-payment"),
  state: "paid",
  refundState: "refunded",
  providerOrderId,
  providerLabel: "Online payment",
  stateLabel: "Paid",
  failureCode: null,
  amount: { value: 35_000, exponent: 2, currency: "CZK" },
  refundedAmount: { value: 35_000, exponent: 2, currency: "CZK" },
  refundedAt: "2026-10-05T08:30:00Z",
  createdAt: "2026-10-01T10:00:00Z",
  providerOrderCreatedAt: "2026-10-01T10:00:01Z",
  updatedAt: "2026-10-05T08:30:00Z",
};

const orderWithBackOfficeRefund: AdministrationOrder = {
  orderId: providerOrderId,
  provider: {
    orderId: providerOrderId,
    operations: [
      {
        operationId: NexiOperationIdSchema.make("synthetic-capture"),
        operationType: "CAPTURE",
        operationResult: "EXECUTED",
        operationTime: "2026-10-01T10:02:00Z",
        amount: "35000",
      },
      {
        operationId: NexiOperationIdSchema.make("synthetic-refund"),
        operationType: "REFUND",
        operationResult: "VOIDED",
        operationTime: "2026-10-05T08:30:00Z",
        amount: "35000",
      },
    ],
  },
  providerAvailable: true,
  providerStatus: "available",
  link: null,
};

const orderUnavailable: AdministrationOrder = {
  orderId: providerOrderId,
  provider: null,
  providerAvailable: false,
  providerStatus: "unavailable",
  link: null,
};

const titles = (items: readonly { readonly title: string }[]) =>
  items.map(({ title }) => title);

describe("payment timeline", () => {
  test("shows a back-office refund once, as the Nexi refund operation", () => {
    const orders = [orderWithBackOfficeRefund];

    expect(
      titles([
        ...buildPaymentAttemptTimeline([refundedAttempt], orders),
        ...getOrderTimeline(orders),
      ])
    ).toEqual([
      "Payment started",
      "Payment executed by Nexi",
      "Refund reported by Nexi",
    ]);
  });

  test("falls back to the recorded refund when the Nexi refund time is unreadable", () => {
    const provider = orderWithBackOfficeRefund.provider;
    if (!provider) throw new Error("fixture order has provider details");
    const orders: AdministrationOrder[] = [
      {
        ...orderWithBackOfficeRefund,
        provider: {
          ...provider,
          operations: provider.operations.map((operation) =>
            operation.operationType === "REFUND"
              ? { ...operation, operationTime: "not a timestamp" }
              : operation
          ),
        },
      },
    ];

    expect(
      titles([
        ...buildPaymentAttemptTimeline([refundedAttempt], orders),
        ...getOrderTimeline(orders),
      ])
    ).toEqual([
      "Payment started",
      "Refund recorded",
      "Payment executed by Nexi",
    ]);
  });

  test("falls back to the recorded refund when Nexi order details are unavailable", () => {
    const orders = [orderUnavailable];

    expect(
      titles([
        ...buildPaymentAttemptTimeline([refundedAttempt], orders),
        ...getOrderTimeline(orders),
      ])
    ).toEqual(["Payment started", "Refund recorded"]);
  });
});
