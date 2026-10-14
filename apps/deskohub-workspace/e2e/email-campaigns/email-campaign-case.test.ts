import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EMAIL_TEST_DOMAIN } from "@deskohub/test-email";
import { workspaceE2EEmailCampaignMutationBarrierCount } from "../timeouts";
import { planEmailCampaignPreview } from "./email-campaign-case";

describe("email campaign preview case planning", () => {
  test("scopes every synthetic identifier to the run", () => {
    const first = planEmailCampaignPreview();
    const second = planEmailCampaignPreview();

    expect(first.customerTag).not.toBe(second.customerTag);
    expect(first.audienceTitle).not.toBe(second.audienceTitle);
    expect(first.campaignTitle).not.toBe(second.campaignTitle);
    expect(first.recipientEmail).not.toBe(second.recipientEmail);
    expect(first.recipientEmail.endsWith(`@${EMAIL_TEST_DOMAIN}`)).toBe(true);
  });
});

describe("email campaign cleanup budget", () => {
  test("budgets every mutation barrier the case waits on", () => {
    const caseSource = readFileSync(
      resolve(import.meta.dir, "preview-campaign-recipients.pw.ts"),
      "utf8"
    );
    // Comment-aware: a commented-out barrier call must not count as a wait.
    const activeCaseSource = caseSource
      .split("\n")
      .map((line) => {
        const commentAt = line.indexOf("//");
        return commentAt === -1 ? line : line.slice(0, commentAt);
      })
      .join("\n");
    const barrierWaits =
      activeCaseSource.split("awaitActionQuiescence(").length - 1;

    expect(barrierWaits).toBe(workspaceE2EEmailCampaignMutationBarrierCount);
  });
});
