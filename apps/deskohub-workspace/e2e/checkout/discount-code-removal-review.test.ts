import { expect, test } from "bun:test";
import { basename, dirname, resolve } from "node:path";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceDir } from "../runtime";
import {
  getDiscountCodeRemovalReviewArtifactPath,
  isOwnedPayPageUrl,
} from "./discount-code-removal-review";

const baseUrl = "https://deskohub-workspace-site-abc123-team.vercel.app";
const orderId = "workspace-reservation-123" as WorkspaceReservationId;

test("writes removal review PNGs per width into the account-review artifact bundle", () => {
  const artifact = getDiscountCodeRemovalReviewArtifactPath(
    "checkout-discount-code-removed-review",
    "360"
  );

  expect(dirname(artifact)).toBe(
    resolve(workspaceDir, "e2e-artifacts", "account-review")
  );
  expect(basename(artifact)).toBe(
    "checkout-discount-code-removed-review-360.png"
  );
});

test("captures only this order's Pay page on the target deployment", () => {
  const owned = `${baseUrl}/en-US/checkout/pay?payState=token&orderId=${orderId}`;
  const accepts = (actualUrl: string) =>
    isOwnedPayPageUrl({ actualUrl, baseUrl, orderId });

  expect(accepts(owned)).toBe(true);
  expect(accepts(`${owned}&discountCodeError=unavailable`)).toBe(true);
  for (const candidate of [
    owned.replace(baseUrl, "https://example.com"),
    owned.replace("/checkout/pay", "/account"),
    owned.replace(orderId, "workspace-reservation-456"),
    `${owned}&orderId=${orderId}`,
    "not a url",
  ]) {
    expect(accepts(candidate)).toBe(false);
  }
});

test("accepts a refused redirect only when it carries the Pay state already seen on this order's Pay page", () => {
  const refused = `${baseUrl}/en-US/checkout/pay?payState=token&discountCodeError=unavailable`;
  const accepts = (actualUrl: string, payState?: string) =>
    isOwnedPayPageUrl({ actualUrl, baseUrl, orderId, payState });

  expect(accepts(refused, "token")).toBe(true);
  for (const [candidate, payState] of [
    [refused, undefined],
    [refused, "another-token"],
    [`${refused}&payState=token`, "token"],
    [refused.replace(baseUrl, "https://example.com"), "token"],
    [`${refused}&orderId=workspace-reservation-456`, "token"],
  ] as const) {
    expect(accepts(candidate, payState)).toBe(false);
  }
});
