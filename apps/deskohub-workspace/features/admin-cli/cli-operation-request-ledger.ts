import {
  type CampaignOperations,
  CurrentAdministrationCaller,
  campaignOperations,
} from "@deskohub/workspace-admin-api";
import { Effect, Match } from "effect";
import type { CliStoredMutation, CliStoredMutationResult } from "@/db/schema";
import type { OperationLedgerRequest } from "@/features/administration/administration-operation-port";
import type { OperationRequestLedger } from "@/features/email-campaigns/backend/operation-request-ledger.service";
import type { AdministrationRequestLedger } from "./administration-request-ledger.service";
import { toOperationLedgerFailure } from "./cli-administration-operations.server";

type CampaignLedgerRequest = OperationLedgerRequest<CampaignOperations>;

/**
 * The stored form of each ledger operation. The kinds predate the port, so
 * a retry that spans a deployment still matches its first request.
 */
const storedMutation = (request: CampaignLedgerRequest): CliStoredMutation =>
  Match.value(request).pipe(
    Match.discriminatorsExhaustive("operation")({
      createCampaignAudience: ({ input }) => ({
        kind: "campaign-audience-create" as const,
        audience: input.audience,
      }),
      createCampaign: ({ input }) => ({
        kind: "campaign-create" as const,
        campaign: input.campaign,
      }),
      duplicateCampaign: ({ input }) => ({
        kind: "campaign-duplicate" as const,
        campaignId: input.campaignId,
      }),
    })
  );

/**
 * The administration API's request ledger for one caller, stored with the
 * other administration requests under the caller's channel, so a retried
 * request replays its first result.
 */
export const cliOperationRequestLedger = (
  ledger: AdministrationRequestLedger["Service"],
  caller: CurrentAdministrationCaller["Service"]
): OperationRequestLedger["Service"] => ({
  applyOnce: (entry) =>
    // A generic operation name can't pair the stored result with its output.
    applyLedgerEntry(ledger, caller, entry) as never,
});

const applyLedgerEntry = <E, R>(
  ledger: AdministrationRequestLedger["Service"],
  caller: CurrentAdministrationCaller["Service"],
  entry: CampaignLedgerRequest & {
    readonly apply: Effect.Effect<CliStoredMutationResult, E, R>;
  }
) =>
  ledger
    .applyOnce({
      requestId: entry.input.requestId,
      mutation: storedMutation(entry),
      result: campaignOperations[entry.operation].output,
      apply: entry.apply,
    })
    .pipe(
      Effect.mapError(toOperationLedgerFailure),
      Effect.provideService(CurrentAdministrationCaller, caller)
    );
