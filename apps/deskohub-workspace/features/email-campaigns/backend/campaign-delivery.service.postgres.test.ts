import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
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

let providerIds = 0;
const acceptBatch = async (payload: readonly BatchEmail[]) => ({
  data: {
    data: payload.map(() => ({ id: `resend-${++providerIds}` })),
  },
});
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

    const consumerLayer = CampaignDeliveryService.Default.pipe(
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
            deploymentEnvironment: "development",
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

    const consume = (message: unknown) =>
      Effect.runPromise(
        processCampaignSendMessage(message).pipe(Effect.provide(consumerLayer))
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
        "select dotypos_customer_id, status, provider_message_id from email_campaign_recipients where send_id = $1 order by dotypos_customer_id",
        [sendId]
      );
      const {
        rows: [campaign],
      } = await testDatabase.pool.query(
        "select c.status, s.completed_at from email_campaign_sends s join email_campaigns c on c.id = s.campaign_id where s.id = $1",
        [sendId]
      );
      return { recipients, campaign };
    };

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
          recipients.map((row) => [row.dotypos_customer_id, row.status])
        )
      ).toEqual({
        [reachable]: "sent",
        [withdrawn]: "skipped",
        [invalidEmail]: "skipped",
        [deleted]: "skipped",
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

      const { recipients, campaign } = await stored(sendId);
      expect(recipients.map((row) => row.status)).toEqual(["failed"]);
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

    test("ignores a malformed message", async () => {
      expect(await consume({ sendId: "", deliveryAttempt: 0 })).toBe("ignored");
      expect(batchSend.mock.calls).toHaveLength(0);
    });
  }
);
