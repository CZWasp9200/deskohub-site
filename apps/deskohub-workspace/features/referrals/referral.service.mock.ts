import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { type IReferralService, ReferralService } from "./referral.service";
import { ReferralFeatureFlagServiceMock } from "./referral-feature-flag.service.mock";

export const ReferralServiceMock = (
  overrides: Partial<IReferralService> = {}
) =>
  Layer.succeed(ReferralService, {
    getAccountSummary: () => Effect.die("getAccountSummary was not mocked"),
    acceptReferral: () => Effect.die("acceptReferral was not mocked"),
    lookupCodeKind: () => Effect.die("lookupCodeKind was not mocked"),
    findAvailableCode: () => Effect.die("findAvailableCode was not mocked"),
    evaluateCheckoutReferral: () =>
      Effect.die("evaluateCheckoutReferral was not mocked"),
    hasSettledReferral: () => Effect.die("hasSettledReferral was not mocked"),
    resolveInvitationCandidate: () => Effect.undefined,
    resolveReferrerCandidate: () => Effect.undefined,
    ...overrides,
  });

/**
 * The real ReferralService while the `referrals` flag withholds the program.
 * Its data dependencies are empty mocks, so any read of recorded referrals
 * dies.
 */
export const WithheldReferralService = ReferralService.Default.pipe(
  Layer.provide(
    Layer.mergeAll(
      ReferralFeatureFlagServiceMock({ isEnabled: Effect.succeed(false) }),
      Layer.mock(WorkspaceDatabase, {
        db: new Proxy({} as WorkspaceDatabaseClient, {
          get: () => {
            throw new Error("Withheld referrals must not read the database.");
          },
        }),
      }),
      Layer.mock(WorkspaceDatabaseAdvisoryLock, {}),
      Layer.mock(DotyposService, {}),
      Layer.mock(CustomerAccountResolver, {}),
      Layer.mock(CustomerAccountLinkRepository, {})
    )
  )
);
