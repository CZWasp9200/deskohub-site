import { Schema } from "effect";
import {
  defineOperations,
  mutation,
  query,
} from "./administration-operation-port";
import {
  AdministrationCampaignAudienceId,
  AdministrationCampaignId,
} from "./campaign-identifiers";
import {
  AutomationActivateInput,
  AutomationDetail,
  AutomationDryRun,
  AutomationEngineHealth,
  AutomationFlowUpdate,
  AutomationPreviewRef,
  AutomationPreviewStatus,
  AutomationRunDetail,
  AutomationRunListInput,
  AutomationRunPage,
  AutomationRunRef,
  AutomationRunStats,
  AutomationRunStatsInput,
  AutomationVersionDetail,
  AutomationVersionRef,
  AutomationVersionSummary,
  automationsMinimumDhwVersion,
  CalendarPreview,
  CalendarPreviewInput,
} from "./email-automations";
import {
  AdministrationCampaignAudience,
  AdministrationCampaignAudienceCreateRequest,
  AdministrationCampaignAudienceDeleted,
  AdministrationCampaignAudiences,
  AdministrationCampaignAudienceUpdate,
  AdministrationCampaignCreateRequest,
  AdministrationCampaignDeleted,
  AdministrationCampaignDetail,
  AdministrationCampaignDuplicateRequest,
  AdministrationCampaignEditorContent,
  AdministrationCampaignEmailPreview,
  AdministrationCampaignRecipientPreview,
  AdministrationCampaignRetryInput,
  AdministrationCampaignRetryResult,
  AdministrationCampaignSendInput,
  AdministrationCampaignSendResult,
  AdministrationCampaignSendStatusResult,
  AdministrationCampaignSettings,
  AdministrationCampaignSummaries,
  AdministrationCampaignTemplateKey,
  AdministrationCampaignTemplatePreviewInput,
  AdministrationCampaignTemplates,
  AdministrationCampaignTestSendInput,
  AdministrationCampaignTestSendResult,
  AdministrationCampaignUpdateInput,
  campaignsMinimumDhwVersion,
} from "./email-campaigns";

const strictParseOptions = {
  parseOptions: { errors: "all", onExcessProperty: "error" },
} as const;

export const CampaignRef = Schema.Struct({
  campaignId: AdministrationCampaignId,
}).annotate(strictParseOptions);
export type CampaignRef = typeof CampaignRef.Type;

export const CampaignAudienceRef = Schema.Struct({
  audienceId: AdministrationCampaignAudienceId,
}).annotate(strictParseOptions);
export type CampaignAudienceRef = typeof CampaignAudienceRef.Type;

/** An empty input; an empty struct would accept any object. */
export const NoInput = Schema.Record(Schema.String, Schema.Never);

/** A draft edit of one campaign; omitted fields keep their value. */
export const CampaignPatchInput = Schema.Struct({
  campaignId: AdministrationCampaignId,
  ...AdministrationCampaignUpdateInput.fields,
}).annotate(strictParseOptions);
export type CampaignPatchInput = typeof CampaignPatchInput.Type;

export const CampaignDuplicateInput = Schema.Struct({
  campaignId: AdministrationCampaignId,
  ...AdministrationCampaignDuplicateRequest.fields,
}).annotate(strictParseOptions);
export type CampaignDuplicateInput = typeof CampaignDuplicateInput.Type;

export const CampaignAudiencePatchInput = Schema.Struct({
  audienceId: AdministrationCampaignAudienceId,
  ...AdministrationCampaignAudienceUpdate.fields,
}).annotate(strictParseOptions);
export type CampaignAudiencePatchInput = typeof CampaignAudiencePatchInput.Type;

export const CampaignTemplatePreviewInput = Schema.Struct({
  templateKey: AdministrationCampaignTemplateKey,
  preview: AdministrationCampaignTemplatePreviewInput,
}).annotate(strictParseOptions);
export type CampaignTemplatePreviewInput =
  typeof CampaignTemplatePreviewInput.Type;

export const CampaignTestSendInput = Schema.Struct({
  campaignId: AdministrationCampaignId,
  ...AdministrationCampaignTestSendInput.fields,
}).annotate(strictParseOptions);
export type CampaignTestSendInput = typeof CampaignTestSendInput.Type;

export const CampaignSendInput = Schema.Struct({
  campaignId: AdministrationCampaignId,
  ...AdministrationCampaignSendInput.fields,
}).annotate(strictParseOptions);
export type CampaignSendInput = typeof CampaignSendInput.Type;

export const CampaignRetryInput = Schema.Struct({
  campaignId: AdministrationCampaignId,
  ...AdministrationCampaignRetryInput.fields,
}).annotate(strictParseOptions);
export type CampaignRetryInput = typeof CampaignRetryInput.Type;

