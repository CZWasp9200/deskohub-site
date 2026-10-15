import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Option } from "effect";
import type { CampaignSendId } from "./campaign-identifiers";
import {
  openCampaignUnsubscribeToken,
  signCampaignUnsubscribeToken,
} from "./campaign-unsubscribe-token";

const currentKey = Buffer.alloc(32, 1);
const previousKey = Buffer.alloc(32, 2);
const recipient = {
  sendId: "send-1" as CampaignSendId,
  dotyposCustomerId: DotyposCustomerIdSchema.make("42"),
};

describe("campaign unsubscribe token", () => {
  test("opens to the signed recipient", () => {
    const token = signCampaignUnsubscribeToken(currentKey, recipient);

    expect(openCampaignUnsubscribeToken([currentKey], token)).toEqual(
      Option.some(recipient)
    );
  });

  test("is the same for the same recipient, so a replayed batch matches", () => {
    expect(signCampaignUnsubscribeToken(currentKey, recipient)).toBe(
      signCampaignUnsubscribeToken(currentKey, recipient)
    );
  });

  test("still opens after the signing secret rotates", () => {
    const token = signCampaignUnsubscribeToken(previousKey, recipient);

    expect(
      openCampaignUnsubscribeToken([currentKey, previousKey], token)
    ).toEqual(Option.some(recipient));
  });

  test("rejects a forged, altered, or malformed token", () => {
    const token = signCampaignUnsubscribeToken(currentKey, recipient);
    const [, signature] = token.split(".");
    const otherRecipient = signCampaignUnsubscribeToken(currentKey, {
      ...recipient,
      dotyposCustomerId: DotyposCustomerIdSchema.make("43"),
    });
    const [otherPayload] = otherRecipient.split(".");

    for (const candidate of [
      signCampaignUnsubscribeToken(previousKey, recipient),
      `${otherPayload}.${signature}`,
      `${token}.extra`,
      "",
      "not-a-token",
    ]) {
      expect(openCampaignUnsubscribeToken([currentKey], candidate)).toEqual(
        Option.none()
      );
    }
  });
});
