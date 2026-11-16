import { AdministrationCustomerSearchQuery } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";

/** An administrator's customer search input, decoded strictly: every issue is reported and unknown fields are rejected. */
export const customerSearchQuerySchema = Schema.toStandardSchemaV1(
  AdministrationCustomerSearchQuery,
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);
