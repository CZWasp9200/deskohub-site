import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import { customerMarketingConsents } from "@/db/schema";
import {
  deleteCampaigns,
  seedCampaignSend,
} from "./email-campaigns.test-utils";

type BatchEmail = {
  readonly to: readonly string[];
  readonly subject: string;
  readonly headers?: Record<string, string>;
  readonly tags?: readonly { name: string; value: string }[];
};
type BatchSendResponse =
  | { readonly data: { readonly data: readonly { id: string }[] } }
  | {
      readonly data: null;
      readonly error: { message: string; statusCode: number };
    };

/**
 * Resend's idempotency contract: a key replayed with the identical payload
 * returns the accepted batch without mailing it again, and a key reused with
 * a different payload is rejected. `mailed` lists every email it really sent.
 */
let providerIds = 0;
const acceptedKeys = new Map<
  string,
  { readonly payload: string; readonly ids: readonly string[] }
>();
let mailed: string[] = [];
const acceptBatch = async (
  payload: readonly BatchEmail[],
  options: { readonly idempotencyKey: string }
): Promise<BatchSendResponse> => {
  const body = JSON.stringify(payload);
  const accepted = acceptedKeys.get(options.idempotencyKey);
  if (accepted && accepted.payload !== body) {
    return {
      data: null,
      error: { message: "invalid_idempotent_request", statusCode: 409 },
    };
  }
  const ids =
    accepted?.ids ?? payload.map(() => `resend-${run}-${++providerIds}`);
  if (!accepted) {
    acceptedKeys.set(options.idempotencyKey, { payload: body, ids });
    mailed.push(...payload.flatMap(({ to }) => to));
  }
  return { data: { data: ids.map((id) => ({ id })) } };
};
/** A request that never answers, as when the consumer is cut off. */
const hang = () => new Promise<BatchSendResponse>(() => {});
let batchSend =
  mock<
    (
      payload: readonly BatchEmail[],
      options: { readonly idempotencyKey: string }
    ) => Promise<BatchSendResponse>
  >(acceptBatch);

mock.module("resend", () => ({
  Resend: class {
    batch = {
      send: (...args: Parameters<typeof batchSend>) => batchSend(...args),
    };
    emails = { send: mock() };
    domains = { list: mock() };
  },
}));

const { EmailConfigTag, EmailServiceTag } = await import("@deskohub/email");
const { connectWorkspacePostgresTestDatabase } = await import(
  "@/shared/testing/workspace-postgres-test-database.test-utils"
);
const { CustomerMarketingConsentRepository } = await import(
  "@/features/legal/backend/customer-marketing-consent.repository"
);
const { MarketingManagementService } = await import(
  "@/features/legal/backend/marketing-management.service"
);
const { CampaignDeliveryService } = await import("./campaign-delivery.service");
const { CampaignDeliveryStatusService } = await import(
  "./campaign-delivery-status.service"
);
const { CampaignEmailConfig } = await import("./campaign-email.config");
const { processCampaignSendMessage } = await import(
  "./campaign-send-queue-consumer"
);
const { CampaignUnsubscribeService } = await import(
  "./campaign-unsubscribe.service"
);

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID().slice(0, 8);
const customerId = (name: string) =>
  DotyposCustomerIdSchema.make(`delivery-${run}-${name}`);

