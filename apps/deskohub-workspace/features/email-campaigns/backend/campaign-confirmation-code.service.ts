import "server-only";

import { NodeCrypto } from "@effect/platform-node";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Crypto, Effect, Layer, type PlatformError } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import { emailCampaignConfirmationCodes, emailCampaigns } from "@/db/schema";
import "@/shared/polyfills/temporal";
import { currentInstant } from "@/shared/utils/temporal";
import {
  type CampaignContentHash,
  hashCampaignContent,
} from "../body/campaign-content-hash";
import {
  type CampaignConfirmationCode,
  type CampaignId,
  campaignConfirmationCodeSchema,
} from "../campaign-identifiers";
import {
  CampaignConfirmationRejected,
  CampaignNotFound,
  CampaignReadOnly,
} from "../errors";

const campaignConfirmationCodeLifetime = Temporal.Duration.from({
  hours: 24,
});

/** Unambiguous uppercase letters and digits; 256 is a multiple of its length. */
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codeLength = 8;

/** Accepts the code as typed: any case, spaces, or a separating hyphen. */
const normalizeCampaignConfirmationCode = (typed: string) =>
  typed.toUpperCase().replaceAll(/[\s-]/g, "");

type IssuedCampaignConfirmationCode = {
  readonly code: CampaignConfirmationCode;
  readonly expiresAt: Temporal.Instant;
};

type CampaignDraftError =
  | CampaignNotFound
  | CampaignReadOnly
  | EffectDrizzleQueryError
  | SqlError.SqlError;

export interface ICampaignConfirmationCodeService {
  /**
   * Issues the code a test send delivers, bound to the hash of the content
   * that test send rendered. It supersedes the campaign's earlier codes.
   */
  readonly issue: (input: {
    readonly campaignId: CampaignId;
    readonly contentHash: CampaignContentHash;
  }) => Effect.Effect<
    IssuedCampaignConfirmationCode,
    CampaignDraftError | PlatformError.PlatformError
  >;
  /**
   * Consumes the typed code for the real send. It must be the campaign's
   * latest unexpired code and match the campaign's current content.
   */
  readonly confirm: (input: {
    readonly campaignId: CampaignId;
    readonly code: string;
  }) => Effect.Effect<void, CampaignDraftError | CampaignConfirmationRejected>;
}

export class CampaignConfirmationCodeService extends Context.Service<
  CampaignConfirmationCodeService,
  ICampaignConfirmationCodeService
>()("@deskohub-workspace/email-campaigns/CampaignConfirmationCodeService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const crypto = yield* Crypto.Crypto;

      const makeCode = crypto
        .randomBytes(codeLength)
        .pipe(
          Effect.map((bytes) =>
            campaignConfirmationCodeSchema.make(
              Array.from(
                bytes,
                (byte) => codeAlphabet[byte % codeAlphabet.length]
              ).join("")
            )
          )
        );

      const loadDraft = Effect.fn("CampaignConfirmationCodeService.loadDraft")(
        function* (campaignId: CampaignId) {
          const [campaign] = yield* db
            .select()
            .from(emailCampaigns)
            .where(eq(emailCampaigns.id, campaignId));
          if (!campaign) return yield* new CampaignNotFound({ campaignId });
          if (campaign.status !== "draft") {
            return yield* new CampaignReadOnly({
              campaignId,
              status: campaign.status,
            });
          }
          return campaign;
        }
      );

      const rejectionReason = Effect.fn(
        "CampaignConfirmationCodeService.rejectionReason"
      )(function* (input: {
        readonly campaignId: CampaignId;
        readonly code: string;
        readonly contentHash: CampaignContentHash;
        readonly now: Temporal.Instant;
      }) {
        const [row] = yield* db
          .select()
          .from(emailCampaignConfirmationCodes)
          .where(
            and(
              eq(emailCampaignConfirmationCodes.campaignId, input.campaignId),
              eq(emailCampaignConfirmationCodes.code, input.code)
            )
          );
        if (!row) return "unknown-code" as const;
        if (row.confirmedAt) return "already-confirmed" as const;
        if (row.supersededAt) return "superseded" as const;
        if (Temporal.Instant.compare(row.expiresAt, input.now) <= 0) {
          return "expired" as const;
        }
        return "content-changed" as const;
      });

      return {
        issue: Effect.fn("CampaignConfirmationCodeService.issue")(function* ({
          campaignId,
          contentHash,
        }) {
          yield* loadDraft(campaignId);
          const code = yield* makeCode;
          const issuedAt = yield* currentInstant;
          const expiresAt = issuedAt.add(campaignConfirmationCodeLifetime);
          yield* db.transaction(
            Effect.fn(function* (tx) {
              yield* tx
                .update(emailCampaignConfirmationCodes)
                .set({ supersededAt: issuedAt })
                .where(
                  and(
                    eq(emailCampaignConfirmationCodes.campaignId, campaignId),
                    isNull(emailCampaignConfirmationCodes.supersededAt)
                  )
                );
              yield* tx.insert(emailCampaignConfirmationCodes).values({
                campaignId,
                code,
                contentHash,
                issuedAt,
                expiresAt,
              });
            })
          );
          return { code, expiresAt };
        }),
        confirm: Effect.fn("CampaignConfirmationCodeService.confirm")(
          function* ({ campaignId, code: typed }) {
            const campaign = yield* loadDraft(campaignId);
            const code = normalizeCampaignConfirmationCode(typed);
            const contentHash = hashCampaignContent({
              purpose: campaign.purpose,
              templateKey: campaign.templateKey,
              locales: campaign.content,
            });
            const now = yield* currentInstant;
            const confirmed = yield* db
              .update(emailCampaignConfirmationCodes)
              .set({ confirmedAt: now })
              .where(
                and(
                  eq(emailCampaignConfirmationCodes.campaignId, campaignId),
                  eq(emailCampaignConfirmationCodes.code, code),
                  eq(emailCampaignConfirmationCodes.contentHash, contentHash),
                  isNull(emailCampaignConfirmationCodes.supersededAt),
                  isNull(emailCampaignConfirmationCodes.confirmedAt),
                  gt(emailCampaignConfirmationCodes.expiresAt, now)
                )
              )
              .returning({ code: emailCampaignConfirmationCodes.code });
            if (confirmed.length > 0) return;

            const reason = yield* rejectionReason({
              campaignId,
              code,
              contentHash,
              now,
            });
            return yield* new CampaignConfirmationRejected({
              campaignId,
              reason,
            });
          }
        ),
      } satisfies ICampaignConfirmationCodeService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(Layer.mergeAll(WorkspaceDatabase.Default, NodeCrypto.layer))
  );
}
