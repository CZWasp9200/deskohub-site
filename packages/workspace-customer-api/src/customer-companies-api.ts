import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";
import { CustomerAccountLinkRequired } from "./customer-account-api";
import { CustomerServiceUnavailable } from "./customer-session";

// Errors

/**
 * The company ID isn't a Czech company ID (IČO): eight digits with a valid
 * check digit. The registry wasn't asked.
 */
export class CustomerCompanyIdInvalid extends Schema.TaggedErrorClass<CustomerCompanyIdInvalid>()(
  "CustomerCompanyIdInvalid",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("BadRequest"));
}

/** The public business registry has no company with this ID. */
export class CustomerCompanyNotFound extends Schema.TaggedErrorClass<CustomerCompanyNotFound>()(
  "CustomerCompanyNotFound",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("NotFound"));
}

/** The public business registry didn't answer; retry later. */
export class CustomerCompanyRegistryUnavailable extends Schema.TaggedErrorClass<CustomerCompanyRegistryUnavailable>()(
  "CustomerCompanyRegistryUnavailable",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("ServiceUnavailable"));
}

// Companies

/**
 * The business billing details the registry holds for a company, named as
 * the profile's business billing fields, to fill them in. Each field is
 * present only when the registry holds a value the profile accepts.
 */
export const CustomerCompanyDetails = Schema.Struct({
  companyName: Schema.optionalKey(Schema.String),
  /** The company ID (IČO). */
  companyId: Schema.optionalKey(Schema.String),
  /** The VAT ID (DIČ), when the company has one. */
  vatId: Schema.optionalKey(Schema.String),
  /** The street and house number of the registered seat. */
  addressLine1: Schema.optionalKey(Schema.String),
  /** The part of the municipality, when the registry names one. */
  addressLine2: Schema.optionalKey(Schema.String),
  city: Schema.optionalKey(Schema.String),
  zip: Schema.optionalKey(Schema.String),
  /** `CZ` for a seat in Czechia; absent for any other seat. */
  country: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "CustomerCompanyDetails" });
export type CustomerCompanyDetails = typeof CustomerCompanyDetails.Type;

// Endpoints

/**
 * A Czech company's business billing details from the public business
 * registry (ARES), as the website's profile forms look them up. Surrounding
 * whitespace in the ID is ignored. An account awaiting deletion is refused.
 */
export const CustomerCompaniesApi = HttpApiGroup.make("companies")
  .add(
    HttpApiEndpoint.get("lookupCompany", "/:companyId", {
      params: { companyId: Schema.String },
      success: CustomerCompanyDetails,
      error: [
        CustomerCompanyIdInvalid.schema,
        CustomerCompanyNotFound.schema,
        CustomerCompanyRegistryUnavailable.schema,
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .prefix("/companies");
