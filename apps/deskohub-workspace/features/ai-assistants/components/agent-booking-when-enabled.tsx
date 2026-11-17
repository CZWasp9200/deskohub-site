import "server-only";

import type { ReactNode } from "react";
import { GlobalReleaseGate } from "@/features/feature-flags/components/global-release-gate";
import { isAgentBookingOpen } from "../agent-booking-release-gate.server";

/**
 * Renders `children` only while the agent booking release gate is on, and
 * `fallback` otherwise.
 */
export function AgentBookingWhenEnabled({
  children,
  fallback,
}: {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}) {
  return (
    <GlobalReleaseGate
      fallback={fallback}
      flag="agent_booking"
      isEnabled={isAgentBookingOpen}
    >
      {children}
    </GlobalReleaseGate>
  );
}
