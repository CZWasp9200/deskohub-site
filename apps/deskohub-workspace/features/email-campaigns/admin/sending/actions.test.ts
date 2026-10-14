import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql";
import type { ICampaignService } from "../../backend/campaign.service";
import { campaignIdSchema } from "../../campaign-identifiers";
import {
  CampaignConfirmationRejected,
  CampaignNotFound,
  CampaignReadOnly,
  CampaignRecipientsOutsideTestDomain,
} from "../../errors";
import type { ICampaignSendPipeline } from "../campaign-send-pipeline";

const revalidatePath = mock((_path: string) => undefined);

mock.module("next/cache", () => ({ revalidatePath }));
mock.module("next/server", () => ({
  after: () => undefined,
  connection: async () => undefined,
}));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () => new Headers({ referer: "https://deskohub.test/en-US" }),
}));

const pipelineModule = await import("../campaign-send-pipeline");
const campaignServiceModule = await import("../../backend/campaign.service");
const realAuthorizationModule = await import(
  "@/shared/administrator/administrator-authorization.server"
);
const realUnauthorizedError = await Effect.runPromise(
  Effect.flip(realAuthorizationModule.requireAdministratorAuthorization)
);

let authorizationCalls = 0;
let authorizationResult: Effect.Effect<unknown, unknown> =
  Effect.succeed("Fixture Operator");
const authorization = Effect.suspend(() => {
  authorizationCalls += 1;
  return authorizationResult;
});

mock.module(
  "@/shared/administrator/administrator-authorization.server",
  () => ({ requireAdministratorAuthorization: authorization })
);

const campaignId = campaignIdSchema.make("synthetic-campaign");
const duplicateCampaignId = campaignIdSchema.make("synthetic-copy");
const sendReceipt = { sendId: "synthetic-send", recipientCount: 2 };

let testSendResult: Effect.Effect<unknown, unknown> = Effect.succeed({});
let sendResult: Effect.Effect<unknown, unknown> = Effect.succeed(sendReceipt);
let retryResult: Effect.Effect<unknown, unknown> = Effect.succeed({});
let duplicateResult: Effect.Effect<unknown, unknown> = Effect.succeed({
  id: duplicateCampaignId,
});

const testSendCalls: Parameters<ICampaignSendPipeline["testSend"]>[0][] = [];
const sendCalls: Parameters<ICampaignSendPipeline["send"]>[0][] = [];
const retryCalls: Parameters<ICampaignSendPipeline["retryUndelivered"]>[0][] =
  [];
const duplicateCalls: Parameters<ICampaignService["duplicate"]>[0][] = [];

const testSend = mock(
  (input: Parameters<ICampaignSendPipeline["testSend"]>[0]) => {
    testSendCalls.push(input);
    return testSendResult;
  }
);
const send = mock((input: Parameters<ICampaignSendPipeline["send"]>[0]) => {
  sendCalls.push(input);
  return sendResult;
});
const retryUndelivered = mock(
  (input: Parameters<ICampaignSendPipeline["retryUndelivered"]>[0]) => {
    retryCalls.push(input);
    return retryResult;
  }
);
const duplicate = mock(
  (input: Parameters<ICampaignService["duplicate"]>[0]) => {
    duplicateCalls.push(input);
    return duplicateResult;
  }
);

const pipelineLive = Layer.succeed(
  pipelineModule.CampaignSendPipeline,
  pipelineModule.CampaignSendPipeline.of({
    adminInbox: "synthetic-inbox",
    testSend,
    send,
    retryUndelivered,
    getSendStatus: () => Effect.succeed(undefined),
  } as never)
);

class StubCampaignSendPipeline extends pipelineModule.CampaignSendPipeline {
  static override Live = pipelineLive;
}

mock.module("../campaign-send-pipeline", () => ({
  ...pipelineModule,
  CampaignSendPipeline: StubCampaignSendPipeline,
}));

const campaignServiceLive = Layer.succeed(
  campaignServiceModule.CampaignService,
  campaignServiceModule.CampaignService.of({ duplicate } as never)
);

class StubCampaignService extends campaignServiceModule.CampaignService {
  static override Live = campaignServiceLive;
}

mock.module("../../backend/campaign.service", () => ({
  ...campaignServiceModule,
  CampaignService: StubCampaignService,
}));

