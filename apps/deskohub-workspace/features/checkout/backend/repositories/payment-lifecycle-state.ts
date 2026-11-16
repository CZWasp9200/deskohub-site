import type { NexiOrderId } from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import { type PaymentAttemptState, workspaceReservations } from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { PaymentAttempt } from "./payment-attempt.repository";

// The vocabulary the payment lifecycle's transitions share: how a transition
// names the payment it refused, what it returns, and the admission read each
// transition starts its locked transaction with. It lives apart from
// `PaymentLifecycleRepository` so that `PaymentTerminalTransitions` can use it
// without loading the repository's accounting dependencies.

export type PaymentLifecycleReference =
  | { readonly type: "paymentAttemptId"; readonly id: PaymentAttemptId }
  | { readonly type: "providerOrderId"; readonly id: NexiOrderId }
  | {
      readonly type: "workspaceReservationId";
      readonly id: WorkspaceReservationId;
    };

export class PaymentLifecycleStateError extends Data.TaggedError(
  "PaymentLifecycleStateError"
)<{
  readonly operation: string;
  readonly paymentReference: PaymentLifecycleReference;
  readonly message: string;
}> {}

export interface PaymentLifecycleTransition {
  readonly attempt: PaymentAttempt;
  readonly changed: boolean;
  readonly timestamp: Temporal.Instant;
}

export type NonTerminalPaymentAttemptState = Extract<
  PaymentAttemptState,
  "created" | "pending"
>;

/**
 * The state error of a `PaymentLifecycleRepository` operation. Transitions
 * split out of the repository keep naming the repository operation they
 * serve, so callers see the same error whichever module ran it.
 */
export const lifecycleStateError = (
  operation: string,
  paymentReference: PaymentLifecycleReference,
  message: string
) =>
  new PaymentLifecycleStateError({
    operation: `PaymentLifecycleRepository.${operation}`,
    paymentReference,
    message,
  });

/** Reads the reservation's customer, whose first-booking lock comes next. */
export const findPaymentReservationCustomer = Effect.fnUntraced(function* (
  operation:
    | "createPendingNexiAttempt"
    | "completeInternalPayment"
    | "markPaid"
    | "markTerminal",
  workspaceReservationId: WorkspaceReservationId
) {
  const { db } = yield* WorkspaceTransaction;
  const [reservationIdentity] = yield* db
    .select({
      dotyposCustomerId: workspaceReservations.dotyposCustomerId,
    })
    .from(workspaceReservations)
    .where(eq(workspaceReservations.id, workspaceReservationId))
    .limit(1);
  if (!reservationIdentity) {
    return yield* lifecycleStateError(
      operation,
      {
        type: "workspaceReservationId",
        id: workspaceReservationId,
      },
      "The payment reservation was not found."
    );
  }
  return reservationIdentity.dotyposCustomerId;
});
