import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/checkout/vercel-preview-protection-bypass";
import type { Locale } from "@/features/i18n";

/**
 * Path of the link that opens a customer's marketing preferences with a token
 * from `MarketingManagementService.issue`, as marketing emails carry it.
 */
export const getMarketingPreferencesAccessPath = (input: {
  readonly locale: Locale;
  readonly token: string;
}): string => {
  const url = new URL(
    `/${input.locale}/marketing-preferences/access`,
    "https://deskohub.local"
  );
  url.searchParams.set("token", input.token);
  appendVercelPreviewProtectionBypass(url, { setBypassCookie: true });

  return `${url.pathname}${url.search}`;
};
