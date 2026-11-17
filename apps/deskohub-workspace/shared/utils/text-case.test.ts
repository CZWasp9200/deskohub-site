import { describe, expect, test } from "bun:test";
import { nounInSentence, upperCaseFirst } from "./text-case";

describe("upperCaseFirst", () => {
  test("upper-cases only the first character", () => {
    expect(upperCaseFirst("every Monday at 10:00", "en-US")).toBe(
      "Every Monday at 10:00"
    );
    expect(upperCaseFirst("čtvrtek", "cs-CZ")).toBe("Čtvrtek");
  });

  test("leaves text without a cased first character unchanged", () => {
    expect(upperCaseFirst("2. úterý", "cs-CZ")).toBe("2. úterý");
    expect(upperCaseFirst("", "en-US")).toBe("");
  });
});

describe("nounInSentence", () => {
  test("lower-cases a noun label for the middle of a sentence", () => {
    expect(nounInSentence("Meeting Room", "en-US")).toBe("meeting room");
    expect(nounInSentence("Zasedačka", "cs-CZ")).toBe("zasedačka");
    expect(nounInSentence("Тариф", "uk-UA")).toBe("тариф");
  });

  test("keeps the case in languages that capitalise nouns", () => {
    expect(nounInSentence("Meetingraum", "de-DE")).toBe("Meetingraum");
  });
});
