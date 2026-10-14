import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CampaignAudienceRow,
  emailCampaignAudiences,
  emailCampaigns,
} from "@/db/schema";
import { currentInstant } from "@/shared/utils/temporal";
import type { AudienceFilter } from "../audience-filter";
import type { CampaignAudienceId } from "../campaign-identifiers";
import { CampaignAudienceInUse, CampaignAudienceNotFound } from "../errors";

type CampaignAudience = CampaignAudienceRow;

type CampaignAudienceInput = {
  readonly title: string;
  readonly filter: AudienceFilter;
};

export interface ICampaignAudienceService {
  readonly list: (input: {
    readonly includeArchived: boolean;
  }) => Effect.Effect<readonly CampaignAudience[], EffectDrizzleQueryError>;
  readonly get: (
    audienceId: CampaignAudienceId
  ) => Effect.Effect<
    CampaignAudience,
    CampaignAudienceNotFound | EffectDrizzleQueryError
  >;
  readonly create: (
    input: CampaignAudienceInput
  ) => Effect.Effect<CampaignAudience, EffectDrizzleQueryError>;
  /** Draft campaigns follow the change; sent campaigns keep their snapshot. */
  readonly update: (
    input: {
      readonly audienceId: CampaignAudienceId;
    } & Partial<CampaignAudienceInput>
  ) => Effect.Effect<
    CampaignAudience,
    CampaignAudienceNotFound | EffectDrizzleQueryError
  >;
  readonly archive: (
    audienceId: CampaignAudienceId
  ) => Effect.Effect<
    CampaignAudience,
    CampaignAudienceNotFound | EffectDrizzleQueryError
  >;
  /** Deletes an audience no draft campaign uses; sent campaigns detach. */
  readonly delete: (
    audienceId: CampaignAudienceId
  ) => Effect.Effect<
    void,
    CampaignAudienceNotFound | CampaignAudienceInUse | EffectDrizzleQueryError
  >;
}

/** Saved campaign audiences: named filter trees that campaigns select. */
export class CampaignAudienceService extends Context.Service<
  CampaignAudienceService,
  ICampaignAudienceService
>()("@deskohub-workspace/email-campaigns/CampaignAudienceService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const requireUpdated =
        (audienceId: CampaignAudienceId) =>
        (rows: readonly CampaignAudience[]) =>
          rows[0]
            ? Effect.succeed(rows[0])
            : Effect.fail(new CampaignAudienceNotFound({ audienceId }));

      const draftsUsing = (audienceId: CampaignAudienceId) =>
        db
          .select({ id: emailCampaigns.id })
          .from(emailCampaigns)
          .where(
            and(
              eq(emailCampaigns.audienceId, audienceId),
              eq(emailCampaigns.status, "draft")
            )
          )
          .orderBy(asc(emailCampaigns.id));

      return {
        list: Effect.fn("CampaignAudienceService.list")(function* ({
          includeArchived,
        }) {
          return yield* db
            .select()
            .from(emailCampaignAudiences)
            .where(
              includeArchived
                ? undefined
                : isNull(emailCampaignAudiences.archivedAt)
            )
            .orderBy(
              asc(emailCampaignAudiences.title),
              asc(emailCampaignAudiences.id)
            );
        }),
        get: Effect.fn("CampaignAudienceService.get")(function* (audienceId) {
          return yield* db
            .select()
            .from(emailCampaignAudiences)
            .where(eq(emailCampaignAudiences.id, audienceId))
            .pipe(Effect.flatMap(requireUpdated(audienceId)));
        }),
        create: Effect.fn("CampaignAudienceService.create")(function* (input) {
          const [audience] = yield* db
            .insert(emailCampaignAudiences)
            .values({ title: input.title, filter: input.filter })
            .returning();
          return audience!;
        }),
        update: Effect.fn("CampaignAudienceService.update")(function* ({
          audienceId,
          title,
          filter,
        }) {
          const updatedAt = yield* currentInstant;
          return yield* db
            .update(emailCampaignAudiences)
            .set({ title, filter, updatedAt })
            .where(eq(emailCampaignAudiences.id, audienceId))
            .returning()
            .pipe(Effect.flatMap(requireUpdated(audienceId)));
        }),
        archive: Effect.fn("CampaignAudienceService.archive")(
          function* (audienceId) {
            const archivedAt = yield* currentInstant;
            return yield* db
              .update(emailCampaignAudiences)
              .set({
                archivedAt: sql`coalesce(${emailCampaignAudiences.archivedAt}, ${sql.param(archivedAt, emailCampaignAudiences.archivedAt)})`,
                updatedAt: archivedAt,
              })
              .where(eq(emailCampaignAudiences.id, audienceId))
              .returning()
              .pipe(Effect.flatMap(requireUpdated(audienceId)));
          }
        ),
        delete: Effect.fn("CampaignAudienceService.delete")(
          function* (audienceId) {
            const deleted = yield* db
              .delete(emailCampaignAudiences)
              .where(
                and(
                  eq(emailCampaignAudiences.id, audienceId),
                  sql`not exists (
                    select 1 from ${emailCampaigns}
                    where ${emailCampaigns.audienceId} = ${emailCampaignAudiences.id}
                      and ${emailCampaigns.status} = 'draft'
                  )`
                )
              )
              .returning({ id: emailCampaignAudiences.id });
            if (deleted.length > 0) return;

            const drafts = yield* draftsUsing(audienceId);
            if (drafts.length > 0) {
              return yield* new CampaignAudienceInUse({
                audienceId,
                draftCampaignIds: drafts.map(({ id }) => id),
              });
            }
            return yield* new CampaignAudienceNotFound({ audienceId });
          }
        ),
      } satisfies ICampaignAudienceService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
