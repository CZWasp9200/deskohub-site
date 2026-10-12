import { handleCallback } from "@vercel/queue";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  processPaidFulfillmentMessage,
  WorkspacePaidFulfillmentService,
} from "@/features/checkout/backend/fulfillment";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { defineWorkspaceTask } from "@/shared/backend/workspace-effect";

export const maxDuration = 300;

const ConsumerLive = Layer.mergeAll(
  WorkspacePaidFulfillmentService.Live,
  WorkspaceReservationRepository.Default.pipe(
    Layer.provide(WorkspaceDatabase.Default)
  )
);

const processMessage = defineWorkspaceTask(
  "paidFulfillmentQueue",
  (message: Parameters<typeof processPaidFulfillmentMessage>[0]) =>
    processPaidFulfillmentMessage(message).pipe(
      Effect.asVoid,
      Effect.provide(ConsumerLive)
    )
);

export const POST = handleCallback((message, _metadata) =>
  processMessage(message)
);