const sendFailureCases = [
  {
    name: "unknown confirmation code",
    error: new CampaignConfirmationRejected({
      campaignId,
      reason: "unknown-code",
    }),
    serverError:
      "That code doesn't match the latest test email. Check it for typos and try again.",
  },
  {
    name: "superseded confirmation code",
    error: new CampaignConfirmationRejected({
      campaignId,
      reason: "superseded",
    }),
    serverError:
      "A newer test email replaced that code. Use the code from the latest test email.",
  },
  {
    name: "expired confirmation code",
    error: new CampaignConfirmationRejected({
      campaignId,
      reason: "expired",
    }),
    serverError:
      "That code expired. Send a new test email to get a fresh code.",
  },
  {
    name: "changed campaign content",
    error: new CampaignConfirmationRejected({
      campaignId,
      reason: "content-changed",
    }),
    serverError:
      "The campaign changed after that test email. Send a new test email and use its code.",
  },
  {
    name: "confirmation attempts exceeded",
    error: new CampaignConfirmationRejected({
      campaignId,
      reason: "too-many-attempts",
    }),
    serverError:
      "Too many wrong codes, so that code no longer works. Send a new test email to get a fresh code.",
  },
  {
    name: "campaign not found",
    error: new CampaignNotFound({ campaignId }),
    serverError: "This campaign no longer exists.",
  },
  {
    name: "campaign is read only",
    error: new CampaignReadOnly({ campaignId, status: "sent" }),
    serverError:
      "This campaign already left Draft. Duplicate it to send a new copy.",
  },
  {
    name: "invalid test recipient",
    error: new pipelineModule.CampaignTestRecipientInvalid({
      email: "invalid-synthetic-address",
    }),
    serverError: "invalid-synthetic-address isn't a valid email address.",
  },
  {
    name: "one recipient outside the test domain",
    error: new CampaignRecipientsOutsideTestDomain({ recipientCount: 1 }),
    serverError:
      "Outside production, campaign email can only go to @deskohub.test addresses, and 1 address is outside it. Nothing was sent.",
  },
  {
    name: "multiple recipients outside the test domain",
    error: new CampaignRecipientsOutsideTestDomain({ recipientCount: 3 }),
    serverError:
      "Outside production, campaign email can only go to @deskohub.test addresses, and 3 addresses are outside it. Nothing was sent.",
  },
  {
    name: "no reachable recipients",
    error: new pipelineModule.CampaignNoRecipients({ campaignId }),
    serverError:
      "The audience has no reachable recipients right now, so nothing was sent.",
  },
  {
    name: "send unavailable",
    error: new pipelineModule.CampaignSendUnavailable({ campaignId }),
    serverError:
      "Sending isn't available in this build yet. Nothing was sent and the code still works.",
  },
  {
    name: "SQL failure",
    error: new SqlError.SqlError({
      reason: new SqlError.UnknownError({
        cause: new Error("synthetic database failure"),
        message: "synthetic database failure",
        operation: "send",
      }),
    }),
    serverError: "Something went wrong. Try again in a moment.",
  },
] as const;

beforeEach(() => {
  authorizationCalls = 0;
  authorizationResult = Effect.succeed("Fixture Operator");
  testSendResult = Effect.succeed({});
  sendResult = Effect.succeed(sendReceipt);
  retryResult = Effect.succeed({});
  duplicateResult = Effect.succeed({ id: duplicateCampaignId });
  testSendCalls.length = 0;
  sendCalls.length = 0;
  retryCalls.length = 0;
  duplicateCalls.length = 0;
  revalidatePath.mockClear();
});

describe("email campaign sending actions", () => {
  test("maps the real administrator authorization error and skips the pipeline", async () => {
    authorizationResult = Effect.fail(realUnauthorizedError);

    const { sendCampaign } = await import("./actions");
    const result = await sendCampaign({
      campaignId,
      confirmationCode: "synthetic-code",
    });

    expect(result?.serverError).toBe(
      "Your admin sign-in is no longer valid. Reload the page and sign in again."
    );
    expect(authorizationCalls).toBe(1);
    expect(testSendCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
    expect(retryCalls).toHaveLength(0);
  });

  test("validates input before authorization or pipeline calls", async () => {
    const { sendCampaign } = await import("./actions");

    const malformedCampaign = await sendCampaign({
      campaignId: "",
      confirmationCode: "synthetic-code",
    } as never);
    const missingConfirmationCode = await sendCampaign({
      campaignId,
    } as never);

    expect(malformedCampaign).toMatchObject({
      validationErrors: {
        fieldErrors: { campaignId: expect.any(Array) },
      },
    });
    expect(missingConfirmationCode).toMatchObject({
      validationErrors: {
        fieldErrors: { confirmationCode: expect.any(Array) },
      },
    });
    expect(authorizationCalls).toBe(0);
    expect(sendCalls).toHaveLength(0);
  });

  test.each(sendFailureCases)(
    "maps $name to the public send error",
    async ({ error, serverError }) => {
      sendResult = Effect.fail(error);

      const { sendCampaign } = await import("./actions");
      const result = await sendCampaign({
        campaignId,
        confirmationCode: "synthetic-code",
      });

      expect(result?.serverError).toBe(serverError);
      expect(sendCalls).toHaveLength(1);
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );

  test("revalidates the campaign list and sent campaign after a successful send", async () => {
    const { sendCampaign } = await import("./actions");

    const result = await sendCampaign({
      campaignId,
      confirmationCode: "synthetic-code",
    });

    expect(result?.data).toEqual(sendReceipt);
    expect(revalidatePath.mock.calls).toEqual([
      ["/admin/email-campaigns"],
      [`/admin/email-campaigns/${campaignId}`],
    ]);
  });

  test("returns the duplicate campaign ID and revalidates the campaign list", async () => {
    const { duplicateCampaign: duplicateCampaignAction } = await import(
      "./actions"
    );

    const result = await duplicateCampaignAction({ campaignId });

    expect(result?.data).toEqual({ campaignId: duplicateCampaignId });
    expect(duplicateCalls).toEqual([campaignId]);
    expect(revalidatePath.mock.calls).toEqual([["/admin/email-campaigns"]]);
  });
});
