import "server-only";

import {
  type CustomerCompanyDetails,
  CustomerCompanyIdInvalid,
  CustomerCompanyNotFound,
  CustomerCompanyRegistryUnavailable,
  WorkspaceCustomerApi,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer, Match } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import type { AresBusinessBillingDraft } from "@/features/account/backend/ares-business-draft";
import {
  type CompanyLookupOutcome,
  CompanyLookupService,
} from "@/features/account/backend/company-lookup.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CustomerAccountLayers } from "./customer-account-layers";
import { answerCustomerApiFailure } from "./customer-api-failure";

/**
 * The companies group's handlers, over `CompanyLookupService` as the
 * website's profile forms use it, under the request's own account standing.
 * The service validates the ID and refuses an account awaiting deletion; a
 * refused account answers as the account endpoints do.
 */
export const CustomerCompaniesApiHandlers = HttpApiBuilder.group(
  WorkspaceCustomerApi,
  "companies",
  Effect.fn(function* (handlers) {
    const { services } = yield* CustomerAccountLayers;
    // The authentication the session middleware read the request through.
    const authentication = Layer.succeed(
      CustomerAuthentication,
      yield* CustomerAuthentication
    );
    const companies = services.companyLookup.pipe(
      Layer.provide(services.currentAccount),
      Layer.provide(authentication)
    );

    return handlers.handle("lookupCompany", ({ params: { companyId } }) =>
      Effect.flatMap(CompanyLookupService, (lookup) =>
        lookup.lookup(companyId)
      ).pipe(
        Effect.provide(companies),
        answerCustomerApiFailure("customerApi.lookupCompany"),
        Effect.flatMap(answerCompanyLookup)
      )
    );
  })
);

/**
 * The company's details as the contract carries them, each only when the
 * registry held it.
 */
const answerCompany = ({
  companyName,
  companyId,
  vatId,
  addressLine1,
  addressLine2,
  city,
  zip,
  country,
}: AresBusinessBillingDraft): CustomerCompanyDetails => ({
  ...(companyName && { companyName }),
  ...(companyId && { companyId }),
  ...(vatId && { vatId }),
  ...(addressLine1 && { addressLine1 }),
  ...(addressLine2 && { addressLine2 }),
  ...(city && { city }),
  ...(zip && { zip }),
  ...(country && { country }),
});

/** A lookup's outcome as the contract carries it. */
const answerCompanyLookup = (outcome: CompanyLookupOutcome) =>
  Match.value(outcome).pipe(
    Match.discriminatorsExhaustive("status")({
      found: ({ company }) => Effect.succeed(answerCompany(company)),
      "invalid-ico": () => Effect.fail(new CustomerCompanyIdInvalid()),
      "not-found": () => Effect.fail(new CustomerCompanyNotFound()),
      unavailable: () => Effect.fail(new CustomerCompanyRegistryUnavailable()),
    })
  );
