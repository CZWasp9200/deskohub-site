import "server-only";

import { Effect, Layer, Option } from "effect";
import { cache } from "react";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { CampaignAudienceService } from "../../backend/campaign-audience.service";
import { CampaignSendStatusService } from "../../backend/campaign-send-status.service";
import type { CampaignId } from "../../campaign-identifiers";

/**
 * The campaign's send status and the current title of the audience it
 * snapshotted. The caller already authorized the page.
 */
export const loadSentCampaign = cache(
  Effect.fn(
    function* (campaignId: CampaignId) {
      const sendStatus = yield* CampaignSendStatusService;
      const audiences = yield* CampaignAudienceService;
      const send = yield* sendStatus.get({ campaignId });
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
            CampaignSendStatusService.Live,
            CampaignAudienceService.Live
          )
        ),
        runWorkspaceEffect("email-campaigns.admin.load-sent-campaign", {
          boundary: "route",
        })
      )
  )
);
