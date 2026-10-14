import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import {
  AdministrationAudienceFilter,
  AdministrationCampaignAudienceInput,
  AdministrationCampaignCreateInput,
  AdministrationCampaignSendInput,
  AdministrationCampaignSendStatusResult,
  AdministrationCampaignTemplatePreviewInput,
  AdministrationCampaignUpdateInput,
} from "./email-campaigns";

const decodes = <S extends Schema.Top>(schema: S, input: unknown) =>
  Result.isSuccess(
    Schema.decodeUnknownResult(schema as Schema.Codec<unknown>)(input)
  );

const nestedFilter = {
  _tag: "Group",
  operator: "or",
  filters: [
    {
      _tag: "Reservation",
      presence: "hasNot",
      dateBasis: "booking",
      from: "2026-01-01",
      to: "2026-06-30",
      status: "complete",
    },
    {
      _tag: "Group",
      operator: "and",
      filters: [
        { _tag: "Locale", locales: ["en-US"] },
        { _tag: "Account", hasAccount: false },
        { _tag: "DotyposTag", tag: "vip" },
        { _tag: "DiscountGroup", discountGroupId: "42" },
      ],
    },
  ],
};

describe("campaign admin API contract", () => {
  test("round-trips a nested audience filter tree", () => {
    const decoded = Schema.decodeUnknownSync(AdministrationAudienceFilter)(
      nestedFilter
    );

    expect(Schema.encodeSync(AdministrationAudienceFilter)(decoded)).toEqual(
      nestedFilter
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
});
