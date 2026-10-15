import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { Option, Schema } from "effect";
import {
  type CampaignSendId,
  campaignSendIdSchema,
} from "./campaign-identifiers";

/** The frozen recipient an unsubscribe link speaks for. */
export type CampaignUnsubscribeRecipient = {
  readonly sendId: CampaignSendId;
  readonly dotyposCustomerId: DotyposCustomerId;
};

const tokenPayloadSchema = Schema.fromJsonString(
  Schema.Tuple([campaignSendIdSchema, DotyposCustomerIdSchema])
);

const signature = (key: Buffer, payload: string) =>
  createHmac("sha256", key).update(payload).digest();

/**
 * Signs a recipient into an unsubscribe token. It carries no expiry: a
 * one-click unsubscribe link must keep working for as long as the email
 * sits in an inbox, and the token is deterministic so a replayed provider
 * batch renders the same email.
 */
export const signCampaignUnsubscribeToken = (
  key: Buffer,
  recipient: CampaignUnsubscribeRecipient
) => {
  const payload = Buffer.from(
    JSON.stringify([recipient.sendId, recipient.dotyposCustomerId])
  ).toString("base64url");
  return `${payload}.${signature(key, payload).toString("base64url")}`;
};

/**
 * Opens a token signed by any of `keys`, so links in sent emails survive a
 * signing-secret rotation while the old secret stays listed.
 */
export const openCampaignUnsubscribeToken = (
  keys: readonly Buffer[],
  token: string
): Option.Option<CampaignUnsubscribeRecipient> => {
  const [payload, signed, ...rest] = token.split(".");
  if (!payload || !signed || rest.length > 0) return Option.none();
  const presented = Buffer.from(signed, "base64url");
  const authentic = keys.some((key) => {
    const expected = signature(key, payload);
    return (
      presented.length === expected.length &&
      timingSafeEqual(presented, expected)
    );
  });
  if (!authentic) return Option.none();
  return Schema.decodeUnknownOption(tokenPayloadSchema)(
    Buffer.from(payload, "base64url").toString("utf8")
  ).pipe(
    Option.map(([sendId, dotyposCustomerId]) => ({ sendId, dotyposCustomerId }))
  );
};
