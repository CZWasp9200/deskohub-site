import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { administrationCalendarDate } from "./calendar-date";
import {
  AdministrationDotyposCustomerId,
  CliBearerAuthentication,
  CliInputInvalid,
  CliMutationRejected,
  CliResourceNotFound,
  CliServiceUnavailable,
} from "./workspace-admin-api";

const strictParseOptions = {
  parseOptions: { errors: "all", onExcessProperty: "error" },
} as const;

export const AdministrationCampaignId = Schema.NonEmptyString.pipe(
  Schema.brand("CampaignId")
).annotate({
  identifier: "CampaignId",
  description: "Database-generated identifier of one email campaign.",
});
export type AdministrationCampaignId = typeof AdministrationCampaignId.Type;

export const AdministrationCampaignAudienceId = Schema.NonEmptyString.pipe(
  Schema.brand("CampaignAudienceId")
).annotate({
  identifier: "CampaignAudienceId",
  description: "Database-generated identifier of one saved campaign audience.",
});
export type AdministrationCampaignAudienceId =
  typeof AdministrationCampaignAudienceId.Type;

export const AdministrationCampaignSendId = Schema.NonEmptyString.pipe(
  Schema.brand("CampaignSendId")
).annotate({
  identifier: "CampaignSendId",
  description:
    "Database-generated identifier of the send that froze a campaign's recipients.",
});
export type AdministrationCampaignSendId =
  typeof AdministrationCampaignSendId.Type;

export const AdministrationCampaignLocale = Schema.Literals(["cs-CZ", "en-US"]);
export type AdministrationCampaignLocale =
  typeof AdministrationCampaignLocale.Type;

export const AdministrationCampaignPurpose = Schema.Literals([
  "marketing",
  "operational",
]);
export type AdministrationCampaignPurpose =
  typeof AdministrationCampaignPurpose.Type;

export const AdministrationCampaignTemplateKey = Schema.Literals(["workspace"]);
export type AdministrationCampaignTemplateKey =
  typeof AdministrationCampaignTemplateKey.Type;

export const AdministrationCampaignStatus = Schema.Literals([
  "draft",
  "sending",
  "sent",
  "failed",
]);
export type AdministrationCampaignStatus =
  typeof AdministrationCampaignStatus.Type;

export const AdministrationCampaignRecipientStatus = Schema.Literals([
  "pending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "skipped",
]);
export type AdministrationCampaignRecipientStatus =
  typeof AdministrationCampaignRecipientStatus.Type;

const AdministrationCampaignTitle = Schema.Trim.check(Schema.isNonEmpty());

const audienceReservationCondition = Schema.TaggedStruct("Reservation", {
  presence: Schema.Literals(["has", "hasNot"]),
  dateBasis: Schema.Literals(["visit", "booking"]),
  from: Schema.optionalKey(administrationCalendarDate),
  to: Schema.optionalKey(administrationCalendarDate),
  status: Schema.optionalKey(
    Schema.Literals(["in_progress", "complete", "cancelled", "needs_refund"])
  ),
});

const audienceLocaleCondition = Schema.TaggedStruct("Locale", {
  locales: Schema.NonEmptyArray(AdministrationCampaignLocale),
});

const audienceAccountCondition = Schema.TaggedStruct("Account", {
  hasAccount: Schema.Boolean,
});

const audienceDotyposTagCondition = Schema.TaggedStruct("DotyposTag", {
  tag: Schema.NonEmptyString,
});

const audienceDiscountGroupCondition = Schema.TaggedStruct("DiscountGroup", {
  discountGroupId: Schema.NonEmptyString,
});

type AdministrationAudienceFilterGroup = {
  readonly _tag: "Group";
  readonly operator: "and" | "or";
  readonly filters: readonly AdministrationAudienceFilter[];
};

export type AdministrationAudienceFilter =
  | typeof audienceReservationCondition.Type
  | typeof audienceLocaleCondition.Type
  | typeof audienceAccountCondition.Type
  | typeof audienceDotyposTagCondition.Type
  | typeof audienceDiscountGroupCondition.Type
  | AdministrationAudienceFilterGroup;

