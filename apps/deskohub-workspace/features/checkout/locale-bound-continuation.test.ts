import { describe, expect, test } from "bun:test";
import { preferenceApplyingTo } from "./locale-bound-continuation";

const payUrl = new URL(
  "https://workspace.example/en-US/checkout/pay?payState=x"
);

describe("preferenceApplyingTo", () => {
  test.each([
    {
      name: "throws",
      verify: (): Promise<boolean> => {
        throw new Error("synthetic import failure");
      },
    },
    {
      name: "rejects",
      verify: () => Promise.reject(new Error("synthetic runtime failure")),
    },
  ])(
    "applies the preference and reports once when the verifier $name",
    async ({ verify }) => {
      const reports: string[] = [];

      const applied = await preferenceApplyingTo(
        payUrl,
        "cs-CZ",
        verify,
        () => {
          reports.push("verify-failed");
          return Promise.resolve();
        }
      );

      expect(applied).toBe("cs-CZ");
      expect(reports).toEqual(["verify-failed"]);
    }
  );

  test("still applies the preference when reporting the failure fails too", async () => {
    const applied = await preferenceApplyingTo(
      payUrl,
      "cs-CZ",
      () => Promise.reject(new Error("synthetic verifier failure")),
      () => Promise.reject(new Error("synthetic logger failure"))
    );

    expect(applied).toBe("cs-CZ");
  });

  test("keeps the issued locale only for a verified continuation", async () => {
    const report = () => Promise.resolve();

    expect(
      await preferenceApplyingTo(payUrl, "cs-CZ", async () => true, report)
    ).toBeUndefined();
    expect(
      await preferenceApplyingTo(payUrl, "cs-CZ", async () => false, report)
    ).toBe("cs-CZ");
  });
});
