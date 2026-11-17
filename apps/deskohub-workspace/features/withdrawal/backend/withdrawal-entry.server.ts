import "server-only";

import { Effect, Layer } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { requireVerifiedSession } from "@/features/account/backend/verified-customer-session";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WithdrawalService } from "./withdrawal.service";
import { WithdrawalReleaseGate } from "./withdrawal-release-gate";
import { WithdrawalReleaseGateRequest } from "./withdrawal-release-gate.server";

/**
 * Whether the signed-in customer can withdraw from this reservation now: the
 * same quote the confirm step shows, offered only while the function is
 * released. Anything that keeps the quote from being made (signed out, not
 * the author, period over, a failed read) hides the entry point.
 */
export const isReservationWithdrawalOffered = (input: {
  readonly reservationId: WorkspaceReservationId;
  readonly locale: Locale;
}) =>
  Effect.gen(function* () {
    if (!(yield* WithdrawalReleaseGate.isOpen)) return false;
    const user = yield* requireVerifiedSession;
    const withdrawals = yield* WithdrawalService;
    yield* withdrawals.quote({
      accountId: user.accountId,
      locale: input.locale,
      contract: { kind: "reservation", id: input.reservationId },
    });
    return true;
  }).pipe(
    Effect.catchCause(() => Effect.succeed(false)),
    Effect.provide(
      Layer.mergeAll(
        WithdrawalService.Live,
        CustomerAuthentication.Default,
        WithdrawalReleaseGateRequest
      )
    ),
    Effect.withSpan("withdrawal.entry.offered")
  );
