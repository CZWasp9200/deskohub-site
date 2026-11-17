import "server-only";

import { releaseGateForRequest } from "@/features/feature-flags/backend/release-gate.server";
import {
  MeetingRoomReleaseGate,
  meetingRoomReleaseRunPolicy,
} from "./meeting-room-release-gate";

const meetingRoomPageRequest = releaseGateForRequest(MeetingRoomReleaseGate, {
  operation: "meeting-room.page-enabled",
  ...meetingRoomReleaseRunPolicy,
});

/**
 * The meeting-room page release gate, decided at most once per server
 * render, so the page metadata, page content, header, and landing hero
 * share one evaluation. They are stored in static shells, so it rejects
 * while PostHog can't decide the flag (`ReleaseGateRequest.decision`).
 */
export const isMeetingRoomPageEnabled = meetingRoomPageRequest.decision;

/**
 * The same gate for content rendered after `connection()`, which is never
 * stored: closed while PostHog can't decide the flag.
 */
export const isMeetingRoomPageOpenAfterConnection =
  meetingRoomPageRequest.isOpen;

/** The meeting-room page gate backed by the request's one decision. */
export const MeetingRoomReleaseGateRequest = meetingRoomPageRequest.layer;
