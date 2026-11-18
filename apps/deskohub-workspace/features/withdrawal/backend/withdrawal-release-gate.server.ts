import "server-only";

import { releaseGateForRequest } from "@/features/feature-flags/backend/release-gate.server";
import {
  WithdrawalReleaseGate,
  withdrawalReleaseRunPolicy,
} from "./withdrawal-release-gate";

const withdrawalRequest = releaseGateForRequest(WithdrawalReleaseGate, {
  operation: "withdrawal.enabled",
  ...withdrawalReleaseRunPolicy,
});

/** The online-withdrawal gate backed by the request's one decision. */
export const WithdrawalReleaseGateRequest = withdrawalRequest.layer;
