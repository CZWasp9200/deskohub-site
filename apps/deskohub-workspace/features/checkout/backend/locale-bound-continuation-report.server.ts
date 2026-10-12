import "server-only";

import { Effect } from "effect";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

/**
 * Logs one failed continuation verification under a stable event name. It
 * never sees the token, and it lives apart from the verifier so it still
 * loads when the verifier module itself fails to import.
 */
export const reportLocaleBoundContinuationVerifyFailure = () =>
  runWorkspaceEffect("i18n.locale-bound-continuation", { boundary: "route" })(
    Effect.logWarning(
      "Locale-bound continuation could not be verified; the saved preference applies.",
      { code: "i18n.locale-bound-continuation.verify-failed" }
    )
  );
