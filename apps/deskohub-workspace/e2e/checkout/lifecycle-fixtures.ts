import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { PaymentAttemptState, PaymentState } from "@/db/schema";
import { PaymentTerminalTransitions } from "@/features/checkout/backend/repositories/payment-terminal-transitions";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationOrderId } from "@/features/reservation/persistence-contracts";
import { tryWorkspaceE2ESync, type WorkspaceE2EError } from "../errors";
import { readCheckoutRow } from "../integrations/database";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import { assert } from "../runtime";
import type { CheckoutRow } from "../types";

// Payment lifecycle states an E2E case reaches through the app's own
// transitions, run against the preview database. The fixtures go through the
// transition modules' interfaces, so their lock order, claim releases and
// state checks stay the app's.

/** The failure code a sandbox-rejected attempt is retired with. */
export const nexiSandboxRejectedFailureCode =
  "workspace_e2e_nexi_sandbox_rejected";

/**
 * Retires a payment attempt the Nexi sandbox rejected before authorization
 * the way a provider failure would: `PaymentTerminalTransitions` fails the
 * attempt and the reservation payment and releases the attempt's claims,
 * while the hold stays. Reopening the checkout pay page then starts a fresh
 * attempt and Nexi order.
 *
 * The app may already have ended the attempt itself, from a Nexi
 * notification or hold cleanup. The transition then refuses with
 * `PaymentLifecycleStateError`, and the checkout row decides: any unpaid
 * terminal state of the same attempt on a held reservation restarts.
 */
export const retireRejectedAttempt = (
  orderId: WorkspaceReservationId,
  paymentAttemptId: PaymentAttemptId
): Effect.Effect<CheckoutRow, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "retire rejected payment attempt",
      PaymentTerminalTransitions.use((transitions) =>
        transitions.markTerminal({
          id: paymentAttemptId,
          orderId: reservationOrderId(orderId),
          state: "failed",
          failureCode: nexiSandboxRejectedFailureCode,
        })
      ).pipe(
        Effect.asVoid,
        Effect.catchTag("PaymentLifecycleStateError", () => Effect.void),
        Effect.provide(PaymentTerminalTransitions.Default),
        Effect.provideService(WorkspaceDatabase, WorkspaceDatabase.make(db))
      )
    );

    const row = yield* readCheckoutRow(orderId);
    return yield* tryWorkspaceE2ESync(
      "assert rejected payment attempt retired",
      () => {
        assert(row, "retired checkout row missing");
        assert(
          row.payment_attempt_id === paymentAttemptId &&
            isRestartablePaymentState(row.payment_attempt_state) &&
            isRestartablePaymentState(row.payment_state),
          "rejected payment attempt was not retired"
        );
        assert(
          row.reservation_state === "held",
          "reservation hold ended before the payment could restart"
        );
        return row;
      }
    );
  });

/** Unpaid terminal payment states from which checkout starts a new attempt. */
const isRestartablePaymentState = (
  state: PaymentState | PaymentAttemptState | null
) => state === "failed" || state === "cancelled" || state === "expired";
