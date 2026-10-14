import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import {
  AdministrationCampaignAudienceCreateRequest,
  AdministrationCampaignAudienceInput,
  AdministrationCampaignAudienceUpdate,
  AdministrationCampaignCreateInput,
  AdministrationCampaignCreateRequest,
  AdministrationCampaignDuplicateRequest,
  AdministrationCampaignRetryInput,
  AdministrationCampaignSendInput,
  AdministrationCampaignSendStatusResult,
  AdministrationCampaignTemplatePreviewInput,
  AdministrationCampaignUpdateInput,
  AudienceFilter,
} from "./email-campaigns";

const decodes = <A, I>(schema: Schema.Codec<A, I>, input: unknown) =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(input));

/**
 * A filter as Workspace stored it and dhw sent it before the domain and the
 * contract shared one schema, encoded byte for byte by the old domain schema.
 */
const storedFilterJson =
  '{"_tag":"Group","operator":"or","filters":[{"_tag":"Reservation","presence":"hasNot","dateBasis":"booking","from":"2026-01-01","to":"2026-06-30","status":"complete"},{"_tag":"Reservation","presence":"has","dateBasis":"visit"},{"_tag":"Group","operator":"and","filters":[{"_tag":"Locale","locales":["cs-CZ","en-US"]},{"_tag":"Account","hasAccount":false},{"_tag":"DotyposTag","tag":"vip"},{"_tag":"DiscountGroup","discountGroupId":"42"}]},{"_tag":"Group","operator":"and","filters":[]}]}';

/** The same kind of filter in the key order Postgres `jsonb` returns. */
const jsonbFilterJson =
  '{"_tag":"Group","filters":[{"to":"2026-06-30","_tag":"Reservation","from":"2026-01-01","status":"complete","presence":"hasNot","dateBasis":"booking"},{"_tag":"Locale","locales":["en-US"]}],"operator":"and"}';

const reencode = (json: string) =>
  JSON.stringify(
    Schema.encodeSync(AudienceFilter)(
      Schema.decodeUnknownSync(AudienceFilter)(JSON.parse(json))
    )
  );

