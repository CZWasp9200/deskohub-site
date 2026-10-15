import { describe, expect, mock, test } from "bun:test";
import { DuplicateMessageError } from "@vercel/queue";
import { Effect, Exit } from "effect";
import type { CampaignSendId } from "../campaign-identifiers";
import {
  campaignSendQueueTopic,
  makeCampaignSendQueueService,
} from "./campaign-send-queue.service";

const sendId = "send-1" as CampaignSendId;

describe("campaign send queue", () => {
  test("enqueues one idempotent message per delivery attempt", async () => {
    const send = mock(() => Promise.resolve({} as never));

    await makeCampaignSendQueueService(send as never)
      .enqueue({ sendId, deliveryAttempt: 2 })
      .pipe(Effect.runPromise);

    expect(send).toHaveBeenCalledWith(
      campaignSendQueueTopic,
      { sendId, deliveryAttempt: 2 },
      expect.objectContaining({
        idempotencyKey: "email-campaign-send:send-1:2",
      })
    );
  });

  test("treats a duplicate message as already enqueued", async () => {
    const send = mock(() => Promise.reject(new DuplicateMessageError("dup")));

    const exit = await makeCampaignSendQueueService(send as never)
      .enqueue({ sendId, deliveryAttempt: 1 })
      .pipe(Effect.runPromiseExit);

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  test("fails with a queue error when the queue is unavailable", async () => {
    const send = mock(() => Promise.reject(new Error("unavailable")));

    const exit = await makeCampaignSendQueueService(send as never)
      .enqueue({ sendId, deliveryAttempt: 1 })
      .pipe(Effect.runPromiseExit);

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
