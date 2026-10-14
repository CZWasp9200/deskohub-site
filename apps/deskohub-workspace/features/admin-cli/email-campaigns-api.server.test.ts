import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationCampaignAudienceId,
  AdministrationCampaignId,
  AdministrationCampaignSendId,
  AdministrationDotyposCustomerId,
  CliBearerAuthentication,
  CliInputInvalid,
  CliMutationRejected,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliSessionUnauthorized,
  CurrentCliSession,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import { HttpApiTest } from "effect/unstable/httpapi";
import type { CampaignAudienceRow, CampaignRow } from "@/db/schema";
import { CampaignService } from "@/features/email-campaigns/backend/campaign.service";
import { CampaignAudienceService } from "@/features/email-campaigns/backend/campaign-audience.service";
import { CampaignRecipientService } from "@/features/email-campaigns/backend/campaign-recipient.service";
import { CampaignSendService } from "@/features/email-campaigns/backend/campaign-send.service";
import { parseCampaignBodyMarkdown } from "@/features/email-campaigns/body/campaign-body-markdown";
import type { CampaignLocalizedContent } from "@/features/email-campaigns/body/campaign-content";
import {
  CampaignAudienceInUse,
  CampaignConfirmationRejected,
  CampaignNotFound,
  CampaignRecipientResolutionError,
  CampaignTestRecipientInvalid,
} from "@/features/email-campaigns/errors";
import { AdminCliCampaignsApiHandlers } from "./email-campaigns-api.server";

const campaignId = AdministrationCampaignId.make(
  "01990000-0000-7000-8000-000000000001"
);
const audienceId = AdministrationCampaignAudienceId.make(
  "01990000-0000-7000-8000-000000000002"
);
const customerId = AdministrationDotyposCustomerId.make("1001");
const otherCustomerId = AdministrationDotyposCustomerId.make("1002");
const createdAt = Temporal.Instant.from("2026-10-14T08:00:00Z");

const parseBody = (markdown: string) =>
  Effect.runPromise(parseCampaignBodyMarkdown(markdown));

