import "server-only";

import { Effect, Layer, Option } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { requireVerifiedSession } from "@/features/account/backend/verified-customer-session";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationWithdrawalEntry } from "@/features/withdrawal/withdrawal-read-model";
import { WithdrawalRepository } from "./withdrawal.repository";
import { WithdrawalService } from "./withdrawal.service";
import { WithdrawalReleaseGate } from "./withdrawal-release-gate";
import { WithdrawalReleaseGateRequest } from "./withdrawal-release-gate.server";

/**
 * Whether the signed-in customer can withdraw from this reservation now: the
 * same quote the confirm step shows, offered only while the function is
 * released. Anything that keeps the quote from being made (signed out, not
 * the author, period over, a failed read) hides the entry point.
 */
const isWithdrawalOffered = Effect.fn("withdrawal.entry.offered")(
  function* (input: {
    readonly reservationId: WorkspaceReservationId;
    readonly locale: Locale;
  }) {
    if (!(yield* WithdrawalReleaseGate.isOpen)) return false;
    const user = yield* requireVerifiedSession;
    const withdrawals = yield* WithdrawalService;
    yield* withdrawals.quote({
      accountId: user.accountId,
      locale: input.locale,
      contract: { kind: "reservation", id: input.reservationId },
    });
    return true;
  },
  (effect) =>
    effect.pipe(
      Effect.catchCause(() => Effect.succeed(false)),
      Effect.provide(
        Layer.mergeAll(
          WithdrawalService.Live,
          CustomerAuthentication.Default,
          WithdrawalReleaseGateRequest
        )
      )
    )
);

/**
 * The reservation's recorded withdrawal, whoever views its status page and
 * whether or not the function is still released: a withdrawn reservation
 * stays withdrawn. A failed read shows no withdrawal.
 */
const findRecordedWithdrawal = Effect.fn("withdrawal.entry.recorded")(
  function* (reservationId: WorkspaceReservationId) {
    const repository = yield* WithdrawalRepository;
    return yield* repository.findByContract({
      kind: "reservation",
      id: reservationId,
    });
  },
  (effect) =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Recorded withdrawal could not be read", {
          cause,
        }).pipe(Effect.as(Option.none()))
      ),
      Effect.provide(WithdrawalRepository.Live)
    )
);

/**
 * Reads the reservation's withdrawal entry for its status page. The recorded
 * withdrawal and the offer are read side by side, so the page waits for the
 * slower of the two only; a recorded withdrawal wins.
 */
export const readReservationWithdrawalEntry = (input: {
  readonly reservationId: WorkspaceReservationId;
  readonly locale: Locale;
}) =>
  Effect.all(
    [findRecordedWithdrawal(input.reservationId), isWithdrawalOffered(input)],
    { concurrency: "unbounded" }
  ).pipe(
    Effect.map(
      ([recorded, offered]): ReservationWithdrawalEntry =>
        Option.match(recorded, {
          onSome: ({ refundAmount }) => ({ status: "withdrawn", refundAmount }),
          onNone: () => (offered ? { status: "offered" } : { status: "none" }),
        })
    ),
    Effect.withSpan("withdrawal.entry.read")
  );
