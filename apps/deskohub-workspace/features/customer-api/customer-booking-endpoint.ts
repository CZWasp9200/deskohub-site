import type { WorkspaceCustomerApi } from "@deskohub/workspace-customer-api";
import type { HttpApi, HttpApiBuilder, HttpApiGroup } from "effect/http-api";

type CustomerApiGroups =
  typeof WorkspaceCustomerApi extends HttpApi.HttpApi<string, infer Groups>
    ? Groups
    : never;

/** The booking group's endpoints by identifier, as the composed API serves them. */
type CustomerBookingEndpoints = HttpApiGroup.WithIdentifier<
  CustomerApiGroups,
  "booking"
>["endpoints"];

/**
 * The booking group's `Handlers` with the endpoints named `Handled` already
 * attached. Each booking handlers module attaches its own endpoints'
 * handlers to it.
 */
export type CustomerBookingHandlers<
  R,
  Handled extends keyof CustomerBookingEndpoints = never,
> = HttpApiBuilder.Handlers<R, CustomerBookingEndpoints, Handled>;

/** The booking endpoints' identifiers. */
export type CustomerBookingEndpointName = keyof CustomerBookingEndpoints;
