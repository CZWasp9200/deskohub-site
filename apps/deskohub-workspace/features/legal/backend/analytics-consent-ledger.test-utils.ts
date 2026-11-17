import { Effect, Layer, Option } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import {
  AnalyticsConsentLedger,
  AnalyticsConsentUnavailable,
} from "./analytics-consent-ledger";

/** An account's current analytics consent as a test ledger reports it. */
export type TestAnalyticsConsent =
  | "grant"
  | "withdraw"
  | "none"
  | "unavailable";

/**
 * An analytics consent ledger that only answers current decisions, each the
 * one `consentOf` gives the account when asked.
 */
export const analyticsConsentLedgerOf = (
  consentOf: (accountId: CustomerAccountId) => TestAnalyticsConsent
) =>
  Layer.succeed(AnalyticsConsentLedger, {
    record: () => Effect.die("not used"),
    mirror: () => Effect.die("not used"),
    currentDecision: (accountId) => {
      const consent = consentOf(accountId);
      if (consent === "unavailable") {
        return Effect.fail(new AnalyticsConsentUnavailable({ cause: consent }));
      }
      return Effect.succeed(
        consent === "none"
          ? Option.none()
          : Option.some({
              decision: consent,
              documentHash: "privacy-notice",
              locale: "cs-CZ" as const,
              decidedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
              source: "banner" as const,
            })
      );
    },
  });
