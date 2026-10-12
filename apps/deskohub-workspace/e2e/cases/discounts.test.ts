import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  assertDisplayedDiscounts,
  calendarDiscountExpectation,
} from "./discounts";

test("reads discount details from the focused trigger's accessible description", async () => {
  let focusHandlerReady = false;
  let triggerCentered = false;
  let triggerOpened = false;
  let descriptionReads = 0;
  const run: Runner = async (_command, args, options) => {
    const [operation, value] = args.slice(2);
    if (operation === "wait" && value === "--fn") {
      focusHandlerReady ||= args.at(4)?.includes('"onFocus"') === true;
    }
    if (operation === "eval") {
      triggerCentered = options?.input?.includes("center") === true;
    }
    if (operation === "focus") {
      if (!focusHandlerReady || !triggerCentered) {
        return {
          exitCode: 1,
          stderr: "discount trigger is not ready to receive focus",
          stdout: "",
        };
      }
      triggerOpened = true;
    }
    if (operation === "wait" && args.at(4)?.includes("aria-describedby")) {
      if (!triggerOpened) {
        return {
          exitCode: 1,
          stderr: "discount tooltip is not open",
          stdout: "",
        };
      }
      descriptionReads += 1;
    }
    return { exitCode: 0, stderr: "", stdout: "" };
  };

  await Effect.runPromise(
    assertDisplayedDiscounts({
      config: {
        timeouts: workspaceE2ETimeouts,
      } as WorkspaceE2EConfig,
      discounts: [
        calendarDiscountExpectation,
        {
          adjustment: {
            kind: "fixed",
            amount: { value: 10_000, exponent: 2, currency: "CZK" },
          },
          label: "Voucher",
          redemptionState: "redeemed",
        },
      ],
      run,
      session: "discounts-test",
    })
  );

  expect(descriptionReads).toBe(2);
});
