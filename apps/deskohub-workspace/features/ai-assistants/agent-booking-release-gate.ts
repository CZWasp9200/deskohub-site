import { ReleaseGate } from "@/features/feature-flags/backend/release-gate";

/**
 * `agent_booking`: whether the site offers to hand a reservation to the
 * visitor's AI assistant.
 */
export class AgentBookingReleaseGate extends ReleaseGate<AgentBookingReleaseGate>()(
  "@deskohub-workspace/ai-assistants/AgentBookingReleaseGate",
  "agent_booking"
) {}
