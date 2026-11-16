import "server-only";
import { releaseGateForRequest } from "@/features/feature-flags/backend/release-gate.server";
import {
  OvernightStayReleaseGate,
  overnightStayReleaseRunPolicy,
} from "./overnight-stay-release-gate";

const overnightStayRequest = releaseGateForRequest(OvernightStayReleaseGate, {
  operation: "reservation.overnight-stay-offered",
  ...overnightStayReleaseRunPolicy,
});

/**
 * Whether the Reserved Desk offers an overnight stay to this request, decided
 * once per server render and closed while PostHog can't decide. Read it only
 * after `connection()`, such as in the cowork form's streamed content, never
 * in a static shell.
 */
export const isOvernightStayOffered = overnightStayRequest.isOpen;

/** The overnight-stay gate backed by the request's one decision. */
export const OvernightStayReleaseGateRequest = overnightStayRequest.layer;
