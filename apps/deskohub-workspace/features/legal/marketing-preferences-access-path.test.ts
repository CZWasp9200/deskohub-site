import { describe, expect, test } from "bun:test";
import { getMarketingPreferencesAccessPath } from "./marketing-preferences-access-path";

describe("getMarketingPreferencesAccessPath", () => {
  test("links the localized access route with the token", () => {
    const path = new URL(
      getMarketingPreferencesAccessPath({ locale: "en-US", token: "a+b/c" }),
      "https://workspace.deskohub.cz"
    );

    expect(path.pathname).toBe("/en-US/marketing-preferences/access");
    expect(path.searchParams.getAll("token")).toEqual(["a+b/c"]);
  });
});