/** The operations on campaigns, their audiences and templates. */
export const emailCampaignOperations = defineOperations({
  listCampaignAudiences: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: NoInput,
    output: AdministrationCampaignAudiences,
  }),
  getCampaignAudience: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignAudienceRef,
    output: AdministrationCampaignAudience,
  }),
  createCampaignAudience: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: AdministrationCampaignAudienceCreateRequest,
    output: AdministrationCampaignAudience,
    ledger: true,
  }),
  updateCampaignAudience: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignAudiencePatchInput,
    output: AdministrationCampaignAudience,
  }),
  archiveCampaignAudience: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignAudienceRef,
    output: AdministrationCampaignAudience,
  }),
  unarchiveCampaignAudience: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignAudienceRef,
    output: AdministrationCampaignAudience,
  }),
  deleteCampaignAudience: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignAudienceRef,
    output: AdministrationCampaignAudienceDeleted,
  }),
  listCampaignTemplates: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: NoInput,
    output: AdministrationCampaignTemplates,
  }),
  previewCampaignTemplate: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignTemplatePreviewInput,
    output: AdministrationCampaignEmailPreview,
  }),
  listCampaigns: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: NoInput,
    output: AdministrationCampaignSummaries,
  }),
  getCampaign: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignRef,
    output: AdministrationCampaignDetail,
  }),
  /** The campaign with lossless document bodies, as the editor holds them. */
  getCampaignEditorContent: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignRef,
    output: AdministrationCampaignEditorContent,
  }),
  createCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: AdministrationCampaignCreateRequest,
    output: AdministrationCampaignDetail,
    ledger: true,
  }),
  updateCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignPatchInput,
    output: AdministrationCampaignDetail,
  }),
  duplicateCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignDuplicateInput,
    output: AdministrationCampaignDetail,
    ledger: true,
  }),
  deleteCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignRef,
    output: AdministrationCampaignDeleted,
  }),
  previewCampaignRecipients: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignRef,
    output: AdministrationCampaignRecipientPreview,
  }),
  getCampaignSettings: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: NoInput,
    output: AdministrationCampaignSettings,
  }),
  testSendCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignTestSendInput,
    output: AdministrationCampaignTestSendResult,
  }),
  sendCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignSendInput,
    output: AdministrationCampaignSendResult,
  }),
  retryCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignRetryInput,
    output: AdministrationCampaignRetryResult,
  }),
  getCampaignSendStatus: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignRef,
    output: AdministrationCampaignSendStatusResult,
  }),
});

/** The operations on automated campaigns and their engine. */
export const emailAutomationOperations = defineOperations({
  getAutomation: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CampaignRef,
    output: AutomationDetail,
  }),
  updateAutomationFlow: mutation({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationFlowUpdate,
    output: AutomationDetail,
  }),
  /** Starts the dry run of the current draft, or returns its job. */
  dryRunAutomation: mutation({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CampaignRef,
    output: AutomationPreviewStatus,
  }),
  getAutomationDryRun: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationPreviewRef,
    output: AutomationDryRun,
  }),
  /** A retried activation returns the version the first one published. */
  activateAutomation: mutation({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationActivateInput,
    output: AutomationVersionSummary,
  }),
  pauseAutomation: mutation({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CampaignRef,
    output: AutomationDetail,
  }),
  resumeAutomation: mutation({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CampaignRef,
    output: AutomationDetail,
  }),
  archiveAutomation: mutation({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CampaignRef,
    output: AutomationDetail,
  }),
  listAutomationVersions: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CampaignRef,
    output: Schema.Array(AutomationVersionSummary),
  }),
  getAutomationVersion: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationVersionRef,
    output: AutomationVersionDetail,
  }),
  getAutomationRunStats: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationRunStatsInput,
    output: AutomationRunStats,
  }),
  listAutomationRuns: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationRunListInput,
    output: AutomationRunPage,
  }),
  getAutomationRun: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationRunRef,
    output: AutomationRunDetail,
  }),
  previewCalendarExpression: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CalendarPreviewInput,
    output: CalendarPreview,
  }),
  getAutomationEngineHealth: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: NoInput,
    output: AutomationEngineHealth,
  }),
});

/**
 * Every campaign operation, the single contract the Admin UI, `/api/v1/cli`
 * and future adapters serve through `CampaignOperations.invoke`.
 */
export const campaignOperations = {
  ...emailCampaignOperations,
  ...emailAutomationOperations,
};
export type CampaignOperations = typeof campaignOperations;
export type CampaignOperationName = keyof CampaignOperations;
