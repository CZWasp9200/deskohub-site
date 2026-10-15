import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EMAIL_TEST_DOMAIN } from "@deskohub/test-email";
import { Effect, Exit } from "effect";
import {
  type ActionResponseOutcome,
  retainActionSubmission,
} from "../admin-case";
import { workspaceE2EEmailCampaignMutationBarrierCount } from "../timeouts";
import {
  planEmailCampaignPreview,
  releaseEmailCampaignFixture,
} from "./email-campaign-case";

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
      resolve(import.meta.dir, "email-campaign-case.ts"),
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

describe("email campaign fixture release", () => {
  const undispatched = retainActionSubmission(
    Promise.reject(new Error("the submit click timed out"))
  );
  const responded = Promise.resolve<ActionResponseOutcome>({
    kind: "responded",
  });

  const release = (input: {
    readonly audienceSubmission: Promise<ActionResponseOutcome> | undefined;
    readonly campaignSubmission: Promise<ActionResponseOutcome> | undefined;
  }) => {
    const operations: string[] = [];
    const persisted = (label: string) =>
      Effect.gen(function* () {
        operations.push(`converge ${label}`);
        return yield* Effect.fail(new Error(`no ${label} row`));
      });
    const exit = Effect.runPromiseExit(
      releaseEmailCampaignFixture({
        ...input,
        audiencePersisted: persisted("audience"),
        barrierTimeoutMs: 20,
        campaignPersisted: persisted("campaign"),
        deleteRows: Effect.sync(() => {
          operations.push("delete");
        }),
      })
    );
    return exit.then((settled) => ({ exit: settled, operations }));
  };

  test("deletes the fixture when the audience submit fails before dispatch", async () => {
    const { exit, operations } = await release({
      audienceSubmission: undispatched,
      campaignSubmission: undefined,
    });

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(operations).toEqual(["delete"]);
  });

  test("deletes the fixture when the campaign submit fails before dispatch", async () => {
    const { exit, operations } = await release({
      audienceSubmission: responded,
      campaignSubmission: undispatched,
    });

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(operations).toEqual(["delete"]);
  });

  test("still deletes and then fails when a dispatched action never settles", async () => {
    const { exit, operations } = await release({
      audienceSubmission: new Promise<ActionResponseOutcome>(() => {}),
      campaignSubmission: Promise.resolve({ kind: "unresolved" }),
    });

    expect(Exit.isFailure(exit)).toBe(true);
    expect(operations).toEqual([
      "converge audience",
      "converge campaign",
      "delete",
    ]);
  });
});
