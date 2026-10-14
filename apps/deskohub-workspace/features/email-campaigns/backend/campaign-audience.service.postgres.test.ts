import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Layer } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CampaignAudienceId, CampaignId } from "../campaign-identifiers";
import { CampaignService } from "./campaign.service";
import { CampaignAudienceService } from "./campaign-audience.service";
import {
  campaignContentFixture,
  everyoneFilter,
} from "./email-campaigns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "CampaignAudienceService on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const audienceIds: CampaignAudienceId[] = [];
    const campaignIds: CampaignId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from email_campaigns where id = any($1)",
        [campaignIds]
      );
      await testDatabase.pool.query(
        "delete from email_campaign_audiences where id = any($1)",
        [audienceIds]
      );
    });

    const run = <A, E>(
      effect: Effect.Effect<A, E, CampaignAudienceService | CampaignService>
    ) =>
      Effect.runPromiseExit(
        effect.pipe(
          Effect.provide(
            Layer.mergeAll(
              CampaignAudienceService.Default,
              CampaignService.Default
            ).pipe(Layer.provide(testDatabase.layer))
          )
        )
      );

    const failure = (exit: Exit.Exit<unknown, unknown>) =>
      Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

    const createAudience = async (title: string) => {
      const exit = await run(
        CampaignAudienceService.use((audiences) =>
          audiences.create({ title, filter: everyoneFilter })
        )
      );
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      audienceIds.push(exit.value.id);
      return exit.value;
    };

    const createCampaign = async (audienceId: CampaignAudienceId) => {
      const exit = await run(
        CampaignService.use((campaigns) =>
          campaigns.create({
            title: "Spring news",
            purpose: "marketing",
            templateKey: "workspace",
            content: campaignContentFixture(),
            audienceId,
          })
        )
      );
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      campaignIds.push(exit.value.id);
      return exit.value;
    };

    test("blocks deleting an audience a draft uses, but allows archiving it", async () => {
      const audience = await createAudience("Regulars");
      const draft = await createCampaign(audience.id);

      const deletion = await run(
        CampaignAudienceService.use((audiences) =>
          audiences.delete(audience.id)
        )
      );
      expect(failure(deletion)).toMatchObject({
        _tag: "CampaignAudienceInUse",
        draftCampaignIds: [draft.id],
      });

      const archived = await run(
        CampaignAudienceService.use((audiences) =>
          audiences.archive(audience.id)
        )
      );
      expect(
        Exit.isSuccess(archived) && archived.value.archivedAt
      ).toBeTruthy();

      const listed = await run(
        CampaignAudienceService.use((audiences) =>
          audiences.list({ includeArchived: false })
        )
      );
      expect(
        Exit.isSuccess(listed) &&
          listed.value.some(({ id }) => id === audience.id)
      ).toBe(false);
    });

    test("refuses to assign an archived audience to a campaign", async () => {
      const audience = await createAudience("Former members");
      await run(
        CampaignAudienceService.use((audiences) =>
          audiences.archive(audience.id)
        )
      );
      const creation = await run(
        CampaignService.use((campaigns) =>
          campaigns.create({
            title: "Win-back",
            purpose: "operational",
            templateKey: "workspace",
            content: campaignContentFixture(),
            audienceId: audience.id,
          })
        )
      );
      expect(failure(creation)).toMatchObject({
        _tag: "CampaignAudienceArchived",
      });
    });

    test("deletes an audience only sent campaigns used and keeps their snapshot", async () => {
      const audience = await createAudience("One-off");
      const campaign = await createCampaign(audience.id);
      await testDatabase.pool.query(
        "update email_campaigns set status = 'sent' where id = $1",
        [campaign.id]
      );
      await testDatabase.pool.query(
        "insert into email_campaign_sends (campaign_id, audience_id, audience_filter, content_hash) values ($1, $2, $3, 'hash')",
        [campaign.id, audience.id, JSON.stringify(everyoneFilter)]
      );

      const deletion = await run(
        CampaignAudienceService.use((audiences) =>
          audiences.delete(audience.id)
        )
      );
      expect(Exit.isSuccess(deletion)).toBe(true);
      const { rows } = await testDatabase.pool.query(
        "select audience_id, audience_filter from email_campaign_sends where campaign_id = $1",
        [campaign.id]
      );
      expect(rows).toEqual([
        { audience_id: null, audience_filter: everyoneFilter },
      ]);
      await testDatabase.pool.query(
        "delete from email_campaign_sends where campaign_id = $1",
        [campaign.id]
      );
    });

    test("reports a missing audience", async () => {
      const deletion = await run(
        CampaignAudienceService.use((audiences) =>
          audiences.delete("missing" as CampaignAudienceId)
        )
      );
      expect(failure(deletion)).toMatchObject({
        _tag: "CampaignAudienceNotFound",
      });
    });
  }
);
