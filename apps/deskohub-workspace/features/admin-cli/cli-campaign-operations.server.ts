import type {
  CampaignOperationName,
  CampaignOperations as CampaignOperationRegistry,
  OperationInput,
} from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { CampaignOperations } from "@/features/email-campaigns/backend/campaign-operations.service";
import { OperationRequestLedger } from "@/features/email-campaigns/backend/operation-request-ledger.service";
import { AdministrationRequestLedger } from "./administration-request-ledger.service";
import { invokeAsCliCaller } from "./cli-administration-operations.server";
import { cliOperationRequestLedger } from "./cli-operation-request-ledger";

/**
 * Runs a campaign operation for the calling administrator, with the ledger
 * of the caller's channel. Every campaign and automation endpoint is the
 * operation of the same name with the request's params, query and payload
 * as its input.
 */
export const cliCampaignOperationInvoker = Effect.gen(function* () {
  const operations = yield* CampaignOperations;
  const ledger = yield* AdministrationRequestLedger;

  const invoke = <Name extends CampaignOperationName>(
    name: Name,
    input: OperationInput<CampaignOperationRegistry[Name]>
  ) =>
    invokeAsCliCaller(
      operations.invoke(name, input),
      OperationRequestLedger,
      (caller) => cliOperationRequestLedger(ledger, caller)
    );

  return invoke;
});
