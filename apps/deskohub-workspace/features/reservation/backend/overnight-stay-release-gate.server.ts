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
 * Whether the cowork reservation page offers an overnight stay, decided at
 * most once per server render. The page reads it after `connection()` and
 * never stores it, so it fails closed while PostHog can't decide the flag.
 */
export const isOvernightStayOfferedAfterConnection =
  overnightStayRequest.isOpen;
