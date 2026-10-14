import "server-only";

import { and, desc, eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CampaignRow,
  emailCampaignAudiences,
  emailCampaigns,
} from "@/db/schema";
import { currentInstant } from "@/shared/utils/temporal";
import {
  CampaignLocalizedContent,
  type CampaignPurpose,
  type CampaignTemplateKey,
} from "../body/campaign-content";
import type { CampaignAudienceId, CampaignId } from "../campaign-identifiers";
import {
  CampaignAudienceArchived,
  CampaignAudienceNotFound,
  CampaignContentInvalid,
  CampaignNotFound,
  CampaignReadOnly,
} from "../errors";

type Campaign = CampaignRow;

type CampaignDraftInput = {
  readonly title: string;
  readonly purpose: CampaignPurpose;
  readonly templateKey: CampaignTemplateKey;
  readonly content: CampaignLocalizedContent;
  readonly audienceId: CampaignAudienceId | null;
};

type CampaignWriteError =
  | CampaignAudienceNotFound
  | CampaignAudienceArchived
  | CampaignContentInvalid;

export interface ICampaignService {
  readonly list: Effect.Effect<readonly Campaign[], EffectDrizzleQueryError>;
  readonly get: (
    campaignId: CampaignId
  ) => Effect.Effect<Campaign, CampaignNotFound | EffectDrizzleQueryError>;
  readonly create: (
    input: CampaignDraftInput
  ) => Effect.Effect<Campaign, CampaignWriteError | EffectDrizzleQueryError>;
  /**
   * Edits a Draft; a campaign that left Draft is read-only. The edit's row
   * update waits on a confirmation's campaign row lock and then rechecks the
   * status, so content can't change between a confirmation's content check
   * and its move to Sending.
   */
  readonly update: (
    input: { readonly campaignId: CampaignId } & Partial<CampaignDraftInput>
  ) => Effect.Effect<
    Campaign,
    | CampaignNotFound
    | CampaignReadOnly
    | CampaignWriteError
    | EffectDrizzleQueryError
  >;
  /** Deletes a Draft; a campaign that left Draft keeps its history. */
  readonly delete: (
    campaignId: CampaignId
  ) => Effect.Effect<
    void,
    CampaignNotFound | CampaignReadOnly | EffectDrizzleQueryError
  >;
  /** Copies a campaign of any status into a new Draft. */
  readonly duplicate: (
    campaignId: CampaignId
  ) => Effect.Effect<Campaign, CampaignNotFound | EffectDrizzleQueryError>;
}

/** Campaign drafts and the read-only record of sent campaigns. */
export class CampaignService extends Context.Service<
  CampaignService,
  ICampaignService
>()("@deskohub-workspace/email-campaigns/CampaignService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const find = (campaignId: CampaignId) =>
        db
          .select()
          .from(emailCampaigns)
          .where(eq(emailCampaigns.id, campaignId))
          .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));

      const get = (campaignId: CampaignId) =>
        find(campaignId).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new CampaignNotFound({ campaignId })),
              onSome: Effect.succeed,
            })
          )
        );

      /** Explains why a Draft-only write matched no row. */
      const draftWriteRejection = Effect.fn(
        "CampaignService.draftWriteRejection"
      )(function* (campaignId: CampaignId) {
        const { status } = yield* get(campaignId);
        if (status === "draft") {
          return yield* new CampaignNotFound({ campaignId });
        }
        return yield* new CampaignReadOnly({ campaignId, status });
      });

      const ensureAssignableAudience = Effect.fn(
        "CampaignService.ensureAssignableAudience"
      )(function* (audienceId: CampaignAudienceId | null) {
        if (audienceId === null) return;
        const [audience] = yield* db
          .select({ archivedAt: emailCampaignAudiences.archivedAt })
          .from(emailCampaignAudiences)
          .where(eq(emailCampaignAudiences.id, audienceId));
        if (!audience) {
          return yield* new CampaignAudienceNotFound({ audienceId });
        }
        if (audience.archivedAt !== null) {
          return yield* new CampaignAudienceArchived({ audienceId });
        }
      });

      const validateContent = (
        content: CampaignLocalizedContent | undefined
      ) =>
        content === undefined
          ? Effect.void
          : Schema.decodeEffect(CampaignLocalizedContent)(content).pipe(
              Effect.asVoid,
              Effect.mapError((cause) => new CampaignContentInvalid({ cause }))
            );

      return {
        list: db
          .select()
          .from(emailCampaigns)
          .orderBy(desc(emailCampaigns.createdAt), desc(emailCampaigns.id))
          .pipe(Effect.withSpan("CampaignService.list")),
        get: Effect.fn("CampaignService.get")(get),
        create: Effect.fn("CampaignService.create")(function* (input) {
          yield* validateContent(input.content);
          yield* ensureAssignableAudience(input.audienceId);
          const [campaign] = yield* db
            .insert(emailCampaigns)
            .values({ ...input, status: "draft" })
            .returning();
          return campaign!;
        }),
        update: Effect.fn("CampaignService.update")(function* ({
          campaignId,
          ...changes
        }) {
          yield* validateContent(changes.content);
          if (changes.audienceId !== undefined) {
            yield* ensureAssignableAudience(changes.audienceId);
          }
          const updatedAt = yield* currentInstant;
          const [campaign] = yield* db
            .update(emailCampaigns)
            .set({ ...changes, updatedAt })
            .where(
              and(
                eq(emailCampaigns.id, campaignId),
                eq(emailCampaigns.status, "draft")
              )
            )
            .returning();
          return campaign ?? (yield* draftWriteRejection(campaignId));
        }),
        delete: Effect.fn("CampaignService.delete")(function* (campaignId) {
          const deleted = yield* db
            .delete(emailCampaigns)
            .where(
              and(
                eq(emailCampaigns.id, campaignId),
                eq(emailCampaigns.status, "draft")
              )
            )
            .returning({ id: emailCampaigns.id });
          if (deleted.length === 0) {
            return yield* draftWriteRejection(campaignId);
          }
        }),
        duplicate: Effect.fn("CampaignService.duplicate")(
          function* (campaignId) {
            const source = yield* get(campaignId);
            const [campaign] = yield* db
              .insert(emailCampaigns)
              .values({
                title: source.title,
                purpose: source.purpose,
                templateKey: source.templateKey,
                content: source.content,
                audienceId: source.audienceId,
                status: "draft",
              })
              .returning();
            return campaign!;
          }
        ),
      } satisfies ICampaignService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
