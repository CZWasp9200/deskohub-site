import { describe, expect, mock, test } from "bun:test";

const isAgentBookingOpen = mock(() => Promise.resolve(false));

mock.module("../agent-booking-release-gate.server", () => ({
  isAgentBookingOpen,
}));
mock.module("@/features/feature-flags/backend/global-release.server", () => ({
  loadGlobalRelease: () => Promise.resolve("undecided"),
}));

const { AgentBookingWhenEnabled } = await import(
  "./agent-booking-when-enabled"
);
const { GlobalReleaseGate } = await import(
  "@/features/feature-flags/components/global-release-gate"
);

describe("AgentBookingWhenEnabled", () => {
  test("gates its content and fallback on the agent booking flag", () => {
    const content = <span>content</span>;
    const fallback = <span>fallback</span>;

    expect(
      AgentBookingWhenEnabled({ children: content, fallback })
    ).toMatchObject({
      type: GlobalReleaseGate,
      props: {
        flag: "agent_booking",
        isEnabled: isAgentBookingOpen,
        children: content,
        fallback,
      },
    });
  });
});
