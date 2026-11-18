import type { PostHogFeatureFlagSnapshot } from "@deskohub/analytics-posthog/feature-flags";

/** Generated from PostHog feature flag definitions. Do not edit manually. */
export const postHogFeatureFlagSnapshot = {
  generatedAt: "2026-11-17T13:18:09.710Z",
  constantValues: {
    "account_avatars": null,
    "agent_booking": false,
    "calendar_sales": true,
    "customer_discounts": false,
    "discount_codes": true,
    "login_email_code": true,
    "login_passkeys": true,
    "meeting_room_page": true,
    "office_page": false,
    "online_withdrawal": false,
    "overnight_stays": false,
    "referrals": false,
    "seating_map": false,
    "webmcp_site_tools": false,
  },
} as const satisfies PostHogFeatureFlagSnapshot;
