import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import type { AudienceFilter } from "./audience-filter";
import { campaignContentFixture } from "./backend/email-campaigns.test-utils";
import {
  campaignContentCoversAudience,
  resolveRecipientLocale,
} from "./recipient-locale";

describe("resolveRecipientLocale", () => {
  const none = {
    accountLocale: null,
    latestReservationLocale: null,
    consentLocale: null,
  };

  test("prefers the account, then the latest reservation, then the consent", () => {
    expect(
      resolveRecipientLocale({
        accountLocale: "en-US",
        latestReservationLocale: "cs-CZ",
        consentLocale: "cs-CZ",
      })
    ).toBe("en-US");
    expect(
      resolveRecipientLocale({
        ...none,
        latestReservationLocale: "en-US",
        consentLocale: "cs-CZ",
      })
    ).toBe("en-US");
    expect(resolveRecipientLocale({ ...none, consentLocale: "en-US" })).toBe(
      "en-US"
    );
  });

  test("skips unsupported values and falls back to Czech", () => {
    expect(
      resolveRecipientLocale({
        accountLocale: "de-DE",
        latestReservationLocale: "en",
        consentLocale: null,
      })
    ).toBe("cs-CZ");
    expect(resolveRecipientLocale(none)).toBe("cs-CZ");
  });
});

describe("campaignContentCoversAudience", () => {
  const czechOnly = campaignContentFixture();
  const englishOnly = { "en-US": czechOnly["cs-CZ"] };
  const audience = (
    locales: Extract<AudienceFilter, { readonly attribute: "locale" }>["value"]
  ) =>
    Option.some<AudienceFilter>({
      attribute: "locale",
      _tag: "Condition",
      operator: "anyOf",
      value: locales,
    });

  test("accepts Czech content for any audience", () => {
    expect(
      campaignContentCoversAudience({
        content: czechOnly,
        audienceFilter: Option.none(),
      })
    ).toBe(true);
    expect(
      campaignContentCoversAudience({
        content: czechOnly,
        audienceFilter: audience(["en-US"]),
      })
    ).toBe(true);
  });

  test("rejects English-only content for an audience that can reach Czech fallback recipients", () => {
    for (const audienceFilter of [
      Option.none(),
      audience(["cs-CZ", "en-US"]),
      audience(["cs-CZ"]),
    ]) {
      expect(
        campaignContentCoversAudience({ content: englishOnly, audienceFilter })
      ).toBe(false);
    }
  });

  test("accepts English-only content for an English-only audience", () => {
    const english: AudienceFilter = {
      attribute: "locale",
      _tag: "Condition",
      operator: "anyOf",
      value: ["en-US"],
    };
    for (const audienceFilter of [
      audience(["en-US"]),
      Option.some<AudienceFilter>({
        _tag: "Group",
        operator: "and",
        filters: [{ _tag: "Group", operator: "and", filters: [english] }],
      }),
      Option.some<AudienceFilter>({
        _tag: "Group",
        operator: "or",
        filters: [english],
      }),
    ]) {
      expect(
        campaignContentCoversAudience({ content: englishOnly, audienceFilter })
      ).toBe(true);
    }
  });
});
