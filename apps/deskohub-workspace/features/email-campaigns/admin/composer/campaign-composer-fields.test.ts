import { describe, expect, test } from "bun:test";
import {
  type CampaignComposerFields,
  composerLocales,
  newCampaignComposerFields,
  toCampaignLocalizedContent,
} from "./campaign-composer-fields";

const withSubject = (
  fields: CampaignComposerFields,
  locale: keyof CampaignComposerFields["locales"],
  subject: string
): CampaignComposerFields => ({
  ...fields,
  locales: {
    ...fields.locales,
    [locale]: { ...fields.locales[locale], subject },
  },
});

describe("composerLocales", () => {
  test("without a single-locale audience, every locale shows and Czech is required", () => {
    expect(composerLocales(undefined)).toEqual({
      editable: ["cs-CZ", "en-US"],
      required: "cs-CZ",
    });
  });

  test("a single-locale audience shows and requires only its locale", () => {
    expect(composerLocales("en-US")).toEqual({
      editable: ["en-US"],
      required: "en-US",
    });
    expect(composerLocales("cs-CZ")).toEqual({
      editable: ["cs-CZ"],
      required: "cs-CZ",
    });
  });
});

describe("toCampaignLocalizedContent", () => {
  const bothLocales = withSubject(
    withSubject(newCampaignComposerFields, "cs-CZ", "Ahoj"),
    "en-US",
    "Hello"
  );

  test("saves only the editable locales", () => {
    expect(
      Object.keys(
        toCampaignLocalizedContent(
          bothLocales,
          composerLocales("en-US").editable
        )
      )
    ).toEqual(["en-US"]);
  });

  test("skips locales with no text", () => {
    const czechOnly = withSubject(newCampaignComposerFields, "cs-CZ", "Ahoj");
    expect(
      Object.keys(
        toCampaignLocalizedContent(
          czechOnly,
          composerLocales(undefined).editable
        )
      )
    ).toEqual(["cs-CZ"]);
  });
});
