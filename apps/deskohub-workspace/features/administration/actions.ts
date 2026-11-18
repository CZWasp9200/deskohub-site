"use server";

import {
  AdministrationWorkspaceReservationId,
  CliServiceUnavailable,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Schema } from "effect";
import { AdministrationActionLog } from "@/features/admin-cli/administration-action-log.service";
import { recordAdministrationAction } from "@/features/admin-cli/administration-action-record.server";
import { defineAdministrationAction } from "@/features/administrators/server/administration-request.server";
import {
  WithdrawalService,
  WithdrawalUnavailableError,
} from "@/features/withdrawal/backend/withdrawal.service";
import type { WorkspaceActionFailureCopy } from "@/shared/backend/workspace-action";
import { AdministrationService } from "./administration.service";
import { administrationHref } from "./administration-href";
import {
  type ReservationCancellationInput,
  type ReservationLookupInput,
  type ReservationWithdrawalSettlementInput,
  reservationCancellationStandardSchema,
  reservationLookupStandardSchema,
  reservationWithdrawalSettlementStandardSchema,
} from "./contracts";
import { AdministrationCustomerDirectory } from "./customer-directory.service";
import { describeAdministrationCustomer } from "./customer-identity";
import { customerSearchQuerySchema } from "./customer-search-query";
import { m } from "./i18n";
import {
  ReservationAccessAdministration,
  ReservationAccessAdministrationError,
} from "./reservation-access-administration.service";
import {
  ReservationAdministrationError,
  ReservationAdministrationService,
} from "./reservation-administration.service";
import {
  getReservationAccessErrorMessage,
  getReservationCancellationErrorMessage,
} from "./reservation-error-messages";

import {
  ReservationWithdrawalNotFoundError,
  retryReservationWithdrawal,
} from "./reservation-withdrawal";

const failureCopy: WorkspaceActionFailureCopy = {
  timeout: m.administrationActionTimedOut,
  unexpected: m.administrationActionFailedUnexpectedly,
};

const findReservation = Effect.fn("AdministrationService.findReservation")(
  function* (input: ReservationLookupInput) {
    const administration = yield* AdministrationService;
    return {
      reservationId: yield* administration.findReservationId(input.identifier),
    };
  }
);

const getAdministrationReservationAction = defineAdministrationAction(
  {
    operation: "administration.get-reservation",
    failureCopy,
    schema: reservationLookupStandardSchema,
    logInput: false,
    capabilities: AdministrationService.Live,
    fallback: m.administrationReservationLookupUnavailable,
  },
  findReservation
);

export const getAdministrationReservation: typeof getAdministrationReservationAction =
  async (...args: Parameters<typeof getAdministrationReservationAction>) => {
    "use server";
    return await getAdministrationReservationAction(...args);
  };

const searchAdministrationCustomersAction = defineAdministrationAction(
  {
    operation: "administration.search-customers",
    failureCopy,
    schema: customerSearchQuerySchema,
    logInput: false,
    capabilities: AdministrationCustomerDirectory.Live,
    publicFailure: (_, locale) =>
      m.administrationCustomerSearchUnavailable({}, { locale }),
  },
  Effect.fn(function* (input) {
    const directory = yield* AdministrationCustomerDirectory;
    const { kind, customers } = yield* directory.search(input.query);
    return {
      kind,
      customers: customers.map((customer) =>
        describeAdministrationCustomer(customer)
      ),
    };
  })
);

export const searchAdministrationCustomers: typeof searchAdministrationCustomersAction =
  async (...args: Parameters<typeof searchAdministrationCustomersAction>) => {
    "use server";
    return await searchAdministrationCustomersAction(...args);
  };

const reservationPath = ({ reservationId }: { reservationId: string }) => [
  administrationHref("/[locale]/admin/reservations/[reservationId]", {
    reservationId,
  }),
];

const cancelAdministrationReservationAction = defineAdministrationAction(
  {
    operation: "administration.cancel-reservation",
    failureCopy,
    schema: reservationCancellationStandardSchema,
    capabilities: ReservationAdministrationService.Live,
    publicFailure: (cause, locale) =>
      cause instanceof ReservationAdministrationError
        ? getReservationCancellationErrorMessage(cause.reason, locale)
        : m.administrationReservationCancellationFailed({}, { locale }),
    revalidates: reservationPath,
  },
  Effect.fn(function* (input: ReservationCancellationInput) {
    const administration = yield* ReservationAdministrationService;
    return yield* administration.cancel(input);
  })
);

export const cancelAdministrationReservation: typeof cancelAdministrationReservationAction =
  async (...args: Parameters<typeof cancelAdministrationReservationAction>) => {
    "use server";
    return await cancelAdministrationReservationAction(...args);
  };

const settleAdministrationReservationWithdrawalAction =
  defineAdministrationAction(
    {
      operation: "administration.settle-reservation-withdrawal",
      failureCopy,
      schema: reservationWithdrawalSettlementStandardSchema,
      capabilities: Layer.mergeAll(
        WithdrawalService.Live,
        AdministrationActionLog.Live
      ),
      publicFailure: (cause, locale) => {
        if (cause instanceof ReservationWithdrawalNotFoundError) {
          return m.administrationWithdrawalRetryNotFound({}, { locale });
        }
        if (
          cause instanceof WithdrawalUnavailableError ||
          cause instanceof CliServiceUnavailable
        ) {
          return m.administrationWithdrawalRetryUnavailable({}, { locale });
        }
        return undefined;
      },
      revalidates: reservationPath,
    },
    ({ reservationId }: ReservationWithdrawalSettlementInput) =>
      recordAdministrationAction(
        "administration.retryReservationWithdrawal",
        retryReservationWithdrawal(reservationId)
      )
  );

/**
 * Settles the reservation's customer withdrawal now, with every waiting step
 * due at once, as the scheduled settlement would.
 */
export const settleAdministrationReservationWithdrawal: typeof settleAdministrationReservationWithdrawalAction =
  async (
    ...args: Parameters<typeof settleAdministrationReservationWithdrawalAction>
  ) => {
    "use server";
    return await settleAdministrationReservationWithdrawalAction(...args);
  };

const reservationAccessMutationSchema = Schema.toStandardSchemaV1(
  Schema.Union([
    Schema.Struct({
      reservationId: AdministrationWorkspaceReservationId,
      kind: Schema.Literal("retry-failed"),
    }),
    Schema.Struct({
      reservationId: AdministrationWorkspaceReservationId,
      kind: Schema.Literal("confirm-provider-credential-removed"),
      providerCredentialRemoved: Schema.Literal(true),
    }),
  ])
);

const mutateReservationAccessAction = defineAdministrationAction(
  {
    operation: "administration.mutate-reservation-access",
    failureCopy,
    schema: reservationAccessMutationSchema,
    capabilities: ReservationAccessAdministration.Live,
    publicFailure: (cause, locale) =>
      cause instanceof ReservationAccessAdministrationError
        ? getReservationAccessErrorMessage(cause.reason, locale)
        : m.administrationReservationAccessRecoveryFailed({}, { locale }),
    revalidates: reservationPath,
  },
  Effect.fn(function* (input) {
    const administration = yield* ReservationAccessAdministration;
    const grant = yield* administration.mutate(input);
    return { grantState: grant.state };
  })
);

export const mutateReservationAccess: typeof mutateReservationAccessAction =
  async (...args: Parameters<typeof mutateReservationAccessAction>) => {
    "use server";
    return await mutateReservationAccessAction(...args);
  };
