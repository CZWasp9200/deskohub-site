import type {
  NexiOperationId,
  NexiOrderId,
  NexiWebhookEventId,
} from "@deskohub/nexi";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import { paymentAttempts } from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { OrderId } from "@/features/order";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { Money } from "@/shared/money/money";
import type { NonTerminalPaymentAttemptState } from "./payment-lifecycle-state";

type NewPaymentAttempt = {
  readonly orderId: OrderId;
  readonly workspaceReservationId: WorkspaceReservationId | null;
  readonly amount: Money;
} & (
  | { readonly provider: "nexi"; readonly providerOrderId: NexiOrderId }
  | { readonly provider: "internal"; readonly paidAt: Temporal.Instant }
);

/** The order handler owns admission, its claims, and the surrounding transaction. */
export const insertPaymentAttempt = Effect.fn("paymentAttempts.insert")(
  function* (input: NewPaymentAttempt) {
    const { db } = yield* WorkspaceTransaction;
    const [attempt] = yield* db
      .insert(paymentAttempts)
      .values({
        id: postgresUuidV7,
        orderId: input.orderId,
        workspaceReservationId: input.workspaceReservationId,
        amountValue: input.amount.value,
        amountExponent: input.amount.exponent,
        currency: input.amount.currency,
        ...(input.provider === "nexi"
          ? {
              provider: "nexi",
              providerOrderId: input.providerOrderId,
              state: "created",
            }
          : {
              provider: "internal",
              state: "paid",
              createdAt: input.paidAt,
              updatedAt: input.paidAt,
            }),
      })
      .returning();
    if (!attempt)
      return yield* Effect.die("Payment attempt insert returned no row.");
    return attempt;
  }
);

type AttemptSettlement = {
  readonly orderId: OrderId;
  readonly id: PaymentAttemptId;
  readonly webhookEventId?: NexiWebhookEventId;
  readonly providerOperationId?: NexiOperationId;
  readonly providerStatus?: string;
};

export const markPaymentAttemptPaid = Effect.fn("paymentAttempts.markPaid")(
  function* (input: AttemptSettlement & { readonly paidAt: Temporal.Instant }) {
    const { db } = yield* WorkspaceTransaction;
    const [attempt] = yield* db
      .update(paymentAttempts)
      .set({
        state: "paid",
        lastWebhookEventId: input.webhookEventId,
        lastProviderOperationId: input.providerOperationId,
        lastProviderStatus: input.providerStatus,
        failureCode: null,
        updatedAt: input.paidAt,
      })
      .where(
        and(
          eq(paymentAttempts.orderId, input.orderId),
          eq(paymentAttempts.id, input.id),
          inArray(paymentAttempts.state, ["created", "pending", "paid"])
        )
      )
      .returning();
    return attempt;
  }
);

export const markPaymentAttemptTerminal = Effect.fn(
  "paymentAttempts.markTerminal"
)(function* (
  input: AttemptSettlement & {
    readonly state: "failed" | "cancelled" | "expired";
    readonly failureCode: string;
    readonly fromAttemptStates: readonly NonTerminalPaymentAttemptState[];
    readonly terminalAt: Temporal.Instant;
  }
) {
  const { db } = yield* WorkspaceTransaction;
  const [attempt] = yield* db
    .update(paymentAttempts)
    .set({
      state: input.state,
      failureCode: input.failureCode,
      lastWebhookEventId: input.webhookEventId,
      lastProviderOperationId: input.providerOperationId,
      lastProviderStatus: input.providerStatus,
      updatedAt: input.terminalAt,
    })
    .where(
      and(
        eq(paymentAttempts.orderId, input.orderId),
        eq(paymentAttempts.id, input.id),
        inArray(paymentAttempts.state, [
          ...input.fromAttemptStates,
          input.state,
        ])
      )
    )
    .returning();
  return attempt;
});
