import "server-only";

import { releaseGateForRequest } from "@/features/feature-flags/backend/release-gate.server";
import { AgentBookingReleaseGate } from "./agent-booking-release-gate";

// Any run failure, including a defect or a runtime that cannot start,
// keeps the agent booking entry points off.
const agentBookingRequest = releaseGateForRequest(AgentBookingReleaseGate, {
  operation: "ai-assistants.agent-booking-enabled",
  whenRunFails: "close",
  failureCode: "agent_booking_feature_flag_unavailable",
});

/** Whether this request offers agent booking. */
export const isAgentBookingOpen = agentBookingRequest.isOpen;
