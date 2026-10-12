import { describe, expect, test } from "bun:test";
import { Effect, Logger } from "effect";
import {
  type LocaleBoundContinuation,
  preferenceApplyingTo,
} from "./locale-bound-continuation";

const payUrl = new URL(
  "https://workspace.example/en-US/checkout/pay?payState=x"
);

const apply = async (
  ...args: Parameters<typeof preferenceApplyingTo<unknown>>
) => {
  const warnings: unknown[] = [];
  const captureLogger = Logger.make((options) => {
    if (options.logLevel === "Warn") warnings.push(options.message);
  });
  const applied = await preferenceApplyingTo(...args).pipe(
    Effect.provide(Logger.layer([captureLogger])),
    Effect.runPromise
  );
  return { applied, warnings };
};

describe("preferenceApplyingTo", () => {
  test.each([
    {
      name: "throws",
      verify: (): Effect.Effect<boolean> => {
        throw new Error("synthetic import failure");
      },
    },
    {
      name: "fails",
      verify: () => Effect.fail(new Error("synthetic runtime failure")),
    },
    {
      name: "dies",
      verify: () => Effect.die(new Error("synthetic verifier defect")),
    },
  ])(
    "applies the preference and logs once when the verifier $name",
    async ({ verify }) => {
      const { applied, warnings } = await apply(payUrl, "cs-CZ", verify);

      expect(applied).toBe("cs-CZ");
      expect(warnings).toHaveLength(1);
    }
  );

  test("keeps the issued locale only for a verified continuation", async () => {
    expect(
      (await apply(payUrl, "cs-CZ", () => Effect.succeed(true))).applied
    ).toBeUndefined();
    expect(
      (await apply(payUrl, "cs-CZ", () => Effect.succeed(false))).applied
    ).toBe("cs-CZ");
  });

  test("never verifies for a guest, a matching locale, or an unknown page", async () => {
    const verified: LocaleBoundContinuation[] = [];
    const verify = (continuation: LocaleBoundContinuation) => {
      verified.push(continuation);
      return Effect.succeed(true);
    };

    expect((await apply(payUrl, undefined, verify)).applied).toBeUndefined();
    expect((await apply(payUrl, "en-US", verify)).applied).toBe("en-US");
    expect((await apply(undefined, "cs-CZ", verify)).applied).toBe("cs-CZ");
    expect(verified).toEqual([]);
  });
});
