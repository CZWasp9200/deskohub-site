import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { NodeCrypto } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer } from "effect";
import { TestClock } from "effect/testing";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { hashCampaignContent } from "../body/campaign-content-hash";
import type { CampaignId } from "../campaign-identifiers";
import { CampaignService } from "./campaign.service";
import { CampaignConfirmationCodeService } from "./campaign-confirmation-code.service";
import { campaignContentFixture } from "./email-campaigns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const issuedAt = Temporal.Instant.from("2026-10-14T10:00:00Z");

describe.skipIf(!testDatabase)(
  "CampaignConfirmationCodeService on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const campaignIds: CampaignId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from email_campaigns where id = any($1)",
        [campaignIds]
      );
    });

    const services = Layer.mergeAll(
      CampaignService.Default,
      CampaignConfirmationCodeService.Default
    ).pipe(Layer.provide(Layer.mergeAll(testDatabase.layer, NodeCrypto.layer)));

    /** Runs at `issuedAt` plus `elapsed` on the test clock. */
    const runAt = <A, E>(
      elapsed: Temporal.DurationLike,
      effect: Effect.Effect<
        A,
        E,
        CampaignService | CampaignConfirmationCodeService
      >
    ) =>
      Effect.runPromiseExit(
        TestClock.setTime(issuedAt.add(elapsed).epochMilliseconds).pipe(
          Effect.andThen(effect),
          Effect.provide(Layer.merge(services, TestClock.layer()))
        )
      );

    const failure = (exit: Exit.Exit<unknown, unknown>) =>
      Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

    const createDraft = async () => {
      const exit = await runAt(
        { seconds: 0 },
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.create({
              title: "Price update",
              purpose: "operational",
              templateKey: "workspace",
              content: campaignContentFixture(),
              audienceId: null,
            })
          )
        )
      );
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      campaignIds.push(exit.value.id);
      return exit.value;
    };

    const issueFor = async (
      campaign: Awaited<ReturnType<typeof createDraft>>
    ) => {
      const exit = await runAt(
        { seconds: 0 },
        CampaignConfirmationCodeService.pipe(
          Effect.flatMap((codes) =>
            codes.issue({
              campaignId: campaign.id,
              contentHash: hashCampaignContent({
                purpose: campaign.purpose,
                templateKey: campaign.templateKey,
                locales: campaign.content,
              }),
            })
          )
        )
      );
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      return exit.value;
    };

    const confirm = (
      campaignId: CampaignId,
      code: string,
      elapsed: Temporal.DurationLike = { minutes: 5 }
    ) =>
      runAt(
        elapsed,
        CampaignConfirmationCodeService.pipe(
          Effect.flatMap((codes) => codes.confirm({ campaignId, code }))
        )
      );

    test("issues a code that expires after 24 hours", async () => {
      const campaign = await createDraft();
      const issued = await issueFor(campaign);
      expect(issued.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(issued.expiresAt).toEqual(issuedAt.add({ hours: 24 }));
    });

    test("confirms the code as typed, once", async () => {
      const campaign = await createDraft();
      const { code } = await issueFor(campaign);
      const typed = ` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `;

      expect(Exit.isSuccess(await confirm(campaign.id, typed))).toBe(true);
      expect(failure(await confirm(campaign.id, code))).toMatchObject({
        _tag: "CampaignConfirmationRejected",
        reason: "already-confirmed",
      });
    });

    test("rejects an unknown code", async () => {
      const campaign = await createDraft();
      await issueFor(campaign);
      expect(failure(await confirm(campaign.id, "AAAAAAAA"))).toMatchObject({
        reason: "unknown-code",
      });
    });

    test("rejects an expired code", async () => {
      const campaign = await createDraft();
      const { code } = await issueFor(campaign);
      expect(
        failure(await confirm(campaign.id, code, { hours: 24 }))
      ).toMatchObject({ reason: "expired" });
    });

    test("rejects a code a newer test send superseded", async () => {
      const campaign = await createDraft();
      const older = await issueFor(campaign);
      const newer = await issueFor(campaign);
      expect(failure(await confirm(campaign.id, older.code))).toMatchObject({
        reason: "superseded",
      });
      expect(Exit.isSuccess(await confirm(campaign.id, newer.code))).toBe(true);
    });

    test("rejects a code after the content changed", async () => {
      const campaign = await createDraft();
      const { code } = await issueFor(campaign);
      await runAt(
        { minutes: 1 },
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.update({
              campaignId: campaign.id,
              content: campaignContentFixture("Změněno"),
            })
          )
        )
      );
      expect(failure(await confirm(campaign.id, code))).toMatchObject({
        reason: "content-changed",
      });
    });

    test("refuses codes for a campaign that left Draft", async () => {
      const campaign = await createDraft();
      const { code } = await issueFor(campaign);
      await testDatabase.pool.query(
        "update email_campaigns set status = 'sending' where id = $1",
        [campaign.id]
      );
      expect(failure(await confirm(campaign.id, code))).toMatchObject({
        _tag: "CampaignReadOnly",
        status: "sending",
      });
    });
  }
);
