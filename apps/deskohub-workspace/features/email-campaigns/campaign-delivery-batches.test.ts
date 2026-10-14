import { describe, expect, test } from "bun:test";
import {
  campaignDeliveryBatchIdempotencyKey,
  chunkCampaignDeliveryBatches,
} from "./campaign-delivery-batches";
import type { CampaignSendId } from "./campaign-identifiers";

const sendId = "send-1" as CampaignSendId;

describe("campaign delivery batches", () => {
  test("splits recipients into batches of at most 100 in their order", () => {
    const recipients = Array.from({ length: 250 }, (_, index) => index);

    const batches = chunkCampaignDeliveryBatches(recipients);

    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(recipients);
  });

  test("gives an empty attempt no batches", () => {
    expect(chunkCampaignDeliveryBatches([])).toEqual([]);
  });

  test("keys a batch by send, attempt, and index", () => {
    const key = campaignDeliveryBatchIdempotencyKey({
      sendId,
      deliveryAttempt: 1,
      batchIndex: 0,
    });

    expect(
      campaignDeliveryBatchIdempotencyKey({
        sendId,
        deliveryAttempt: 1,
        batchIndex: 0,
      })
    ).toBe(key);
    expect(
      new Set([
        key,
        campaignDeliveryBatchIdempotencyKey({
          sendId,
          deliveryAttempt: 1,
          batchIndex: 1,
        }),
        campaignDeliveryBatchIdempotencyKey({
          sendId,
          deliveryAttempt: 2,
          batchIndex: 0,
        }),
        campaignDeliveryBatchIdempotencyKey({
          sendId: "send-2" as CampaignSendId,
          deliveryAttempt: 1,
          batchIndex: 0,
        }),
      ]).size
    ).toBe(4);
    expect(key.length).toBeLessThanOrEqual(256);
  });
});
