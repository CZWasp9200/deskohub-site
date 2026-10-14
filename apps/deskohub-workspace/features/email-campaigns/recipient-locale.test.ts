import { describe, expect, test } from "bun:test";
import { resolveRecipientLocale } from "./recipient-locale";

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
