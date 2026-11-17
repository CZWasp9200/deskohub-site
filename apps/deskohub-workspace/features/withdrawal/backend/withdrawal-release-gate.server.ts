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

/** Whether the online withdrawal function is released for this request. */
export const isWithdrawalEnabled = withdrawalRequest.isOpen;

/** The online-withdrawal gate backed by the request's one decision. */
export const WithdrawalReleaseGateRequest = withdrawalRequest.layer;
