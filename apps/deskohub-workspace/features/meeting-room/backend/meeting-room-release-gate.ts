import { ReleaseGate } from "@/features/feature-flags/backend/release-gate";
import type { ReleaseGateRunPolicy } from "@/features/feature-flags/backend/release-gate-run";

/**
 * `meeting_room_page`: the meeting-room page, the links to it, and the
 * meeting room in the customer API's booking catalog.
 */
export class MeetingRoomReleaseGate extends ReleaseGate<MeetingRoomReleaseGate>()(
  "@deskohub-workspace/meeting-room/MeetingRoomReleaseGate",
  "meeting_room_page"
) {}

// A run that fails beyond the gate's own fail-closed policy, such as a
// runtime that cannot start, rejects, so the page and the booking catalog
// error rather than answering without the meeting room.
export const meetingRoomReleaseRunPolicy = {
  whenRunFails: "reject",
} as const satisfies ReleaseGateRunPolicy;
