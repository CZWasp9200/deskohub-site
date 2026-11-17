import { Effect } from "effect";
import { CustomerApi } from "../customer-api/customer-api.service";
import { customerDataRuntime } from "../customer-api/customer-data-runtime";
import { customerRead } from "../customer-api/customer-request";

/**
 * Looks up a company's billing details in the business registry by its
 * company ID (GET /companies/:companyId). Not an account read: it spends
 * none of the account's read budget.
 */
export const companyLookupAtom = customerDataRuntime.fn((companyId: string) =>
  Effect.flatMap(Effect.service(CustomerApi), (api) =>
    api.companies.lookupCompany({ params: { companyId } })
  ).pipe(customerRead({ accountRead: false }))
);
