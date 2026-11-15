import { DotyposService } from "@deskohub/dotypos";
import { Layer } from "effect";
import { AdministrationCustomerDirectory } from "./customer-directory.service";

/**
 * The real directory over a Dotypos that implements nothing, for tests whose
 * code paths never read a customer: any Dotypos call dies.
 */
export const UnusedAdministrationCustomerDirectory =
  AdministrationCustomerDirectory.Default.pipe(
    Layer.provide(Layer.mock(DotyposService, {}))
  );
