import "server-only";

import { connection } from "next/server";
import { Suspense } from "react";
import { areReferralsEnabled } from "./referral-feature-flag.server";
import { RememberSharedReferralCode } from "./remember-shared-referral-code";

/**
 * Mounts {@link RememberSharedReferralCode} only while the referral program is
 * enabled. The flag may depend on the request, so it is evaluated after the
 * static shell, which stays the same for every visitor.
 */
export function RememberSharedReferralCodeWhenEnabled() {
  return (
    <Suspense fallback={null}>
      <RememberSharedReferralCodeIfEnabled />
    </Suspense>
  );
}

async function RememberSharedReferralCodeIfEnabled() {
  await connection();
  return (await areReferralsEnabled()) && <RememberSharedReferralCode />;
}