const audienceFilterGroup = Schema.TaggedStruct("Group", {
  operator: Schema.Literals(["and", "or"]),
  filters: Schema.Array(
    Schema.suspend(
      (): Schema.Codec<AdministrationAudienceFilter> =>
        AdministrationAudienceFilter
    )
  ),
});

/**
 * The audience filter tree: nested AND/OR groups of reservation, locale,
 * account, Dotypos tag, and discount-group conditions. The server validates
 * it again with the domain schema it mirrors.
 */
export const AdministrationAudienceFilter: Schema.Codec<AdministrationAudienceFilter> =
  Schema.Union([
    audienceReservationCondition,
    audienceLocaleCondition,
    audienceAccountCondition,
    audienceDotyposTagCondition,
    audienceDiscountGroupCondition,
    audienceFilterGroup,
  ]).annotate({
    identifier: "AdministrationAudienceFilter",
    ...strictParseOptions,
  });

export const AdministrationCampaignAudience = Schema.Struct({
  id: AdministrationCampaignAudienceId,
  title: Schema.String,
  filter: AdministrationAudienceFilter,
  archivedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type AdministrationCampaignAudience =
  typeof AdministrationCampaignAudience.Type;

export const AdministrationCampaignAudienceInput = Schema.Struct({
  title: AdministrationCampaignTitle,
  filter: AdministrationAudienceFilter,
}).annotate(strictParseOptions);
export type AdministrationCampaignAudienceInput =
  typeof AdministrationCampaignAudienceInput.Type;

export const AdministrationCampaignAudienceUpdate = Schema.Struct({
  title: Schema.optionalKey(AdministrationCampaignTitle),
  filter: Schema.optionalKey(AdministrationAudienceFilter),
}).annotate(strictParseOptions);
export type AdministrationCampaignAudienceUpdate =
  typeof AdministrationCampaignAudienceUpdate.Type;

export const AdministrationCampaignTemplate = Schema.Struct({
  key: AdministrationCampaignTemplateKey,
  name: Schema.String,
  description: Schema.String,
});
export type AdministrationCampaignTemplate =
  typeof AdministrationCampaignTemplate.Type;

const AdministrationCampaignOperationalReason = Schema.Trim.check(
  Schema.isNonEmpty()
);

/**
 * One locale's texts. The body is Markdown; a line
 * `[[button: Label](https://example.com)]` makes a button. The server parses
 * and validates it, and exports stored bodies back to Markdown.
 */
export const AdministrationCampaignLocaleContent = Schema.Struct({
  subject: Schema.String,
  preheader: Schema.String,
  bodyMarkdown: Schema.String,
  /** Replaces an operational campaign's footer reason line. */
  operationalReason: Schema.optionalKey(
    AdministrationCampaignOperationalReason
  ),
}).annotate(strictParseOptions);
export type AdministrationCampaignLocaleContent =
  typeof AdministrationCampaignLocaleContent.Type;

/** Per-locale campaign texts; a locale without content is absent. */
export const AdministrationCampaignContent = Schema.Record(
  AdministrationCampaignLocale,
  Schema.optionalKey(AdministrationCampaignLocaleContent)
);
export type AdministrationCampaignContent =
  typeof AdministrationCampaignContent.Type;

export const AdministrationCampaignSummary = Schema.Struct({
  id: AdministrationCampaignId,
  title: Schema.String,
  purpose: AdministrationCampaignPurpose,
  templateKey: AdministrationCampaignTemplateKey,
  status: AdministrationCampaignStatus,
  audienceId: Schema.NullOr(AdministrationCampaignAudienceId),
  locales: Schema.Array(AdministrationCampaignLocale),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type AdministrationCampaignSummary =
  typeof AdministrationCampaignSummary.Type;

export const AdministrationCampaignDetail = Schema.Struct({
  ...AdministrationCampaignSummary.fields,
  content: AdministrationCampaignContent,
});
export type AdministrationCampaignDetail =
  typeof AdministrationCampaignDetail.Type;

export const AdministrationCampaignCreateInput = Schema.Struct({
  title: AdministrationCampaignTitle,
  purpose: AdministrationCampaignPurpose,
  templateKey: AdministrationCampaignTemplateKey,
  audienceId: Schema.NullOr(AdministrationCampaignAudienceId),
  content: AdministrationCampaignContent,
}).annotate(strictParseOptions);
export type AdministrationCampaignCreateInput =
  typeof AdministrationCampaignCreateInput.Type;

/**
 * Changes to one locale's texts. Omitted fields keep their value; a null
 * `operationalReason` restores the default reason line. A locale the
 * campaign has no content for yet needs a subject and a body.
 */
export const AdministrationCampaignLocaleContentChange = Schema.Struct({
  subject: Schema.optionalKey(Schema.String),
  preheader: Schema.optionalKey(Schema.String),
  bodyMarkdown: Schema.optionalKey(Schema.String),
  operationalReason: Schema.optionalKey(
    Schema.NullOr(AdministrationCampaignOperationalReason)
  ),
}).annotate(strictParseOptions);
export type AdministrationCampaignLocaleContentChange =
  typeof AdministrationCampaignLocaleContentChange.Type;

/**
 * A draft edit. Omitted fields keep their value. In `content`, a locale
 * mapped to null loses its content; omitted locales are unchanged.
 */
export const AdministrationCampaignUpdateInput = Schema.Struct({
  title: Schema.optionalKey(AdministrationCampaignTitle),
  purpose: Schema.optionalKey(AdministrationCampaignPurpose),
  templateKey: Schema.optionalKey(AdministrationCampaignTemplateKey),
  audienceId: Schema.optionalKey(
    Schema.NullOr(AdministrationCampaignAudienceId)
  ),
  content: Schema.optionalKey(
    Schema.Record(
      AdministrationCampaignLocale,
      Schema.optionalKey(
        Schema.NullOr(AdministrationCampaignLocaleContentChange)
      )
    )
  ),
}).annotate(strictParseOptions);
export type AdministrationCampaignUpdateInput =
  typeof AdministrationCampaignUpdateInput.Type;

/** Renders either unsaved texts or a saved campaign's locale in a template. */
export const AdministrationCampaignTemplatePreviewInput = Schema.Union([
  Schema.TaggedStruct("Content", {
    purpose: AdministrationCampaignPurpose,
    locale: AdministrationCampaignLocale,
    content: AdministrationCampaignLocaleContent,
  }).annotate(strictParseOptions),
  Schema.TaggedStruct("Campaign", {
    campaignId: AdministrationCampaignId,
    locale: AdministrationCampaignLocale,
  }).annotate(strictParseOptions),
]);
export type AdministrationCampaignTemplatePreviewInput =
  typeof AdministrationCampaignTemplatePreviewInput.Type;

export const AdministrationCampaignEmailPreview = Schema.Struct({
  subject: Schema.String,
  html: Schema.String,
  text: Schema.String,
});
export type AdministrationCampaignEmailPreview =
  typeof AdministrationCampaignEmailPreview.Type;

export const AdministrationCampaignRecipientExclusionReason = Schema.Literals([
  "missing-from-dotypos",
  "deleted-customer",
  "missing-email",
  "invalid-email",
]);
export type AdministrationCampaignRecipientExclusionReason =
  typeof AdministrationCampaignRecipientExclusionReason.Type;

/** Who the campaign's audience reaches now, and who it can't. */
export const AdministrationCampaignRecipientPreview = Schema.Struct({
  recipients: Schema.Array(
    Schema.Struct({
      customerId: AdministrationDotyposCustomerId,
      locale: AdministrationCampaignLocale,
      email: Schema.String,
    })
  ),
  exclusions: Schema.Array(
    Schema.Struct({
      customerId: AdministrationDotyposCustomerId,
      reason: AdministrationCampaignRecipientExclusionReason,
    })
  ),
  /** Customers sharing one email; only `recipientCustomerId` is mailed. */
  duplicates: Schema.Array(
    Schema.Struct({
      email: Schema.String,
      recipientCustomerId: AdministrationDotyposCustomerId,
      duplicateCustomerIds: Schema.Array(AdministrationDotyposCustomerId),
    })
  ),
});
export type AdministrationCampaignRecipientPreview =
  typeof AdministrationCampaignRecipientPreview.Type;

/** Extra test recipients; the admin inbox is always included. */
export const AdministrationCampaignTestSendInput = Schema.Struct({
  recipients: Schema.Array(Schema.Trim.check(Schema.isNonEmpty())),
}).annotate(strictParseOptions);
export type AdministrationCampaignTestSendInput =
  typeof AdministrationCampaignTestSendInput.Type;

export const AdministrationCampaignTestSendResult = Schema.Struct({
  /** The admin inbox first, then the extra recipients. */
  recipients: Schema.Array(Schema.String),
  /** Every recipient got one `[TEST]` email per locale. */
  locales: Schema.Array(AdministrationCampaignLocale),
  /** When the confirmation code in these emails expires. */
  codeExpiresAt: Schema.String,
});
export type AdministrationCampaignTestSendResult =
  typeof AdministrationCampaignTestSendResult.Type;

/** The code from the latest test email confirms the real send. */
export const AdministrationCampaignSendInput = Schema.Struct({
  confirmationCode: Schema.Trim.check(Schema.isNonEmpty()),
}).annotate(strictParseOptions);
export type AdministrationCampaignSendInput =
  typeof AdministrationCampaignSendInput.Type;

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const AdministrationCampaignSendResult = Schema.Struct({
  sendId: AdministrationCampaignSendId,
  recipientCount: count,
});
export type AdministrationCampaignSendResult =
  typeof AdministrationCampaignSendResult.Type;

export const AdministrationCampaignRetryResult = Schema.Struct({
  sendId: AdministrationCampaignSendId,
  retriedCount: count,
});
export type AdministrationCampaignRetryResult =
  typeof AdministrationCampaignRetryResult.Type;

export const AdministrationCampaignSendStatus = Schema.Struct({
  sendId: AdministrationCampaignSendId,
  createdAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
  audienceId: Schema.NullOr(AdministrationCampaignAudienceId),
  /** The filter snapshot the recipients were resolved with. */
  audienceFilter: AdministrationAudienceFilter,
  counts: Schema.Record(AdministrationCampaignRecipientStatus, count),
  recipients: Schema.Array(
    Schema.Struct({
      customerId: AdministrationDotyposCustomerId,
      locale: AdministrationCampaignLocale,
      status: AdministrationCampaignRecipientStatus,
      statusUpdatedAt: Schema.String,
    })
  ),
});
export type AdministrationCampaignSendStatus =
  typeof AdministrationCampaignSendStatus.Type;

/** `send` is null until the campaign is sent. */
export const AdministrationCampaignSendStatusResult = Schema.Struct({
  send: Schema.NullOr(AdministrationCampaignSendStatus),
});
export type AdministrationCampaignSendStatusResult =
  typeof AdministrationCampaignSendStatusResult.Type;

const campaignParams = { campaignId: AdministrationCampaignId };
const audienceParams = { audienceId: AdministrationCampaignAudienceId };

export const AdminCliCampaignsApi = HttpApiGroup.make("campaigns")
  .add(
    HttpApiEndpoint.get("listCampaignAudiences", "/campaign-audiences", {
      success: Schema.Array(AdministrationCampaignAudience),
      error: CliServiceUnavailable.schema,
    })
  )
  .add(
    HttpApiEndpoint.get(
      "getCampaignAudience",
      "/campaign-audiences/:audienceId",
      {
        params: audienceParams,
        success: AdministrationCampaignAudience,
        error: [CliResourceNotFound.schema, CliServiceUnavailable.schema],
      }
    )
  )
  .add(
    HttpApiEndpoint.post("createCampaignAudience", "/campaign-audiences", {
      payload: AdministrationCampaignAudienceInput,
      success: AdministrationCampaignAudience,
      error: [CliInputInvalid.schema, CliServiceUnavailable.schema],
    })
  )
  .add(
    HttpApiEndpoint.patch(
      "updateCampaignAudience",
      "/campaign-audiences/:audienceId",
      {
        params: audienceParams,
        payload: AdministrationCampaignAudienceUpdate,
        success: AdministrationCampaignAudience,
        error: [
          CliInputInvalid.schema,
          CliResourceNotFound.schema,
          CliServiceUnavailable.schema,
        ],
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "archiveCampaignAudience",
      "/campaign-audiences/:audienceId/archive",
      {
        params: audienceParams,
        success: AdministrationCampaignAudience,
        error: [CliResourceNotFound.schema, CliServiceUnavailable.schema],
      }
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteCampaignAudience",
      "/campaign-audiences/:audienceId",
      {
        params: audienceParams,
        success: Schema.Struct({ id: AdministrationCampaignAudienceId }),
        error: [
          CliMutationRejected.schema,
          CliResourceNotFound.schema,
          CliServiceUnavailable.schema,
        ],
      }
    )
  )
  .add(
    HttpApiEndpoint.get("listCampaignTemplates", "/campaign-templates", {
      success: Schema.Array(AdministrationCampaignTemplate),
    })
  )
  .add(
    HttpApiEndpoint.post(
      "previewCampaignTemplate",
      "/campaign-templates/:templateKey/preview",
      {
        params: { templateKey: AdministrationCampaignTemplateKey },
        payload: AdministrationCampaignTemplatePreviewInput,
        success: AdministrationCampaignEmailPreview,
        error: [
          CliInputInvalid.schema,
          CliResourceNotFound.schema,
          CliServiceUnavailable.schema,
        ],
      }
    )
  )
  .add(
    HttpApiEndpoint.get("listCampaigns", "/campaigns", {
      success: Schema.Array(AdministrationCampaignSummary),
      error: CliServiceUnavailable.schema,
    })
  )
  .add(
    HttpApiEndpoint.get("getCampaign", "/campaigns/:campaignId", {
      params: campaignParams,
      success: AdministrationCampaignDetail,
      error: [CliResourceNotFound.schema, CliServiceUnavailable.schema],
    })
  )
  .add(
    HttpApiEndpoint.post("createCampaign", "/campaigns", {
      payload: AdministrationCampaignCreateInput,
      success: AdministrationCampaignDetail,
      error: [
        CliInputInvalid.schema,
        CliMutationRejected.schema,
        CliResourceNotFound.schema,
        CliServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.patch("updateCampaign", "/campaigns/:campaignId", {
      params: campaignParams,
      payload: AdministrationCampaignUpdateInput,
      success: AdministrationCampaignDetail,
      error: [
        CliInputInvalid.schema,
        CliMutationRejected.schema,
        CliResourceNotFound.schema,
        CliServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.post(
      "duplicateCampaign",
      "/campaigns/:campaignId/duplicate",
      {
        params: campaignParams,
        success: AdministrationCampaignDetail,
        error: [CliResourceNotFound.schema, CliServiceUnavailable.schema],
      }
    )
  )
  .add(
    HttpApiEndpoint.delete("deleteCampaign", "/campaigns/:campaignId", {
      params: campaignParams,
      success: Schema.Struct({ id: AdministrationCampaignId }),
      error: [
        CliMutationRejected.schema,
        CliResourceNotFound.schema,
        CliServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get(
      "previewCampaignRecipients",
      "/campaigns/:campaignId/recipients",
      {
        params: campaignParams,
        success: AdministrationCampaignRecipientPreview,
        error: [
          CliMutationRejected.schema,
          CliResourceNotFound.schema,
          CliServiceUnavailable.schema,
        ],
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "testSendCampaign",
      "/campaigns/:campaignId/test-send",
      {
        params: campaignParams,
        payload: AdministrationCampaignTestSendInput,
        success: AdministrationCampaignTestSendResult,
        error: [
          CliInputInvalid.schema,
          CliMutationRejected.schema,
          CliResourceNotFound.schema,
          CliServiceUnavailable.schema,
        ],
      }
    )
  )
  .add(
    HttpApiEndpoint.post("sendCampaign", "/campaigns/:campaignId/send", {
      params: campaignParams,
      payload: AdministrationCampaignSendInput,
      success: AdministrationCampaignSendResult,
      error: [
        CliMutationRejected.schema,
        CliResourceNotFound.schema,
        CliServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.post("retryCampaign", "/campaigns/:campaignId/retry", {
      params: campaignParams,
      success: AdministrationCampaignRetryResult,
      error: [
        CliMutationRejected.schema,
        CliResourceNotFound.schema,
        CliServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get(
      "getCampaignSendStatus",
      "/campaigns/:campaignId/status",
      {
        params: campaignParams,
        success: AdministrationCampaignSendStatusResult,
        error: [CliResourceNotFound.schema, CliServiceUnavailable.schema],
      }
    )
  )
  .middleware(CliBearerAuthentication)
  .prefix("/api/v1/cli");
