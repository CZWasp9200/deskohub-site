import { describe, expect, test } from "bun:test";
import {
  nextSampleAccountKind,
  resolveSampleDataMode,
  resolveSampleFeatureFlags,
  type SampleAccountKind,
  sampleAccountKinds,
} from "./sample-data-mode";

describe("resolveSampleDataMode", () => {
  test("a release build never enables sample data, whatever the env says", () => {
    for (const flag of ["1", "true", "yes", undefined]) {
      expect(
        resolveSampleDataMode({
          isDevelopmentBuild: false,
          flag,
          kind: "linked",
        })
      ).toEqual({ enabled: false });
    }
  });

  test("a development build needs the explicit flag", () => {
    expect(
      resolveSampleDataMode({
        isDevelopmentBuild: true,
        flag: undefined,
        kind: "linked",
      })
    ).toEqual({ enabled: false });
    expect(
      resolveSampleDataMode({
        isDevelopmentBuild: true,
        flag: "true",
        kind: "linked",
      })
    ).toEqual({ enabled: false });
  });

  test("the kind env picks the first account state, linked by default", () => {
    expect(
      resolveSampleDataMode({
        isDevelopmentBuild: true,
        flag: "1",
        kind: "review-account",
      })
    ).toEqual({ enabled: true, kind: "review-account" });
    expect(
      resolveSampleDataMode({
        isDevelopmentBuild: true,
        flag: "1",
        kind: "unknown",
      })
    ).toEqual({ enabled: true, kind: "linked" });
  });
});

describe("nextSampleAccountKind", () => {
  test("cycles through every account state", () => {
    const seen = new Set<string>();
    let kind: SampleAccountKind = "linked";
    for (const _ of sampleAccountKinds) {
      seen.add(kind);
      kind = nextSampleAccountKind(kind);
    }

    expect(seen.size).toBe(sampleAccountKinds.length);
    expect(kind).toBe("linked");
  });
});

describe("resolveSampleFeatureFlags", () => {
  test("sample data switches the listed flags on", () => {
    expect([
      ...resolveSampleFeatureFlags({
        mode: { enabled: true, kind: "linked" },
        flags: " first_flag, second_flag ,,",
      }),
    ]).toEqual(["first_flag", "second_flag"]);
  });

  test("without sample data no flag is switched on", () => {
    expect(
      resolveSampleFeatureFlags({
        mode: { enabled: false },
        flags: "first_flag",
      }).size
    ).toBe(0);
    expect(
      resolveSampleFeatureFlags({
        mode: { enabled: true, kind: "linked" },
        flags: undefined,
      }).size
    ).toBe(0);
  });
});
