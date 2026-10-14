import "server-only";

import { Context, Data, Effect, Layer } from "effect";
import "@/shared/polyfills/temporal";
import type { Locale } from "@/features/i18n";
import { locales } from "@/features/i18n";
import { hashCampaignContent } from "../body/campaign-content-hash";
import { CampaignConfirmationCodeService } from "../backend/campaign-confirmation-code.service";
import { CampaignService } from "../backend/campaign.service";
import type {
  CampaignConfirmationCode,
  CampaignId,
  CampaignSendId,
} from "../campaign-identifiers";
import type {
  CampaignConfirmationRejected,
  CampaignNotFound,
  CampaignReadOnly,
  CampaignRecipientResolutionError,
  CampaignRecipientsOutsideTestDomain,
} from "../errors";

/** What a test send delivered: one email per recipient and content locale. */
export type CampaignTestSendReceipt = {
  readonly recipients: readonly string[];
  readonly locales: readonly Locale[];
  readonly codeExpiresAt: Temporal.Instant;
};

/** The send that froze the campaign's recipients and queued delivery. */
export type CampaignSendReceipt = {
  readonly sendId: CampaignSendId;
  readonly recipientCount: number;
};

/** The send pipeline is not wired into this build yet. */
export class CampaignSendUnavailable extends Data.TaggedError(
  "CampaignSendUnavailable"
)<{ readonly campaignId: CampaignId }> {}

export type CampaignSendPipelineError =
  | CampaignNotFound
  | CampaignReadOnly
  | CampaignConfirmationRejected
  | CampaignRecipientResolutionError
  | CampaignRecipientsOutsideTestDomain
  | CampaignSendUnavailable;

export interface ICampaignSendPipeline {
  /** The env-configured admin inbox that every test send includes. */
  readonly adminInbox: string;
  /**
   * Sends the saved campaign to the admin inbox plus `extraRecipients`, one
   * `[TEST]` email per content locale, each carrying a fresh confirmation
   * code that supersedes earlier ones.
   */
  readonly sendTest: (input: {
    readonly campaignId: CampaignId;
    readonly extraRecipients: readonly string[];
  }) => Effect.Effect<CampaignTestSendReceipt, CampaignSendPipelineError>;
  /**
   * Consumes the typed confirmation code, freezes the resolved recipients,
   * and starts delivery. The campaign leaves Draft.
   */
  readonly send: (input: {
    readonly campaignId: CampaignId;
    readonly confirmationCode: CampaignConfirmationCode;
  }) => Effect.Effect<CampaignSendReceipt, CampaignSendPipelineError>;
}

/**
 * The admin UI's seam to the campaign send pipeline (test send and real
 * send). The pipeline ticket provides `Live`; until then `Stub` issues real
 * confirmation codes, logs them instead of emailing, and refuses real sends.
 */
export class CampaignSendPipeline extends Context.Service<
  CampaignSendPipeline,
  ICampaignSendPipeline
>()("@deskohub-workspace/email-campaigns/CampaignSendPipeline") {
  static Stub = Layer.effect(
    this,
    Effect.gen(function* () {
      const campaigns = yield* CampaignService;
      const confirmationCodes = yield* CampaignConfirmationCodeService;
      const adminInbox = "campaigns@deskohub.test";

      return CampaignSendPipeline.of({
        adminInbox,
        sendTest: Effect.fn("CampaignSendPipeline.Stub.sendTest")(
          function* ({ campaignId, extraRecipients }) {
            const campaign = yield* campaigns.get(campaignId);
            const contentHash = hashCampaignContent({
              purpose: campaign.purpose,
              templateKey: campaign.templateKey,
              locales: campaign.content,
            });
            const issued = yield* confirmationCodes
              .issue({ campaignId, contentHash })
              .pipe(Effect.orDie);
            const recipients = [adminInbox, ...extraRecipients];
            const contentLocales = locales.filter(
              (locale) => campaign.content[locale] !== undefined
            );
            yield* Effect.logInfo("Campaign test send stubbed", {
              campaignId,
              recipients: recipients.length,
              confirmationCode: issued.code,
            });
            return {
              recipients,
              locales: contentLocales,
              codeExpiresAt: issued.expiresAt,
            };
          },
          Effect.catchTag("EffectDrizzleQueryError", Effect.die)
        ),
        send: ({ campaignId }) =>
          Effect.fail(new CampaignSendUnavailable({ campaignId })),
      });
    })
  ).pipe(
    Layer.provide([
      CampaignService.Live,
      CampaignConfirmationCodeService.Live,
    ])
  );

  static Live = this.Stub;
}
