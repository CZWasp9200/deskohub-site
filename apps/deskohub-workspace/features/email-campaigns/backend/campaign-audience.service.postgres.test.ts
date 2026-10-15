import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Layer } from "effect";
import {
  holdPostgresTransaction,
  waitForPostgresLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
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
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) =>
            audiences.create({ title, filter: everyoneFilter })
          )
        )
      );
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      audienceIds.push(exit.value.id);
      return exit.value;
    };

    const createCampaign = async (audienceId: CampaignAudienceId) => {
      const exit = await run(
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.create({
              title: "Spring news",
              purpose: "marketing",
              templateKey: "workspace",
              content: campaignContentFixture(),
              audienceId,
            })
          )
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
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.delete(audience.id))
        )
      );
      expect(failure(deletion)).toMatchObject({
        _tag: "CampaignAudienceInUse",
        draftCampaignIds: [draft.id],
      });

      const archived = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.archive(audience.id))
        )
      );
      expect(
        Exit.isSuccess(archived) && archived.value.archivedAt
      ).toBeTruthy();

      const listed = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) =>
            audiences.list({ includeArchived: false })
          )
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
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.archive(audience.id))
        )
      );
      const creation = await run(
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.create({
              title: "Win-back",
              purpose: "operational",
              templateKey: "workspace",
              content: campaignContentFixture(),
              audienceId: audience.id,
            })
          )
        )
      );
      expect(failure(creation)).toMatchObject({
        _tag: "CampaignAudienceArchived",
      });
    });

    const unarchiveAudience = (audienceId: CampaignAudienceId) =>
      run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.unarchive(audienceId))
        )
      );

    test("unarchives an audience so new campaigns can select it again", async () => {
      const audience = await createAudience("Returning members");
      await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.archive(audience.id))
        )
      );

      const unarchived = await unarchiveAudience(audience.id);
      expect(Exit.isSuccess(unarchived) && unarchived.value.archivedAt).toBe(
        null
      );
      const listed = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) =>
            audiences.list({ includeArchived: false })
          )
        )
      );
      expect(
        Exit.isSuccess(listed) &&
          listed.value.some(({ id }) => id === audience.id)
      ).toBe(true);
      const draft = await createCampaign(audience.id);
      expect(draft.audienceId).toBe(audience.id);
    });

    test("reports a missing audience to unarchive", async () => {
      const missing = await createAudience("Gone before unarchive");
      await testDatabase.pool.query(
        "delete from email_campaign_audiences where id = $1",
        [missing.id]
      );

      expect(failure(await unarchiveAudience(missing.id))).toMatchObject({
        _tag: "CampaignAudienceNotFound",
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
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.delete(audience.id))
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

    const createDraftWithoutAudience = async () => {
      const exit = await run(
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.create({
              title: "Unassigned",
              purpose: "marketing",
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

    const storedAudienceId = async (campaignId: CampaignId) => {
      const { rows } = await testDatabase.pool.query(
        "select audience_id from email_campaigns where id = $1",
        [campaignId]
      );
      return rows[0]?.audience_id as CampaignAudienceId | null;
    };

    /** Holds `sql` uncommitted until `action` waits on its locks. */
    const raceBehind = async <A>(
      held: { readonly sql: string; readonly values: readonly unknown[] },
      action: () => Promise<A>
    ) => {
      const blocker = await holdPostgresTransaction(
        testDatabase.pool,
        held.sql,
        held.values
      );
      const pending = action();
      await waitForPostgresLockWaiter(testDatabase.pool, {
        condition: "$1 = any(pg_blocking_pids(pid))",
        values: [blocker.pid],
        description: "the service call to wait on the held transaction",
      });
      await blocker.commit();
      return { result: await pending, heldRows: blocker.rows };
    };

    const deleteAudience = (audienceId: CampaignAudienceId) =>
      run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.delete(audienceId))
        )
      );

    test("refuses a deletion that waited on a new draft using the audience", async () => {
      const audience = await createAudience("Racing insert");
      const { result, heldRows } = await raceBehind(
        {
          sql: `insert into email_campaigns (title, purpose, template_key, audience_id)
                values ('Racing', 'marketing', 'workspace', $1) returning id`,
          values: [audience.id],
        },
        () => deleteAudience(audience.id)
      );
      const draftId = heldRows[0].id as CampaignId;
      campaignIds.push(draftId);

      expect(failure(result)).toMatchObject({
        _tag: "CampaignAudienceInUse",
        draftCampaignIds: [draftId],
      });
      expect(await storedAudienceId(draftId)).toBe(audience.id);
    });

    test("refuses a deletion that waited on a draft moving to the audience", async () => {
      const audience = await createAudience("Racing update");
      const draft = await createDraftWithoutAudience();
      const { result } = await raceBehind(
        {
          sql: "update email_campaigns set audience_id = $2 where id = $1",
          values: [draft.id, audience.id],
        },
        () => deleteAudience(audience.id)
      );

      expect(failure(result)).toMatchObject({
        _tag: "CampaignAudienceInUse",
        draftCampaignIds: [draft.id],
      });
      expect(await storedAudienceId(draft.id)).toBe(audience.id);
    });

    test("unarchives after waiting on an archive that holds the audience row", async () => {
      const audience = await createAudience("Archived under unarchive");
      const { result } = await raceBehind(
        {
          sql: "update email_campaign_audiences set archived_at = now() where id = $1",
          values: [audience.id],
        },
        () => unarchiveAudience(audience.id)
      );

      expect(Exit.isSuccess(result) && result.value.archivedAt).toBe(null);
      const { rows } = await testDatabase.pool.query(
        "select archived_at from email_campaign_audiences where id = $1",
        [audience.id]
      );
      expect(rows).toEqual([{ archived_at: null }]);
    });

    const heldDeletion = (audienceId: CampaignAudienceId) => ({
      sql: "delete from email_campaign_audiences where id = $1",
      values: [audienceId],
    });

    test("reports a missing audience to a draft created behind its deletion", async () => {
      const audience = await createAudience("Deleted under create");
      const { result } = await raceBehind(heldDeletion(audience.id), () =>
        run(
          CampaignService.pipe(
            Effect.flatMap((campaigns) =>
              campaigns.create({
                title: "Too late",
                purpose: "marketing",
                templateKey: "workspace",
                content: campaignContentFixture(),
                audienceId: audience.id,
              })
            )
          )
        )
      );
      if (Exit.isSuccess(result)) campaignIds.push(result.value.id);

      expect(failure(result)).toMatchObject({
        _tag: "CampaignAudienceNotFound",
      });
    });

    test("reports a missing audience to a draft moved to it behind its deletion", async () => {
      const audience = await createAudience("Deleted under update");
      const draft = await createDraftWithoutAudience();
      const { result } = await raceBehind(heldDeletion(audience.id), () =>
        run(
          CampaignService.pipe(
            Effect.flatMap((campaigns) =>
              campaigns.update({
                campaignId: draft.id,
                audienceId: audience.id,
              })
            )
          )
        )
      );

      expect(failure(result)).toMatchObject({
        _tag: "CampaignAudienceNotFound",
      });
      expect(await storedAudienceId(draft.id)).toBeNull();
    });

    test("duplicates a sent campaign without the audience deleted under it", async () => {
      const audience = await createAudience("Deleted under duplicate");
      const sent = await createCampaign(audience.id);
      await testDatabase.pool.query(
        "update email_campaigns set status = 'sent' where id = $1",
        [sent.id]
      );
      const { result } = await raceBehind(heldDeletion(audience.id), () =>
        run(
          CampaignService.pipe(
            Effect.flatMap((campaigns) => campaigns.duplicate(sent.id))
          )
        )
      );
      if (Exit.isSuccess(result)) campaignIds.push(result.value.id);

      expect(Exit.isSuccess(result) && result.value.audienceId).toBeNull();
    });

    const duplicate = (campaignId: CampaignId) =>
      run(
        CampaignService.pipe(
          Effect.flatMap((campaigns) => campaigns.duplicate(campaignId))
        )
      ).then((exit) => {
        if (Exit.isSuccess(exit)) campaignIds.push(exit.value.id);
        return exit;
      });

    test("duplicates a draft without its archived audience", async () => {
      const audience = await createAudience("Archived before duplicate");
      const draft = await createCampaign(audience.id);
      await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.archive(audience.id))
        )
      );

      const copy = await duplicate(draft.id);
      expect(Exit.isSuccess(copy) && copy.value.audienceId).toBeNull();
      expect(await storedAudienceId(draft.id)).toBe(audience.id);
    });

    test("duplicates a draft without the audience archived under it", async () => {
      const audience = await createAudience("Archived under duplicate");
      const draft = await createCampaign(audience.id);
      const { result } = await raceBehind(
        {
          sql: "update email_campaign_audiences set archived_at = now() where id = $1",
          values: [audience.id],
        },
        () => duplicate(draft.id)
      );

      expect(Exit.isSuccess(result) && result.value.audienceId).toBeNull();
    });

    test("refuses a draft created behind the audience's archiving", async () => {
      const audience = await createAudience("Archived under create");
      const { result } = await raceBehind(
        {
          sql: "update email_campaign_audiences set archived_at = now() where id = $1",
          values: [audience.id],
        },
        () =>
          run(
            CampaignService.pipe(
              Effect.flatMap((campaigns) =>
                campaigns.create({
                  title: "Too late",
                  purpose: "marketing",
                  templateKey: "workspace",
                  content: campaignContentFixture(),
                  audienceId: audience.id,
                })
              )
            )
          )
      );
      if (Exit.isSuccess(result)) campaignIds.push(result.value.id);

      expect(failure(result)).toMatchObject({
        _tag: "CampaignAudienceArchived",
      });
    });

    test("reports a missing audience", async () => {
      const deletion = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) =>
            audiences.delete("missing" as CampaignAudienceId)
          )
        )
      );
      expect(failure(deletion)).toMatchObject({
        _tag: "CampaignAudienceNotFound",
      });
    });
  }
);
