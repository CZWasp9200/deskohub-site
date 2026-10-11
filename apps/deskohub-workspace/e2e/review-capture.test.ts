import { expect, test } from "bun:test";
import { isReviewScreenshotCaptureEnabled } from "./review-capture";

test("captures review screenshots only when the run opts in", () => {
  expect(
    isReviewScreenshotCaptureEnabled({
      WORKSPACE_E2E_REVIEW_SCREENSHOTS: "true",
    })
  ).toBe(true);
  for (const value of [undefined, "", "false", "1", "TRUE"]) {
    expect(
      isReviewScreenshotCaptureEnabled({
        WORKSPACE_E2E_REVIEW_SCREENSHOTS: value,
      })
    ).toBe(false);
  }
});
