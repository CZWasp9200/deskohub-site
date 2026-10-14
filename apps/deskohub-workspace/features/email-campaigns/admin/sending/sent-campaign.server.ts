import "server-only";

import { Effect, Layer, Option } from "effect";
import { cache } from "react";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { CampaignAudienceService } from "../../backend/campaign-audience.service";
import type { CampaignId } from "../../campaign-identifiers";
import { CampaignSendPipeline } from "../campaign-send-pipeline";

/**
 * The campaign's send status and the current title of the audience it
 * snapshotted. The caller already authorized the page.
 */
export const loadSentCampaign = cache(
  Effect.fn(
    function* (campaignId: CampaignId) {
      const pipeline = yield* CampaignSendPipeline;
      const audiences = yield* CampaignAudienceService;
      const send = yield* pipeline.getSendStatus({ campaignId });
      const audienceId = Option.flatMapNullishOr(
        send,
        (status) => status.audienceId
      );
      const audienceTitle = Option.isSome(audienceId)
        ? yield* audiences.get(audienceId.value).pipe(
            Effect.map((audience) => audience.title),
            Effect.catchTag("CampaignAudienceNotFound", () =>
              Effect.succeed(null)
            )
          )
        : null;
      return { send: Option.getOrNull(send), audienceTitle };
    },
    (effect) =>
      effect.pipe(
        Effect.provide(
          Layer.mergeAll(
            CampaignSendPipeline.Live,
            CampaignAudienceService.Live
          )
        ),
        runWorkspaceEffect("email-campaigns.admin.load-sent-campaign", {
          boundary: "route",
        })
      )
  )
);
