import { releaseGateForRun } from "@/features/feature-flags/backend/release-gate-run";
import {
  WithdrawalReleaseGate,
  withdrawalReleaseRunPolicy,
} from "./withdrawal-release-gate";

/**
 * The online-withdrawal gate decided once per build, for a request served
 * outside Next.js, such as the customer HTTP API. Build it once per request.
 */
export const WithdrawalReleaseGateForRun = releaseGateForRun(
  WithdrawalReleaseGate,
  withdrawalReleaseRunPolicy
);
