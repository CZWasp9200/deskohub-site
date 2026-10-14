import { Effect } from "effect";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/checkout/vercel-preview-protection-bypass";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";

/**
 * Absolute link that opens a customer's marketing preferences with a token
 * from `MarketingManagementService.issue`, as marketing emails carry it. It
 * carries no locale, so the proxy opens it in the recipient's language.
 */
export const getMarketingPreferencesAccessUrl = (
  token: string,
  origin: URL
): string => {
  const url = new URL("/marketing-preferences/access", origin);
  url.searchParams.set("token", token);
  appendVercelPreviewProtectionBypass(url, { setBypassCookie: true });

  return url.href;
};

/** The marketing preferences link on the running deployment's origin. */
export const getRuntimeMarketingPreferencesAccessUrl = (token: string) =>
  getWorkspaceRuntimeCallbackOrigin.pipe(
    Effect.map((origin) => getMarketingPreferencesAccessUrl(token, origin))
  );
