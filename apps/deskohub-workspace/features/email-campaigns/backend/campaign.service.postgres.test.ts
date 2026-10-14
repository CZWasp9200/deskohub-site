import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Layer } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CampaignId } from "../campaign-identifiers";
import { CampaignService } from "./campaign.service";
import { campaignContentFixture } from "./email-campaigns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)("CampaignService on disposable Postgres", () => {
  if (!testDatabase) return;
  const campaignIds: CampaignId[] = [];

  afterAll(async () => {
    await testDatabase.pool.query(
      "delete from email_campaigns where id = any($1)",
      [campaignIds]
    );
  });

  const run = <A, E>(effect: Effect.Effect<A, E, CampaignService>) =>
    Effect.runPromiseExit(
      effect.pipe(
        Effect.provide(
          CampaignService.Default.pipe(Layer.provide(testDatabase.layer))
        )
      )
    );

  const failure = (exit: Exit.Exit<unknown, unknown>) =>
    Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

  const createDraft = async () => {
    const exit = await run(
      CampaignService.use((campaigns) =>
        campaigns.create({
          title: "Opening hours",
          purpose: "operational",
          templateKey: "workspace",
          content: campaignContentFixture(),
          audienceId: null,
        })
      )
    );
    if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
    campaignIds.push(exit.value.id);
    return exit.value;
  };

  test("edits a draft", async () => {
    const draft = await createDraft();
    const updated = await run(
      CampaignService.use((campaigns) =>
        campaigns.update({
          campaignId: draft.id,
          title: "New opening hours",
          content: campaignContentFixture("Nově otevřeno"),
        })
      )
    );
    expect(Exit.isSuccess(updated) && updated.value).toMatchObject({
      title: "New opening hours",
      content: campaignContentFixture("Nově otevřeno"),
      status: "draft",
    });
  });

  test("rejects content that breaks the body rules", async () => {
    const draft = await createDraft();
    const content = campaignContentFixture();
    const update = await run(
      CampaignService.use((campaigns) =>
        campaigns.update({
          campaignId: draft.id,
          content: {
            "cs-CZ": {
              ...content["cs-CZ"]!,
              body: {
                formatVersion: 1,
                doc: { type: "doc", content: [{ type: "unknownNode" }] },
              },
            },
          },
        })
      )
    );
    expect(failure(update)).toMatchObject({ _tag: "CampaignContentInvalid" });
  });

  test("makes a campaign read-only once it leaves Draft", async () => {
    const campaign = await createDraft();
    await testDatabase.pool.query(
      "update email_campaigns set status = 'sent' where id = $1",
      [campaign.id]
    );

    const update = await run(
      CampaignService.use((campaigns) =>
        campaigns.update({ campaignId: campaign.id, title: "Changed" })
      )
    );
    expect(failure(update)).toMatchObject({
      _tag: "CampaignReadOnly",
      status: "sent",
    });
    const deletion = await run(
      CampaignService.use((campaigns) => campaigns.delete(campaign.id))
    );
    expect(failure(deletion)).toMatchObject({ _tag: "CampaignReadOnly" });
    const stored = await run(
      CampaignService.use((campaigns) => campaigns.get(campaign.id))
    );
    expect(Exit.isSuccess(stored) && stored.value.title).toBe("Opening hours");
  });

  test("duplicates a sent campaign into a new draft", async () => {
    const campaign = await createDraft();
    await testDatabase.pool.query(
      "update email_campaigns set status = 'sent' where id = $1",
      [campaign.id]
    );
    const copy = await run(
      CampaignService.use((campaigns) => campaigns.duplicate(campaign.id))
    );
    if (Exit.isFailure(copy)) throw Cause.squash(copy.cause);
    campaignIds.push(copy.value.id);
    expect(copy.value).toMatchObject({
      title: campaign.title,
      purpose: campaign.purpose,
      templateKey: campaign.templateKey,
      content: campaign.content,
      audienceId: campaign.audienceId,
      status: "draft",
    });
    expect(copy.value.id).not.toBe(campaign.id);
  });

  test("deletes a draft and reports a missing campaign", async () => {
    const draft = await createDraft();
    const deletion = await run(
      CampaignService.use((campaigns) => campaigns.delete(draft.id))
    );
    expect(Exit.isSuccess(deletion)).toBe(true);
    const lookup = await run(
      CampaignService.use((campaigns) => campaigns.get(draft.id))
    );
    expect(failure(lookup)).toMatchObject({ _tag: "CampaignNotFound" });
  });
});
