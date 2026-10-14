import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { CampaignLocaleContent } from "./campaign-content";

const localeContent = {
  subject: "Provozní doba",
  preheader: "Změna od listopadu",
  body: {
    formatVersion: 1,
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Dobrý den" }] },
      ],
    },
  },
};

const decode = Schema.decodeUnknownOption(CampaignLocaleContent);

describe("CampaignLocaleContent", () => {
  test("accepts content without an operational reason", () => {
    expect(Option.isSome(decode(localeContent))).toBe(true);
  });

  test("accepts a trimmed operational reason", () => {
    expect(
      decode({ ...localeContent, operationalReason: "Měníme provozní dobu." })
    ).toEqual(
      Option.some({
        ...localeContent,
        operationalReason: "Měníme provozní dobu.",
      })
    );
  });

  test.each(["", "   ", " Měníme provozní dobu."])(
    "rejects the operational reason %p",
    (operationalReason) => {
      expect(
        Option.isNone(decode({ ...localeContent, operationalReason }))
      ).toBe(true);
    }
  );
});
