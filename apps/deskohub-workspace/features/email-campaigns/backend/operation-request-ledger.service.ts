import type { CampaignOperations } from "@deskohub/workspace-admin-api";
import { Context, Layer } from "effect";
import {
  type OperationLedger,
  unscopedOperationLedger,
} from "@/features/administration/administration-operation-port";

/**
 * Where a campaign operation records its request ID. Each adapter provides
 * its own: the CLI keeps one per session, and the admin UI applies directly
 * because server actions aren't retried automatically.
 */
export class OperationRequestLedger extends Context.Service<
  OperationRequestLedger,
  OperationLedger<CampaignOperations>
>()("@deskohub-workspace/email-campaigns/OperationRequestLedger") {
  /** Applies every request; the caller never retries one on its own. */
  static unscoped = Layer.succeed(
    this,
    unscopedOperationLedger<CampaignOperations>()
  );
}
