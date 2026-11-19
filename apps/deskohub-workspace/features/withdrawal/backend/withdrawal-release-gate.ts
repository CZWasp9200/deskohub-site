import { ReleaseGate } from "@/features/feature-flags/backend/release-gate";
import type { ReleaseGateRunPolicy } from "@/features/feature-flags/backend/release-gate-run";

/**
 * `online_withdrawal`: the customer's online withdrawal function on every
 * customer surface: the account's entry point, the quote and the submission,
 * on the web and in the customer API.
 */
export class WithdrawalReleaseGate extends ReleaseGate<WithdrawalReleaseGate>()(
  "@deskohub-workspace/withdrawal/WithdrawalReleaseGate",
  "online_withdrawal"
) {}

// Customers can still withdraw by email as the terms describe, so a run that
// fails beyond the gate's own fail-closed policy answers closed.
export const withdrawalReleaseRunPolicy = {
  whenRunFails: "close",
  failureCode: "withdrawal.release-gate",
} as const satisfies ReleaseGateRunPolicy;
