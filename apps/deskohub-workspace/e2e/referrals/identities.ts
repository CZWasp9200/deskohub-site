import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { Effect } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { makeWorkspaceE2EAccountRecipientForRunId } from "../account/config";
import {
  createSyntheticCustomerProfile,
  createSyntheticReferralHistoryReservation,
} from "../account/fixtures";
import { makeWorkspaceE2EAccountJournalRecorder } from "../account/journal";
import { workspaceE2EAccountProfileFixture } from "../account/profile-fixture";
import {
  seedWorkspaceE2EReferralOwner,
  type WorkspaceE2EReferralOwner,
} from "../account/referral-fixture";
import {
  seedWorkspaceE2ESyntheticAccount,
  signInWorkspaceE2ESyntheticAccount,
  type WorkspaceE2ESessionSigningSecret,
} from "../account/seeded-session";
import type { DatasourceConfig } from "../config";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import type { WorkspaceE2EReferralCaseId } from "../playwright-checkout/case-catalog";
import type { WorkspaceE2ERunId } from "../run-identifiers";
import { addRedaction, type Runner } from "../runtime";
import type { workspaceE2EReferralRecipientLabels } from "./journal-owners";

type ReferralRecipientLabel<Id extends WorkspaceE2EReferralCaseId> =
  (typeof workspaceE2EReferralRecipientLabels)[Id][number];

export type WorkspaceE2EReferralAccount = {
  readonly accountId: string;
  readonly email: string;
  readonly name: string;
  readonly phone: string;
};

export type WorkspaceE2EReferralLinkedAccount = WorkspaceE2EReferralAccount & {
  readonly customerId: DotyposCustomerId;
};

export type WorkspaceE2EReferrer = WorkspaceE2EReferralLinkedAccount &
  WorkspaceE2EReferralOwner;

/**
 * The synthetic identities of one referral-lane case. Every row is journaled
 * under the case's own journal owner before or as it is created, and every
 * recipient derives from the run id and one of the case's closed labels, so
 * suite cleanup can validate and reconcile it even after an interruption.
 */
export const makeWorkspaceE2EReferralIdentities = <
  Id extends WorkspaceE2EReferralCaseId,
>({
  baseUrl,
  caseId,
  datasourceConfig,
  run,
  runId,
  secret,
}: {
  readonly baseUrl: string;
  readonly caseId: Id;
  readonly datasourceConfig: DatasourceConfig;
  readonly run: Runner;
  readonly runId: WorkspaceE2ERunId;
  readonly secret: WorkspaceE2ESessionSigningSecret;
}) => {
  const recorder = makeWorkspaceE2EAccountJournalRecorder(caseId);
  const record = (
    update: Parameters<typeof recorder.record>[0]
  ): Effect.Effect<void, WorkspaceE2EError> =>
    Effect.tryPromise({
      catch: (cause) =>
        workspaceE2EError("record referral case identity", {
          cause,
          operation: "record referral case identity",
        }),
      try: () => recorder.record(update),
    });

  const describe = (label: ReferralRecipientLabel<Id>) => {
    const email = makeWorkspaceE2EAccountRecipientForRunId(runId, label);
    const name = `Referral ${label}`;
    return {
      accountId: customerAccountIdSchema.make(
        `${caseId}-${label}-${crypto.randomUUID()}`
      ),
      email,
      name,
      phone: workspaceE2EAccountProfileFixture.phone,
    } satisfies WorkspaceE2EReferralAccount;
  };

  /** A synthetic Dotypos profile for one label, journaled once it exists. */
  const createCustomer = (
    label: ReferralRecipientLabel<Id>
  ): Effect.Effect<DotyposCustomerId, WorkspaceE2EError> =>
    Effect.gen(function* () {
      const account = describe(label);
      const customerId = yield* createSyntheticCustomerProfile(
        datasourceConfig,
        {
          email: account.email,
          firstName: account.name,
          phone: account.phone,
        }
      );
      yield* record({ dotyposCustomerIds: [customerId] });
      return customerId;
    });

  return {
    createCustomer,
    describe,

    /** Records a booked customer the case did not create itself. */
    journalCustomer: (customerId: DotyposCustomerId) =>
      record({ dotyposCustomerIds: [customerId] }),

    /** A finished confirmed Dotypos visit, journaled for cancellation. */
    createPastVisit: (customerId: DotyposCustomerId) =>
      Effect.gen(function* () {
        const reservation = yield* createSyntheticReferralHistoryReservation(
          datasourceConfig,
          { customerId }
        );
        const reservationId = reservation.reservationId;
        if (!reservationId) {
          return yield* workspaceE2EError(
            "synthetic past visit has no provider id",
            {
              diagnosticCode: "dotypos_account_fixture_mutation_failed",
              operation: "create referral past visit",
            }
          );
        }
        yield* record({ dotyposReservationIds: [reservationId] });
        return {
          endedAt: new Date(Number(reservation.endsAt.epochMilliseconds)),
          reservationId: reservationId as DotyposReservationId,
        };
      }),

    /**
     * A verified Better Auth user without a customer link: the state right
     * after a first magic-link sign-in.
     */
    seedUnlinkedAccount: (
      label: ReferralRecipientLabel<Id>
    ): Effect.Effect<
      WorkspaceE2EReferralAccount,
      WorkspaceE2EError,
      E2EDatabase
    > =>
      Effect.gen(function* () {
        const account = describe(label);
        yield* record({ authUserIds: [account.accountId] });
        yield* seedWorkspaceE2ESyntheticAccount(account);
        return account;
      }),

    /** A completed profile: a verified user linked to its own new customer. */
    seedLinkedAccount: (
      label: ReferralRecipientLabel<Id>
    ): Effect.Effect<
      WorkspaceE2EReferralLinkedAccount,
      WorkspaceE2EError,
      E2EDatabase
    > =>
      Effect.gen(function* () {
        const account = describe(label);
        yield* record({ authUserIds: [account.accountId] });
        const customerId = yield* createCustomer(label);
        yield* seedWorkspaceE2ESyntheticAccount({
          ...account,
          linkedCustomerId: customerId,
        });
        return { ...account, customerId };
      }),

    /** A linked account that owns a usable referral code. */
    seedReferrer: (
      label: ReferralRecipientLabel<Id>
    ): Effect.Effect<WorkspaceE2EReferrer, WorkspaceE2EError, E2EDatabase> =>
      Effect.gen(function* () {
        const account = describe(label);
        yield* record({ authUserIds: [account.accountId] });
        const customerId = yield* createCustomer(label);
        const owner = yield* seedWorkspaceE2EReferralOwner({
          accountId: account.accountId,
          dotyposCustomerId: customerId,
          email: account.email,
          name: account.name,
        });
        addRedaction(owner.code, true);
        return { ...account, ...owner, customerId };
      }),

    /** Signs this case's browser session in as one of its accounts. */
    signIn: (
      account: Pick<WorkspaceE2EReferralAccount, "accountId">,
      session: string
    ) =>
      signInWorkspaceE2ESyntheticAccount({
        accountId: account.accountId,
        baseUrl,
        run,
        secret,
        session,
      }),
  };
};

export type WorkspaceE2EReferralIdentities = ReturnType<
  typeof makeWorkspaceE2EReferralIdentities
>;
