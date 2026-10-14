import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { ICampaignService } from "../../backend/campaign.service";
import { campaignContentFixture } from "../../backend/email-campaigns.test-utils";
import { campaignIdSchema } from "../../campaign-identifiers";
import {
  CampaignAudienceArchived,
  CampaignAudienceNotFound,
  CampaignContentInvalid,
  CampaignNotFound,
  CampaignReadOnly,
} from "../../errors";

const revalidatePath = mock((_path: string) => undefined);

mock.module("next/cache", () => ({ revalidatePath }));
mock.module("next/server", () => ({
  after: () => undefined,
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

const campaignServiceModule = await import("../../backend/campaign.service");
const campaignId = campaignIdSchema.make("synthetic-campaign");
const validInput = {
  title: "Synthetic campaign",
  purpose: "marketing",
  templateKey: "workspace",
  audienceId: null,
  content: campaignContentFixture(),
};
let createResult: Effect.Effect<unknown, unknown> = Effect.succeed({
  id: campaignId,
});
let updateResult: Effect.Effect<unknown, unknown> = Effect.succeed({
  id: campaignId,
});
const createCalls: Parameters<ICampaignService["create"]>[0][] = [];
const updateCalls: Parameters<ICampaignService["update"]>[0][] = [];

const create = mock((input: Parameters<ICampaignService["create"]>[0]) => {
  createCalls.push(input);
  return createResult;
});
const update = mock((input: Parameters<ICampaignService["update"]>[0]) => {
  updateCalls.push(input);
  return updateResult;
});

const campaignServiceLive = Layer.succeed(
  campaignServiceModule.CampaignService,
  campaignServiceModule.CampaignService.of({
    create,
    update,
  } as never)
);

class StubCampaignService extends campaignServiceModule.CampaignService {
  static override Live = campaignServiceLive;
}

mock.module("../../backend/campaign.service", () => ({
  ...campaignServiceModule,
  CampaignService: StubCampaignService,
}));

const saveErrorCases = [
  {
    name: "invalid content",
    operation: "create",
    error: new CampaignContentInvalid({
      cause: new Error("synthetic schema failure") as never,
    }),
    serverError: "The content has problems. Fix the listed issues, then save.",
  },
  {
    name: "archived audience",
    operation: "create",
    error: new CampaignAudienceArchived({
      audienceId: campaignId as never,
    }),
    serverError: "The selected audience is archived. Choose another audience.",
  },
  {
    name: "missing audience",
    operation: "create",
    error: new CampaignAudienceNotFound({
      audienceId: campaignId as never,
    }),
    serverError: "The selected audience no longer exists.",
  },
  {
    name: "read-only campaign",
    operation: "update",
    error: new CampaignReadOnly({ campaignId, status: "sent" }),
    serverError: "This campaign has left Draft and can no longer be edited.",
  },
  {
    name: "missing campaign",
    operation: "update",
    error: new CampaignNotFound({ campaignId }),
    serverError: "This campaign no longer exists.",
  },
  {
    name: "unexpected save error",
    operation: "create",
    error: new Error("synthetic campaign service failure"),
    serverError: "The campaign could not be saved. Try again.",
  },
] as const;

beforeEach(() => {
  authorizationCalls = 0;
  authorizationResult = Effect.succeed("Fixture Operator");
  createResult = Effect.succeed({ id: campaignId });
  updateResult = Effect.succeed({ id: campaignId });
  createCalls.length = 0;
  updateCalls.length = 0;
  revalidatePath.mockClear();
});

describe("email campaign composer actions", () => {
  test("does not call the campaign service when administrator authorization fails", async () => {
    authorizationResult = Effect.fail(
      new Error("synthetic authorization failure")
    );

    const { createCampaign } = await import("./actions");
    const result = await createCampaign(validInput as never);

    expect(result?.serverError).toBeDefined();
    expect(authorizationCalls).toBe(1);
    expect(createCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  test("reports an invalid draft through schema validation", async () => {
    const { createCampaign } = await import("./actions");

    const result = await createCampaign({
      ...validInput,
      title: "   ",
    } as never);

    expect(result).toMatchObject({
      validationErrors: {
        fieldErrors: { title: expect.any(Array) },
      },
    });
    expect(authorizationCalls).toBe(0);
    expect(createCalls).toHaveLength(0);
  });

  test.each(saveErrorCases)(
    "maps $name to its public save message",
    async ({ error, operation, serverError }) => {
      if (operation === "update") {
        updateResult = Effect.fail(error);
      } else {
        createResult = Effect.fail(error);
      }

      const { createCampaign, updateCampaign } = await import("./actions");
      const result =
        operation === "update"
          ? await updateCampaign({ ...validInput, campaignId } as never)
          : await createCampaign(validInput as never);

      expect(result?.serverError).toBe(serverError);
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );

  test("revalidates the campaign list and updated campaign after successful saves", async () => {
    const { createCampaign, updateCampaign } = await import("./actions");

    const created = await createCampaign(validInput as never);
    const updated = await updateCampaign({
      ...validInput,
      campaignId,
    } as never);

    expect(created?.data).toEqual({ campaignId });
    expect(updated?.data).toEqual({ campaignId });
    expect(revalidatePath.mock.calls).toEqual([
      ["/admin/email-campaigns"],
      ["/admin/email-campaigns"],
      [`/admin/email-campaigns/${campaignId}`],
    ]);
    expect(createCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);
  });
});
