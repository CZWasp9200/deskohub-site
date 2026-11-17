import { releaseGateForRun } from "@/features/feature-flags/backend/release-gate-run";
import {
  OvernightStayReleaseGate,
  overnightStayReleaseRunPolicy,
} from "./overnight-stay-release-gate";

/**
 * The overnight-stay gate decided once per build, for a request served
 * outside Next.js, such as the customer HTTP API. Build it once per request.
 */
export const OvernightStayReleaseGateForRun = releaseGateForRun(
  OvernightStayReleaseGate,
  overnightStayReleaseRunPolicy
);