const campaignRow = (overrides: Partial<CampaignRow> = {}): CampaignRow => ({
  id: campaignId,
  title: "October news",
  purpose: "operational",
  templateKey: "workspace",
  content: {},
  audienceId,
  status: "draft",
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

const audienceRow = (
  overrides: Partial<CampaignAudienceRow> = {}
): CampaignAudienceRow => ({
  id: audienceId,
  title: "Czech customers",
  filter: { _tag: "Locale", locales: ["cs-CZ"] },
  archivedAt: null,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

type CampaignServiceOverrides = {
  readonly audiences?: Partial<CampaignAudienceService["Service"]>;
  readonly campaigns?: Partial<CampaignService["Service"]>;
  readonly recipients?: Partial<CampaignRecipientService["Service"]>;
  readonly sending?: Partial<CampaignSendService["Service"]>;
};

const campaignServices = (overrides: CampaignServiceOverrides) =>
  Layer.mergeAll(
    Layer.succeed(CampaignAudienceService, {
      ...({} as CampaignAudienceService["Service"]),
      ...overrides.audiences,
    }),
    Layer.succeed(CampaignService, {
      ...({} as CampaignService["Service"]),
      ...overrides.campaigns,
    }),
    Layer.succeed(CampaignRecipientService, {
      ...({} as CampaignRecipientService["Service"]),
      ...overrides.recipients,
    }),
    Layer.succeed(CampaignSendService, {
      ...({} as CampaignSendService["Service"]),
      ...overrides.sending,
    })
  );

const AuthorizedCliRequest = Layer.succeed(CliBearerAuthentication, {
  bearer: (httpEffect) =>
    Effect.provideService(httpEffect, CurrentCliSession, {
      id: "01980000-0000-7000-8000-000000000000",
      approvedBy: null,
      clientName: "test client",
      cliVersion: "1.0.0",
      buildTarget: "development",
      createdAt: "2026-10-14T08:00:00.000Z",
      lastUsedAt: "2026-10-14T08:00:00.000Z",
      expiresAt: null,
    }),
});

const UnauthorizedCliRequest = Layer.succeed(CliBearerAuthentication, {
  bearer: () =>
    Effect.fail(
      new CliSessionUnauthorized({ message: "The CLI session is not valid." })
    ),
});

const campaignsClient = HttpApiTest.groups(WorkspaceAdminApi, [
  "campaigns",
]).pipe(Effect.map((client) => client.campaigns));
type CampaignsClient = Effect.Success<typeof campaignsClient>;

const callCampaignsApi = <A, E>(
  call: (client: CampaignsClient) => Effect.Effect<A, E>,
  overrides: CampaignServiceOverrides = {},
  bearer = AuthorizedCliRequest
) =>
  campaignsClient.pipe(
    Effect.flatMap(call),
    Effect.provide(AdminCliCampaignsApiHandlers),
    Effect.provide(bearer),
    Effect.provide(campaignServices(overrides)),
    Effect.provide(NodeHttpServer.layerHttpServices),
    Effect.scoped,
    Effect.runPromise
  );

describe("campaign admin API", () => {
  test("rejects a request without a valid CLI session before any service runs", async () => {
    const calls: string[] = [];
    const error = await callCampaignsApi(
      (client) =>
        client
          .sendCampaign({
            params: { campaignId },
            payload: { confirmationCode: "ABC123" },
          })
          .pipe(Effect.flip),
      {
        sending: {
          send: () => {
            calls.push("send");
            return Effect.die("not expected");
          },
        },
      },
      UnauthorizedCliRequest
    );

    expect(error).toBeInstanceOf(CliSessionUnauthorized);
    expect(calls).toEqual([]);
  });

  test("creates a campaign from per-locale Markdown and exports it back", async () => {
    const created: CampaignLocalizedContent[] = [];
    const detail = await callCampaignsApi(
      (client) =>
        client.createCampaign({
          payload: {
            title: "October news",
            purpose: "operational",
            templateKey: "workspace",
            audienceId,
            content: {
              "cs-CZ": {
                subject: "Novinky",
                preheader: "Co je nového",
                bodyMarkdown:
                  "# Novinky\n\nOtevíráme **novou** zasedačku.\n\n[[button: Rezervovat](https://workspace.deskohub.cz/cs-CZ/meeting-room)]",
                operationalReason: "Máte u nás rezervaci.",
              },
            },
          },
        }),
      {
        campaigns: {
          create: (input) => {
            created.push(input.content);
            return Effect.succeed(
              campaignRow({
                title: input.title,
                audienceId: input.audienceId,
                content: input.content,
              })
            );
          },
        },
      }
    );

    expect(created).toHaveLength(1);
    expect(created[0]?.["cs-CZ"]?.body.formatVersion).toBe(1);
    expect(created[0]?.["en-US"]).toBeUndefined();
    expect(detail.title).toBe("October news");
    expect(detail.locales).toEqual(["cs-CZ"]);
    expect(detail.content["cs-CZ"]).toMatchObject({
      subject: "Novinky",
      preheader: "Co je nového",
      operationalReason: "Máte u nás rezervaci.",
    });
    expect(detail.content["cs-CZ"]?.bodyMarkdown).toContain("# Novinky");
    expect(detail.content["cs-CZ"]?.bodyMarkdown).toContain("**novou**");
    expect(detail.content["cs-CZ"]?.bodyMarkdown).toContain(
      "[[button: Rezervovat](https://workspace.deskohub.cz/cs-CZ/meeting-room)]"
    );
  });

  test("reports invalid Markdown with its locale and saves nothing", async () => {
    const calls: string[] = [];
    const error = await callCampaignsApi(
      (client) =>
        client
          .createCampaign({
            payload: {
              title: "October news",
              purpose: "marketing",
              templateKey: "workspace",
              audienceId: null,
              content: {
                "en-US": {
                  subject: "News",
                  preheader: "",
                  bodyMarkdown: "[[button: Go](http://deskohub.cz)]",
                },
              },
            },
          })
          .pipe(Effect.flip),
      {
        campaigns: {
          create: () => {
            calls.push("create");
            return Effect.die("not expected");
          },
        },
      }
    );

    expect(error).toBeInstanceOf(CliInputInvalid);
    expect(error.message).toStartWith(
      "The en-US body isn't valid campaign Markdown:"
    );
    expect(calls).toEqual([]);
  });

  test("applies per-locale changes on top of the stored content", async () => {
    const czechBody = await parseBody("Původní text");
    const englishBody = await parseBody("Original text");
    const updates: unknown[] = [];
    await callCampaignsApi(
      (client) =>
        client.updateCampaign({
          params: { campaignId },
          payload: {
            title: "Renamed",
            content: {
              "cs-CZ": { subject: "Nový předmět", operationalReason: null },
              "en-US": null,
            },
          },
        }),
      {
        campaigns: {
          get: () =>
            Effect.succeed(
              campaignRow({
                content: {
                  "cs-CZ": {
                    subject: "Předmět",
                    preheader: "Úvod",
                    body: czechBody,
                    operationalReason: "Máte u nás rezervaci.",
                  },
                  "en-US": {
                    subject: "Subject",
                    preheader: "Intro",
                    body: englishBody,
                  },
                },
              })
            ),
          update: (input) => {
            updates.push(input);
            return Effect.succeed(campaignRow({ content: input.content }));
          },
        },
      }
    );

    expect(updates).toEqual([
      {
        campaignId,
        title: "Renamed",
        content: {
          "cs-CZ": {
            subject: "Nový předmět",
            preheader: "Úvod",
            body: czechBody,
          },
        },
      },
    ]);
  });

  test("requires a subject and a body for a locale the campaign lacks", async () => {
    const error = await callCampaignsApi(
      (client) =>
        client
          .updateCampaign({
            params: { campaignId },
            payload: { content: { "en-US": { subject: "Subject" } } },
          })
          .pipe(Effect.flip),
      {
        campaigns: {
          get: () => Effect.succeed(campaignRow()),
          update: () => Effect.die("not expected"),
        },
      }
    );

    expect(error).toBeInstanceOf(CliInputInvalid);
    expect(error.message).toBe(
      "The campaign has no en-US content yet, so it needs a subject and a body."
    );
  });

  test("passes the confirmation code to the send and explains a rejected code", async () => {
    const sends: unknown[] = [];
    const sendWith = (reason: CampaignConfirmationRejected["reason"] | null) =>
      callCampaignsApi(
        (client) =>
          client
            .sendCampaign({
              params: { campaignId },
              payload: { confirmationCode: "ABC123" },
            })
            .pipe(Effect.result),
        {
          sending: {
            send: (input) => {
              sends.push(input);
              return reason === null
                ? Effect.succeed({
                    sendId: AdministrationCampaignSendId.make("send-1"),
                    recipientCount: 3,
                  })
                : Effect.fail(
                    new CampaignConfirmationRejected({ campaignId, reason })
                  );
            },
          },
        }
      );

    const sent = await sendWith(null);
    const expired = await sendWith("expired");

    expect(sends).toEqual([
      { campaignId, confirmationCode: "ABC123" },
      { campaignId, confirmationCode: "ABC123" },
    ]);
    expect(sent).toMatchObject({
      _tag: "Success",
      success: { sendId: "send-1", recipientCount: 3 },
    });
    expect(expired).toMatchObject({ _tag: "Failure" });
    const failure = expired._tag === "Failure" ? expired.failure : null;
    expect(failure).toBeInstanceOf(CliMutationRejected);
    expect(failure?.message).toBe(
      "The confirmation code expired. Run a new test send."
    );
  });

  test("previews the recipients of the campaign's audience", async () => {
    const resolutions: unknown[] = [];
    const preview = await callCampaignsApi(
      (client) => client.previewCampaignRecipients({ params: { campaignId } }),
      {
        campaigns: {
          get: () => Effect.succeed(campaignRow({ purpose: "marketing" })),
        },
        audiences: { get: () => Effect.succeed(audienceRow()) },
        recipients: {
          resolve: (input) => {
            resolutions.push(input);
            return Effect.succeed({
              recipients: [
                {
                  dotyposCustomerId: customerId,
                  locale: "cs-CZ",
                  email: testEmailAddress("campaign-recipient"),
                },
              ],
              exclusions: [
                { dotyposCustomerId: otherCustomerId, reason: "missing-email" },
              ],
              duplicates: [],
            });
          },
        },
      }
    );

    expect(resolutions).toEqual([
      { purpose: "marketing", filter: audienceRow().filter },
    ]);
    expect(preview).toEqual({
      recipients: [
        {
          customerId,
          locale: "cs-CZ",
          email: testEmailAddress("campaign-recipient"),
        },
      ],
      exclusions: [{ customerId: otherCustomerId, reason: "missing-email" }],
      duplicates: [],
    });
  });

  test("refuses a recipient preview without an audience and retries a failed resolution", async () => {
    const withoutAudience = await callCampaignsApi(
      (client) =>
        client
          .previewCampaignRecipients({ params: { campaignId } })
          .pipe(Effect.flip),
      {
        campaigns: {
          get: () => Effect.succeed(campaignRow({ audienceId: null })),
        },
      }
    );
    const unavailable = await callCampaignsApi(
      (client) =>
        client
          .previewCampaignRecipients({ params: { campaignId } })
          .pipe(Effect.flip),
      {
        campaigns: { get: () => Effect.succeed(campaignRow()) },
        audiences: { get: () => Effect.succeed(audienceRow()) },
        recipients: {
          resolve: () =>
            Effect.fail(
              CampaignRecipientResolutionError.dotypos(new Error("timeout"))
            ),
        },
      }
    );

    expect(withoutAudience).toBeInstanceOf(CliMutationRejected);
    expect(unavailable).toBeInstanceOf(CliServiceUnavailable);
    expect(unavailable.message).toContain("Dotypos API");
  });

  test("test-sends to extra recipients and rejects an invalid address", async () => {
    const testSends: unknown[] = [];
    const extraRecipient = testEmailAddress("campaign-test");
    const result = await callCampaignsApi(
      (client) =>
        client.testSendCampaign({
          params: { campaignId },
          payload: { recipients: [extraRecipient] },
        }),
      {
        sending: {
          testSend: (input) => {
            testSends.push(input);
            return Effect.succeed({
              recipients: [testEmailAddress("admin-inbox"), extraRecipient],
              locales: ["cs-CZ"],
              codeExpiresAt: Temporal.Instant.from("2026-10-15T08:00:00Z"),
            });
          },
        },
      }
    );
    const invalid = await callCampaignsApi(
      (client) =>
        client
          .testSendCampaign({
            params: { campaignId },
            payload: { recipients: ["not-an-address"] },
          })
          .pipe(Effect.flip),
      {
        sending: {
          testSend: () =>
            Effect.fail(
              new CampaignTestRecipientInvalid({ email: "not-an-address" })
            ),
        },
      }
    );

    expect(testSends).toEqual([
      { campaignId, extraRecipients: [extraRecipient] },
    ]);
    expect(result).toEqual({
      recipients: [testEmailAddress("admin-inbox"), extraRecipient],
      locales: ["cs-CZ"],
      codeExpiresAt: "2026-10-15T08:00:00Z",
    });
    expect(invalid).toBeInstanceOf(CliInputInvalid);
  });

  test("reports the send status, or none before the send", async () => {
    const notSent = await callCampaignsApi(
      (client) => client.getCampaignSendStatus({ params: { campaignId } }),
      { sending: { getSendStatus: () => Effect.succeed(Option.none()) } }
    );
    const sent = await callCampaignsApi(
      (client) => client.getCampaignSendStatus({ params: { campaignId } }),
      {
        sending: {
          getSendStatus: () =>
            Effect.succeed(
              Option.some({
                sendId: AdministrationCampaignSendId.make("send-1"),
                createdAt,
                completedAt: null,
                audienceId,
                audienceFilter: audienceRow().filter,
                counts: {
                  pending: 0,
                  sent: 0,
                  delivered: 1,
                  bounced: 0,
                  complained: 0,
                  failed: 0,
                  skipped: 0,
                },
                recipients: [
                  {
                    dotyposCustomerId: customerId,
                    locale: "cs-CZ",
                    status: "delivered",
                    statusUpdatedAt: createdAt,
                  },
                ],
              })
            ),
        },
      }
    );

    expect(notSent).toEqual({ send: null });
    expect(sent.send).toMatchObject({
      sendId: "send-1",
      createdAt: "2026-10-14T08:00:00Z",
      completedAt: null,
      counts: { delivered: 1 },
      recipients: [
        {
          customerId,
          locale: "cs-CZ",
          status: "delivered",
          statusUpdatedAt: "2026-10-14T08:00:00Z",
        },
      ],
    });
  });

  test("keeps an audience that drafts use and names those drafts", async () => {
    const error = await callCampaignsApi(
      (client) =>
        client
          .deleteCampaignAudience({ params: { audienceId } })
          .pipe(Effect.flip),
      {
        audiences: {
          delete: () =>
            Effect.fail(
              new CampaignAudienceInUse({
                audienceId,
                draftCampaignIds: [campaignId],
              })
            ),
        },
      }
    );

    expect(error).toBeInstanceOf(CliMutationRejected);
    expect(error.message).toContain(campaignId);
  });

  test("validates an audience filter with the domain schema before saving it", async () => {
    const created: unknown[] = [];
    const filter = {
      _tag: "Group",
      operator: "and",
      filters: [
        {
          _tag: "Reservation",
          presence: "has",
          dateBasis: "visit",
          from: "2026-01-01",
        },
        { _tag: "Account", hasAccount: true },
      ],
    } as const;
    const audience = await callCampaignsApi(
      (client) =>
        client.createCampaignAudience({
          payload: { title: "Members", filter },
        }),
      {
        audiences: {
          create: (input) => {
            created.push(input);
            return Effect.succeed(audienceRow(input));
          },
        },
      }
    );

    expect(created).toEqual([{ title: "Members", filter }]);
    expect(audience).toMatchObject({
      id: audienceId,
      title: "Members",
      filter,
      archivedAt: null,
      createdAt: "2026-10-14T08:00:00Z",
    });
  });

  test("renders a template preview from Markdown or from a saved campaign", async () => {
    const czechBody = await parseBody("Text kampaně");
    const preview = await callCampaignsApi((client) =>
      client.previewCampaignTemplate({
        params: { templateKey: "workspace" },
        payload: {
          _tag: "Content",
          purpose: "operational",
          locale: "en-US",
          content: {
            subject: "Preview subject",
            preheader: "",
            bodyMarkdown: "Hello **there**",
            operationalReason: "You booked a desk with us.",
          },
        },
      })
    );
    const missingLocale = await callCampaignsApi(
      (client) =>
        client
          .previewCampaignTemplate({
            params: { templateKey: "workspace" },
            payload: { _tag: "Campaign", campaignId, locale: "en-US" },
          })
          .pipe(Effect.flip),
      {
        campaigns: {
          get: () =>
            Effect.succeed(
              campaignRow({
                content: {
                  "cs-CZ": {
                    subject: "Předmět",
                    preheader: "",
                    body: czechBody,
                  },
                },
              })
            ),
        },
      }
    );
    const missingCampaign = await callCampaignsApi(
      (client) =>
        client
          .previewCampaignTemplate({
            params: { templateKey: "workspace" },
            payload: { _tag: "Campaign", campaignId, locale: "cs-CZ" },
          })
          .pipe(Effect.flip),
      {
        campaigns: {
          get: () => Effect.fail(new CampaignNotFound({ campaignId })),
        },
      }
    );

    expect(preview.subject).toBe("Preview subject");
    expect(preview.html).toContain("<strong>there</strong>");
    expect(preview.html).toContain("You booked a desk with us.");
    expect(preview.text).toContain("Hello");
    expect(missingLocale).toBeInstanceOf(CliInputInvalid);
    expect(missingCampaign).toBeInstanceOf(CliResourceNotFound);
  });
});
