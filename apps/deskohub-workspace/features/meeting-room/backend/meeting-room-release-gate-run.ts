import { releaseGateForRun } from "@/features/feature-flags/backend/release-gate-run";
import {
  MeetingRoomReleaseGate,
  meetingRoomReleaseRunPolicy,
} from "./meeting-room-release-gate";

/**
 * The meeting-room gate decided once per build, for a request served outside
 * Next.js, such as the customer HTTP API. Build it once per request.
 */
export const MeetingRoomReleaseGateForRun = releaseGateForRun(
  MeetingRoomReleaseGate,
  meetingRoomReleaseRunPolicy
);
