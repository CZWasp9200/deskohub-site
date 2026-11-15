import { Effect, Layer } from "effect";
import { InvoiceCancellationNotices } from "./invoice-cancellation-notices";

/**
 * PLACEHOLDER until the notice email lands (stream P2 owns this file and
 * replaces it whole at integration). It keeps the workflow layers closed so
 * they typecheck; every notice operation is a defect, so a missed
 * replacement cannot pass silently.
 */
export const InvoiceCancellationNoticesLive = Layer.succeed(
  InvoiceCancellationNotices,
  InvoiceCancellationNotices.of({
    deliver: () =>
      Effect.die(new Error("Invoice cancellation notices are not wired.")),
    ensureOwed: () =>
      Effect.die(new Error("Invoice cancellation notices are not wired.")),
  })
);