describe("campaign admin API contract", () => {
  test("keeps the stored audience filter wire format byte for byte", () => {
    expect(reencode(storedFilterJson)).toBe(storedFilterJson);
  });

  test("decodes an audience filter in jsonb key order", () => {
    expect(reencode(jsonbFilterJson)).toBe(
      '{"_tag":"Group","operator":"and","filters":[{"_tag":"Reservation","presence":"hasNot","dateBasis":"booking","from":"2026-01-01","to":"2026-06-30","status":"complete"},{"_tag":"Locale","locales":["en-US"]}]}'
    );
  });

  test("accepts a stored audience filter in every API input that embeds it", () => {
    const filter = JSON.parse(storedFilterJson);

    expect(
      decodes(AdministrationCampaignAudienceInput, {
        title: "Audience",
        filter,
      })
    ).toBe(true);
    expect(decodes(AdministrationCampaignAudienceUpdate, { filter })).toBe(
      true
    );
  });

  test.each([
    ["an unknown condition", { _tag: "Spend", minimum: 100 }],
    [
      "an invalid calendar date",
      {
        _tag: "Reservation",
        presence: "has",
        dateBasis: "visit",
        from: "2026-02-30",
      },
    ],
    ["an empty locale list", { _tag: "Locale", locales: [] }],
    ["an unsupported locale", { _tag: "Locale", locales: ["de-DE"] }],
    [
      "an unknown property in a nested condition",
      {
        _tag: "Group",
        operator: "and",
        filters: [{ _tag: "Account", hasAccount: true, extra: 1 }],
      },
    ],
  ])("rejects an audience filter with %s", (_, filter) => {
    expect(
      decodes(AdministrationCampaignAudienceInput, {
        title: "Audience",
        filter,
      })
    ).toBe(false);
    expect(decodes(AdministrationCampaignAudienceUpdate, { filter })).toBe(
      false
    );
  });

  test("trims titles and rejects blank ones", () => {
    const input = {
      purpose: "marketing",
      templateKey: "workspace",
      audienceId: null,
      content: {
        "cs-CZ": {
          subject: "Novinky",
          preheader: "",
          bodyMarkdown: "Ahoj",
        },
      },
    };

    expect(
      Schema.decodeUnknownSync(AdministrationCampaignCreateInput)({
        ...input,
        title: "  News  ",
      }).title
    ).toBe("News");
    expect(
      decodes(AdministrationCampaignCreateInput, { ...input, title: "   " })
    ).toBe(false);
  });

  test("accepts only known locales and fields in campaign content", () => {
    const content = { subject: "News", preheader: "", bodyMarkdown: "Hi" };
    const create = (overrides: object) => ({
      title: "News",
      purpose: "operational",
      templateKey: "workspace",
      audienceId: null,
      content: { "en-US": content },
      ...overrides,
    });

    expect(decodes(AdministrationCampaignCreateInput, create({}))).toBe(true);
    expect(
      decodes(
        AdministrationCampaignCreateInput,
        create({ content: { "de-DE": content } })
      )
    ).toBe(false);
    expect(
      decodes(
        AdministrationCampaignCreateInput,
        create({ content: { "en-US": { ...content, body: {} } } })
      )
    ).toBe(false);
    expect(
      decodes(AdministrationCampaignCreateInput, create({ status: "sent" }))
    ).toBe(false);
  });

  test("expresses removals in a campaign update", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationCampaignUpdateInput)({
        audienceId: null,
        content: {
          "cs-CZ": { subject: "Novinky", operationalReason: null },
          "en-US": null,
        },
      })
    ).toEqual({
      audienceId: null,
      content: {
        "cs-CZ": { subject: "Novinky", operationalReason: null },
        "en-US": null,
      },
    });
    expect(decodes(AdministrationCampaignUpdateInput, {})).toBe(true);
  });

  test("requires a confirmation code for the real send", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationCampaignSendInput)({
        confirmationCode: " ABC123 ",
      })
    ).toEqual({ confirmationCode: "ABC123" });
    expect(decodes(AdministrationCampaignSendInput, {})).toBe(false);
    expect(
      decodes(AdministrationCampaignSendInput, { confirmationCode: "  " })
    ).toBe(false);
  });

  test("previews either unsaved content or a saved campaign", () => {
    expect(
      decodes(AdministrationCampaignTemplatePreviewInput, {
        _tag: "Content",
        purpose: "marketing",
        locale: "cs-CZ",
        content: { subject: "Novinky", preheader: "", bodyMarkdown: "Ahoj" },
      })
    ).toBe(true);
    expect(
      decodes(AdministrationCampaignTemplatePreviewInput, {
        _tag: "Campaign",
        campaignId: "01990000-0000-7000-8000-000000000001",
        locale: "en-US",
      })
    ).toBe(true);
    expect(
      decodes(AdministrationCampaignTemplatePreviewInput, {
        _tag: "Campaign",
        locale: "en-US",
      })
    ).toBe(false);
  });

  test("reports an unsent campaign's status as no send", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationCampaignSendStatusResult)({
        send: null,
      })
    ).toEqual({ send: null });
  });

  const localeFilter = { _tag: "Locale", locales: ["cs-CZ"] };

  test("reports unconfirmed recipients and why a recipient was skipped", () => {
    const recipient = {
      customerId: "101",
      locale: "cs-CZ",
      statusUpdatedAt: "2026-10-14T10:00:00Z",
    };
    const status = (
      recipients: ReadonlyArray<Record<string, unknown>>
    ): unknown => ({
      send: {
        sendId: "send-1",
        createdAt: "2026-10-14T10:00:00Z",
        completedAt: null,
        audienceId: null,
        audienceFilter: localeFilter,
        counts: {
          pending: 0,
          sent: 0,
          delivered: 0,
          bounced: 0,
          complained: 0,
          failed: 0,
          unconfirmed: 1,
          skipped: 1,
        },
        recipients,
      },
    });

    expect(
      decodes(
        AdministrationCampaignSendStatusResult,
        status([
          { ...recipient, status: "unconfirmed", skipReason: null },
          {
            ...recipient,
            status: "skipped",
            skipReason: "outside-test-domain",
          },
        ])
      )
    ).toBe(true);
    expect(
      decodes(
        AdministrationCampaignSendStatusResult,
        status([{ ...recipient, status: "skipped", skipReason: "bored" }])
      )
    ).toBe(false);
  });

  test("states whether a retry includes unconfirmed recipients", () => {
    expect(
      decodes(AdministrationCampaignRetryInput, { includeUnconfirmed: true })
    ).toBe(true);
    expect(decodes(AdministrationCampaignRetryInput, {})).toBe(false);
    expect(
      decodes(AdministrationCampaignRetryInput, {
        includeUnconfirmed: false,
        includeSkipped: true,
      })
    ).toBe(false);
  });

  test("carries a request ID on every creation", () => {
    const requestId = "01990000-0000-7000-8000-000000000010";
    const campaign = {
      title: "News",
      purpose: "marketing",
      templateKey: "workspace",
      audienceId: null,
      content: {},
    };
    const audience = { title: "Everyone", filter: localeFilter };

    expect(
      decodes(AdministrationCampaignCreateRequest, { requestId, campaign })
    ).toBe(true);
    expect(decodes(AdministrationCampaignCreateRequest, { campaign })).toBe(
      false
    );
    expect(
      decodes(AdministrationCampaignCreateRequest, {
        requestId: "not-a-uuid",
        campaign,
      })
    ).toBe(false);
    expect(
      decodes(AdministrationCampaignAudienceCreateRequest, {
        requestId,
        audience,
      })
    ).toBe(true);
    expect(
      decodes(AdministrationCampaignAudienceCreateRequest, {
        requestId,
        ...audience,
      })
    ).toBe(false);
    expect(decodes(AdministrationCampaignDuplicateRequest, { requestId })).toBe(
      true
    );
    expect(decodes(AdministrationCampaignDuplicateRequest, {})).toBe(false);
  });
});