describe.skipIf(!testDatabase)(
  "campaign send queue consumer on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db } = testDatabase;
    const campaignIds: string[] = [];
    const consentCustomerIds: DotyposCustomerId[] = [];

    afterAll(async () => {
      await deleteCampaigns(testDatabase.pool, campaignIds);
      await testDatabase.pool.query(
        "delete from customer_marketing_consents where dotypos_customer_id = any($1)",
        [consentCustomerIds]
      );
    });

    beforeEach(() => {
      batchSend = mock(acceptBatch);
      mailed = [];
    });

    let profiles: DotyposCustomer[] = [];
    const profile = (
      id: DotyposCustomerId,
      overrides: Partial<DotyposCustomer> = {}
    ) =>
      ({
        id,
        _cloudId: "cloud",
        email: testEmailAddress(id),
        points: "0",
        flags: "0",
        display: true,
        deleted: false,
        ...overrides,
      }) as DotyposCustomer;

    const consumerLayerFor = (
      deploymentEnvironment: "production" | "development"
    ) =>
      CampaignDeliveryService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            DotyposServiceMock({
              getCustomers: ({ ids }) =>
                Effect.succeed(
                  profiles.filter(
                    (customer) =>
                      customer.id !== undefined && ids.includes(customer.id)
                  )
                ),
            }),
            EmailServiceTag.Live.pipe(
              Layer.provide(
                Layer.succeed(EmailConfigTag, {
                  provider: "resend",
                  apiKey: "re_test",
                  defaultFrom: { email: testEmailAddress("campaigns") },
                })
              )
            ),
            Layer.succeed(CampaignEmailConfig, {
              deploymentEnvironment,
              from: { email: testEmailAddress("campaigns") },
              replyTo: { email: testEmailAddress("hello") },
              adminInbox: testEmailAddress("admin"),
            }),
            CampaignUnsubscribeService.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  CustomerMarketingConsentRepository.Default,
                  MarketingManagementService.Default
                )
              )
            )
          )
        ),
        Layer.provide(testDatabase.layer)
      );

    const consumerLayer = consumerLayerFor("development");

    const consume = (
      message: Parameters<typeof processCampaignSendMessage>[0],
      layer = consumerLayer
    ) =>
      Effect.runPromise(
        processCampaignSendMessage(message).pipe(Effect.provide(layer))
      );

    /**
     * Runs the consumer until `timeout`, then cuts it off as the platform
     * would at its time limit. Returns whether it finished.
     */
    const consumeCutOff = (
      message: Parameters<typeof processCampaignSendMessage>[0],
      timeout = "1 second"
    ) =>
      Effect.runPromise(
        processCampaignSendMessage(message).pipe(
          Effect.provide(consumerLayer),
          Effect.timeoutOption(timeout),
          Effect.map(Option.isSome)
        )
      );

    /** The consumer's run fails, so the queue redelivers the message. */
    const consumeFails = async (
      message: Parameters<typeof processCampaignSendMessage>[0]
    ) => {
      const exit = await Effect.runPromiseExit(
        processCampaignSendMessage(message).pipe(Effect.provide(consumerLayer))
      );
      expect(exit._tag).toBe("Failure");
    };

    const recordWebhook = (event: {
      readonly type: string;
      readonly providerMessageId: string;
      readonly sendId: string;
      readonly dotyposCustomerId: string;
    }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const statuses = yield* CampaignDeliveryStatusService;
          return yield* statuses.record({
            type: event.type,
            providerMessageId: event.providerMessageId,
            tags: new Map([
              ["campaignSendId", event.sendId],
              ["dotyposCustomerId", event.dotyposCustomerId],
            ]),
            occurredAt: Temporal.Now.instant(),
          });
        }).pipe(
          Effect.provide(
            CampaignDeliveryStatusService.Default.pipe(
              Layer.provide(testDatabase.layer)
            )
          )
        )
      );

    const seedSend = async (input: Parameters<typeof seedCampaignSend>[1]) => {
      const seeded = await seedCampaignSend(db, input);
      campaignIds.push(seeded.campaignId);
      return seeded;
    };

    const grantConsent = async (
      ids: readonly DotyposCustomerId[],
      withdrawn = false
    ) => {
      consentCustomerIds.push(...ids);
      const grantedAt = Temporal.Instant.from("2026-01-01T00:00:00Z");
      await Effect.runPromise(
        db.insert(customerMarketingConsents).values(
          ids.map((dotyposCustomerId) => ({
            dotyposCustomerId,
            documentHash: "hash",
            locale: "cs-CZ" as const,
            grantedAt,
            withdrawnAt: withdrawn ? grantedAt : null,
          }))
        )
      );
    };

    const stored = async (sendId: string) => {
      const { rows: recipients } = await testDatabase.pool.query(
        "select dotypos_customer_id, status, skip_reason, provider_message_id from email_campaign_recipients where send_id = $1 order by dotypos_customer_id",
        [sendId]
      );
      const {
        rows: [campaign],
      } = await testDatabase.pool.query(
        "select c.status, s.completed_at from email_campaign_sends s join email_campaigns c on c.id = s.campaign_id where s.id = $1",
        [sendId]
      );
      const { rows: batches } = await testDatabase.pool.query(
        "select delivery_attempt, batch_index, dotypos_customer_ids, status from email_campaign_delivery_batches where send_id = $1 order by delivery_attempt, batch_index",
        [sendId]
      );
      return { recipients, campaign, batches };
    };

    const statusesOf = (
      recipients: readonly { dotypos_customer_id: string; status: string }[]
    ) =>
      Object.fromEntries(
        recipients.map((row) => [row.dotypos_customer_id, row.status])
      );

    const requestKeys = () =>
      batchSend.mock.calls.map(([, options]) => options.idempotencyKey);
    const requestPayloads = () =>
      batchSend.mock.calls.map(([payload]) => JSON.stringify(payload));

    test("sends an attempt in batches of 100, each under its own key", async () => {
      const ids = Array.from({ length: 101 }, (_, index) =>
        customerId(`bulk-${String(index).padStart(3, "0")}`)
      );
      profiles = ids.map((id) => profile(id));
      await grantConsent(ids);
      const { sendId } = await seedSend({
        purpose: "marketing",
        recipients: ids.map((dotyposCustomerId) => ({ dotyposCustomerId })),
      });

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      expect(batchSend.mock.calls.map(([payload]) => payload.length)).toEqual([
        100, 1,
      ]);
      expect(
        batchSend.mock.calls.map(([, options]) => options.idempotencyKey)
      ).toEqual([
        `email-campaign:${sendId}:attempt-1:batch-0`,
        `email-campaign:${sendId}:attempt-1:batch-1`,
      ]);
      const [first] = batchSend.mock.calls[0]![0];
      expect(first).toMatchObject({
        to: [testEmailAddress(ids[0]!)],
        subject: "Novinky",
        headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      expect(first!.headers!["List-Unsubscribe"]).toMatch(
        /^<https?:\/\/.+\/api\/email-campaigns\/unsubscribe\?token=.+>$/
      );
      expect(first!.tags).toEqual(
        expect.arrayContaining([
          { name: "category", value: "email-campaign" },
          { name: "campaignSendId", value: sendId },
          { name: "dotyposCustomerId", value: ids[0] },
        ])
      );

      const { recipients, campaign } = await stored(sendId);
      expect(recipients.every((row) => row.status === "sent")).toBe(true);
      expect(
        new Set(recipients.map((row) => row.provider_message_id)).size
      ).toBe(101);
      expect(campaign.status).toBe("sent");
      expect(campaign.completed_at).not.toBeNull();
    });

    test("skips recipients who withdrew consent or lost a valid email", async () => {
      const reachable = customerId("skip-reachable");
      const withdrawn = customerId("skip-withdrawn");
      const invalidEmail = customerId("skip-invalid-email");
      const deleted = customerId("skip-deleted");
      profiles = [
        profile(reachable),
        profile(withdrawn),
        profile(invalidEmail, { email: "not-an-email" }),
        profile(deleted, { deleted: true }),
      ];
      await grantConsent([reachable, invalidEmail, deleted]);
      await grantConsent([withdrawn], true);
      const { sendId } = await seedSend({
        purpose: "marketing",
        recipients: [reachable, withdrawn, invalidEmail, deleted].map(
          (dotyposCustomerId) => ({ dotyposCustomerId })
        ),
      });

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      expect(batchSend.mock.calls).toHaveLength(1);
      expect(batchSend.mock.calls[0]![0].map(({ to }) => to)).toEqual([
        [testEmailAddress(reachable)],
      ]);
      const { recipients, campaign } = await stored(sendId);
      expect(
        Object.fromEntries(
          recipients.map((row) => [
            row.dotypos_customer_id,
            [row.status, row.skip_reason],
          ])
        )
      ).toEqual({
        [reachable]: ["sent", null],
        [withdrawn]: ["skipped", "consent-withdrawn"],
        [invalidEmail]: ["skipped", "invalid-email"],
        [deleted]: ["skipped", "deleted-customer"],
      });
      expect(campaign.status).toBe("sent");
    });

    test("mails operational recipients without consent or unsubscribe headers", async () => {
      const id = customerId("operational");
      profiles = [profile(id)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [{ dotyposCustomerId: id }],
      });

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      const [message] = batchSend.mock.calls[0]![0];
      expect(message!.headers).toBeUndefined();
    });

    test("fails the campaign when the provider rejects a batch", async () => {
      batchSend = mock(async () => ({
        data: null,
        error: { message: "Invalid batch", statusCode: 422 },
      }));
      const id = customerId("rejected");
      profiles = [profile(id)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [{ dotyposCustomerId: id }],
      });

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("failed");

      const { recipients, campaign, batches } = await stored(sendId);
      expect(recipients.map((row) => row.status)).toEqual(["failed"]);
      expect(batches.map((batch) => batch.status)).toEqual(["rejected"]);
      expect(campaign.status).toBe("failed");
    });

    test("delivers only the current attempt's recipients", async () => {
      const delivered = customerId("retry-delivered");
      const retried = customerId("retry-failed");
      profiles = [profile(delivered), profile(retried)];
      const { sendId } = await seedSend({
        purpose: "operational",
        deliveryAttempt: 2,
        recipients: [
          { dotyposCustomerId: delivered, status: "delivered" },
          { dotyposCustomerId: retried, deliveryAttempt: 2 },
        ],
      });

      expect(await consume({ sendId, deliveryAttempt: 2 })).toBe("sent");

      expect(batchSend.mock.calls).toHaveLength(1);
      const [payload, options] = batchSend.mock.calls[0]!;
      expect(payload.map(({ to }) => to)).toEqual([
        [testEmailAddress(retried)],
      ]);
      expect(options.idempotencyKey).toBe(
        `email-campaign:${sendId}:attempt-2:batch-0`
      );
    });

    test("ignores a message for an earlier attempt or a settled campaign", async () => {
      const id = customerId("stale");
      profiles = [profile(id)];
      const { sendId } = await seedSend({
        purpose: "operational",
        deliveryAttempt: 2,
        recipients: [{ dotyposCustomerId: id, deliveryAttempt: 2 }],
      });

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("stale");
      expect(await consume({ sendId, deliveryAttempt: 2 })).toBe("sent");
      expect(await consume({ sendId, deliveryAttempt: 2 })).toBe("stale");
      expect(batchSend.mock.calls).toHaveLength(1);
    });

    test("skips a recipient outside the test domain before any provider request outside production", async () => {
      const inside = customerId("guard-inside");
      const outside = customerId("guard-outside");
      profiles = [
        profile(inside),
        profile(outside, { email: resendSimulatorAddress("delivered") }),
      ];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [inside, outside].map((dotyposCustomerId) => ({
          dotyposCustomerId,
        })),
      });

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      expect(mailed).toEqual([testEmailAddress(inside)]);
      const { recipients } = await stored(sendId);
      expect(
        Object.fromEntries(
          recipients.map((row) => [
            row.dotypos_customer_id,
            [row.status, row.skip_reason],
          ])
        )
      ).toEqual({
        [inside]: ["sent", null],
        [outside]: ["skipped", "outside-test-domain"],
      });
    });

    test("mails a recipient outside the test domain in production", async () => {
      const outside = customerId("guard-production");
      profiles = [
        profile(outside, { email: resendSimulatorAddress("delivered") }),
      ];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [{ dotyposCustomerId: outside }],
      });

      expect(
        await consume(
          { sendId, deliveryAttempt: 1 },
          consumerLayerFor("production")
        )
      ).toBe("sent");

      expect(mailed).toEqual([resendSimulatorAddress("delivered")]);
    });

    test("replays an accepted batch under its key when recording it failed", async () => {
      const ids = [customerId("db-fail-a"), customerId("db-fail-b")];
      profiles = ids.map((id) => profile(id));
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: ids.map((dotyposCustomerId) => ({ dotyposCustomerId })),
      });
      const trigger = `fail_batch_accept_${run}`;
      await testDatabase.pool.query(
        `create function ${trigger}() returns trigger language plpgsql as $$ begin raise exception 'simulated write failure'; end $$`
      );
      await testDatabase.pool.query(
        `create trigger ${trigger} before update on email_campaign_delivery_batches for each row when (new.status = 'accepted' and new.send_id = '${sendId}') execute function ${trigger}()`
      );
      try {
        await consumeFails({ sendId, deliveryAttempt: 1 });
      } finally {
        await testDatabase.pool.query(
          `drop trigger ${trigger} on email_campaign_delivery_batches`
        );
        await testDatabase.pool.query(`drop function ${trigger}()`);
      }
      const interrupted = await stored(sendId);
      expect(interrupted.batches.map((batch) => batch.status)).toEqual([
        "requested",
      ]);
      expect(Object.values(statusesOf(interrupted.recipients))).toEqual([
        "pending",
        "pending",
      ]);

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      expect(requestKeys()).toEqual([
        `email-campaign:${sendId}:attempt-1:batch-0`,
        `email-campaign:${sendId}:attempt-1:batch-0`,
      ]);
      expect(new Set(requestPayloads()).size).toBe(1);
      expect(mailed.sort()).toEqual(ids.map((id) => testEmailAddress(id)));
      const { recipients, campaign } = await stored(sendId);
      expect(Object.values(statusesOf(recipients))).toEqual(["sent", "sent"]);
      expect(campaign.status).toBe("sent");
    });

    test("replays the persisted batch unchanged after a webhook moved a recipient first", async () => {
      const early = customerId("early-webhook-a");
      const later = customerId("early-webhook-b");
      profiles = [profile(early), profile(later)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [early, later].map((dotyposCustomerId) => ({
          dotyposCustomerId,
        })),
      });
      // The provider accepts, its webhook lands, then the consumer is cut
      // off before it records the answer.
      batchSend = mock(async (payload, options) => {
        const response = await acceptBatch(payload, options);
        if (response.data) {
          await recordWebhook({
            type: "email.delivered",
            providerMessageId: response.data.data[0]!.id,
            sendId,
            dotyposCustomerId: early,
          });
        }
        return hang();
      });

      expect(await consumeCutOff({ sendId, deliveryAttempt: 1 })).toBe(false);
      expect(statusesOf((await stored(sendId)).recipients)).toEqual({
        [early]: "delivered",
        [later]: "pending",
      });

      batchSend.mockImplementation(acceptBatch);
      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      expect(requestKeys()).toEqual([
        `email-campaign:${sendId}:attempt-1:batch-0`,
        `email-campaign:${sendId}:attempt-1:batch-0`,
      ]);
      expect(new Set(requestPayloads()).size).toBe(1);
      expect(mailed.sort()).toEqual(
        [early, later].map((id) => testEmailAddress(id))
      );
      const { recipients, campaign } = await stored(sendId);
      expect(statusesOf(recipients)).toEqual({
        [early]: "delivered",
        [later]: "sent",
      });
      expect(
        new Set(recipients.map((row) => row.provider_message_id)).size
      ).toBe(2);
      expect(campaign.status).toBe("sent");
    });

    test("resumes a run cut off mid-request with the same batch and key", async () => {
      const ids = Array.from({ length: 101 }, (_, index) =>
        customerId(`cut-off-${String(index).padStart(3, "0")}`)
      );
      profiles = ids.map((id) => profile(id));
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: ids.map((dotyposCustomerId) => ({ dotyposCustomerId })),
      });
      batchSend = mock(hang);

      expect(await consumeCutOff({ sendId, deliveryAttempt: 1 })).toBe(false);
      expect(mailed).toEqual([]);

      batchSend.mockImplementation(acceptBatch);
      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      expect(requestKeys()).toEqual([
        `email-campaign:${sendId}:attempt-1:batch-0`,
        `email-campaign:${sendId}:attempt-1:batch-0`,
        `email-campaign:${sendId}:attempt-1:batch-1`,
      ]);
      expect(requestPayloads()[0]).toBe(requestPayloads()[1]!);
      expect(mailed).toHaveLength(101);
      expect(new Set(mailed).size).toBe(101);
      const { batches, campaign } = await stored(sendId);
      expect(
        batches.map((batch) => [
          batch.dotypos_customer_ids.length,
          batch.status,
        ])
      ).toEqual([
        [100, "accepted"],
        [1, "accepted"],
      ]);
      expect(campaign.status).toBe("sent");
    });

    test("never resends a batch whose payload changed; its recipients become unconfirmed", async () => {
      const changed = customerId("changed-email");
      const unchanged = customerId("unchanged-email");
      profiles = [profile(changed), profile(unchanged)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [changed, unchanged].map((dotyposCustomerId) => ({
          dotyposCustomerId,
        })),
      });
      batchSend = mock(hang);
      expect(await consumeCutOff({ sendId, deliveryAttempt: 1 })).toBe(false);

      profiles = [
        profile(changed, { email: testEmailAddress(`${changed}-new`) }),
        profile(unchanged),
      ];
      batchSend.mockImplementation(acceptBatch);
      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("failed");

      expect(batchSend.mock.calls).toHaveLength(1);
      const { recipients, batches, campaign } = await stored(sendId);
      expect(statusesOf(recipients)).toEqual({
        [changed]: "unconfirmed",
        [unchanged]: "unconfirmed",
      });
      expect(batches.map((batch) => batch.status)).toEqual(["unconfirmed"]);
      expect(campaign.status).toBe("failed");
    });

    test("gives up on a batch with an unknown outcome once its key's replay window passed", async () => {
      const id = customerId("expired-key");
      profiles = [profile(id)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [{ dotyposCustomerId: id }],
      });
      batchSend = mock(hang);
      expect(await consumeCutOff({ sendId, deliveryAttempt: 1 })).toBe(false);
      await testDatabase.pool.query(
        "update email_campaign_delivery_batches set requested_at = now() - interval '23 hours 1 minute' where send_id = $1",
        [sendId]
      );

      batchSend.mockImplementation(acceptBatch);
      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("failed");

      expect(batchSend.mock.calls).toHaveLength(1);
      const { recipients, batches } = await stored(sendId);
      expect(statusesOf(recipients)).toEqual({ [id]: "unconfirmed" });
      expect(batches.map((batch) => batch.status)).toEqual(["unconfirmed"]);
    });

    test("treats a refused replay as unconfirmed, since the first request may have been delivered", async () => {
      const id = customerId("refused-replay");
      profiles = [profile(id)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [{ dotyposCustomerId: id }],
      });
      batchSend = mock(hang);
      expect(await consumeCutOff({ sendId, deliveryAttempt: 1 })).toBe(false);

      batchSend.mockImplementation(async () => ({
        data: null,
        error: { message: "Invalid batch", statusCode: 422 },
      }));
      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("failed");

      const { recipients, batches } = await stored(sendId);
      expect(statusesOf(recipients)).toEqual({ [id]: "unconfirmed" });
      expect(batches.map((batch) => batch.status)).toEqual(["unconfirmed"]);
    });

    test("ignores a malformed message", async () => {
      expect(await consume({ sendId: "", deliveryAttempt: 0 })).toBe("ignored");
      expect(batchSend.mock.calls).toHaveLength(0);
    });
  }
);
