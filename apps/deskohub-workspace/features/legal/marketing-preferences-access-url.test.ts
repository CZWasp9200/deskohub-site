import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  getMarketingPreferencesAccessUrl,
  getRuntimeMarketingPreferencesAccessUrl,
} from "./marketing-preferences-access-url";

describe("getMarketingPreferencesAccessUrl", () => {
  test("links the access route without a locale, carrying the token", () => {
    const url = new URL(
      getMarketingPreferencesAccessUrl(
        "a+b/c",
        new URL("https://workspace.deskohub.cz")
      )
    );

    expect(url.origin).toBe("https://workspace.deskohub.cz");
    expect(url.pathname).toBe("/marketing-preferences/access");
    expect(url.searchParams.getAll("token")).toEqual(["a+b/c"]);
  });

  test("uses the running deployment's origin", async () => {
    const url = new URL(
      await Effect.runPromise(getRuntimeMarketingPreferencesAccessUrl("token"))
    );

    expect(url.origin).toBe("http://deskohub.test");
    expect(url.pathname).toBe("/marketing-preferences/access");
  });
});
