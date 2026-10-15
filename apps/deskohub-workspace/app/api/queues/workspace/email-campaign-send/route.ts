import { handleCallback } from "@vercel/queue";
import { Effect } from "effect";
import { CampaignDeliveryService } from "@/features/email-campaigns/backend/campaign-delivery.service";
import { processCampaignSendMessage } from "@/features/email-campaigns/backend/campaign-send-queue-consumer";
import { defineWorkspaceTask } from "@/shared/backend/workspace-effect";

export const maxDuration = 300;

const processMessage = defineWorkspaceTask(
  "emailCampaignSendQueue",
  (message: Parameters<typeof processCampaignSendMessage>[0]) =>
    processCampaignSendMessage(message).pipe(
      Effect.asVoid,
      Effect.provide(CampaignDeliveryService.Live)
    )
);

export const POST = handleCallback((message, _metadata) =>
  processMessage(message)
);
