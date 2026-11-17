import { DotyposService, DotyposUnavailable } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { AdministrationCustomerDirectory } from "./customer-directory.service";

/**
 * The real directory over a Dotypos that implements nothing, for tests whose
 * code paths never read a customer: any Dotypos call dies.
 */
export const UnusedAdministrationCustomerDirectory =
  AdministrationCustomerDirectory.Default.pipe(
    Layer.provide(Layer.mock(DotyposService, {}))
  );

/** The failure of a Dotypos customer read that the directory can't recover. */
export const failedCustomerRead = () =>
  Effect.fail(
    new DotyposUnavailable({ operation: "getCustomer", reason: "server" })
  );
