import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { apiOrigin } from "../auth/auth-client.web";
import { webCustomerApiTransport } from "./platform-transports";

export const customerApiTransportLayer = Layer.merge(
  webCustomerApiTransport({ apiOrigin }),
  FetchHttpClient.layer
);
