import { Data, Effect } from "effect";
import { ReleaseGate } from "@/features/feature-flags/backend/release-gate";
import type { ReleaseGateRunPolicy } from "@/features/feature-flags/backend/release-gate-run";
import type { CoworkStay } from "@/features/reservation/cowork-stay";

/** `overnight_stays`: overnight Reserved Desk stays on every booking surface. */
export class OvernightStayReleaseGate extends ReleaseGate<OvernightStayReleaseGate>()(
  "@deskohub-workspace/reservation/OvernightStayReleaseGate",
  "overnight_stays"
) {}

// The overnight stay is an optional choice on an offering that stays
// bookable without it, so a run that fails beyond the gate's own fail-closed
// policy answers closed: the stay is not offered.
export const overnightStayReleaseRunPolicy = {
  whenRunFails: "close",
  failureCode: "reservation.overnight-stay-release-gate",
} as const satisfies ReleaseGateRunPolicy;

/** A booking asked for an overnight stay while the release gate is closed. */
class OvernightStayUnavailableError extends Data.TaggedError(
  "OvernightStayUnavailableError"
)<{
  readonly message: string;
}> {}

/**
 * Fails a booking request that carries an overnight stay while the gate is
 * closed. A day stay, or no stay, never reads the gate.
 */
export const ensureCoworkStayOffered = Effect.fn("ensureCoworkStayOffered")(
  function* (stay: CoworkStay | undefined) {
    if (stay !== "overnight") return;
    if (yield* OvernightStayReleaseGate.isOpen) return;
    return yield* new OvernightStayUnavailableError({
      message: "Overnight stays are not offered.",
    });
  }
);
