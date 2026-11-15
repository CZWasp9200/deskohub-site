import { Effect } from "effect";
import type { AccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import { AccountingDocumentSnapshots } from "./accounting-document-snapshots";

/**
 * Records `snapshot` for an attempt the caller's transaction has just
 * inserted, the way checkout does: the attempt's reservation, amount, locale
 * and provider identity are taken from the snapshot itself.
 */
export const recordAccountingDocumentSnapshot = (input: {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly snapshot: AccountingDocumentSnapshot;
}) =>
  Effect.gen(function* () {
    const snapshots = yield* AccountingDocumentSnapshots;
    const prepared = yield* snapshots.prepare({
      snapshot: input.snapshot,
      workspaceReservationId: input.snapshot.workspaceReservationId,
      amount: input.snapshot.quote.payment.expectedPrice,
      locale: input.snapshot.locale,
      reference: { type: "paymentAttemptId", id: input.paymentAttemptId },
    });
    yield* prepared.record({
      paymentAttemptId: input.paymentAttemptId,
      dotyposCustomerId: input.snapshot.dotyposCustomerId,
      dotyposReservationId: input.snapshot.dotyposReservationId,
    });
  });
