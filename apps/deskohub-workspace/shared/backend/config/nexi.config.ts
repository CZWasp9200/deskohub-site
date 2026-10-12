import { NexiRuntimeConfig, NexiService } from "@deskohub/nexi";
import { Layer } from "effect";
import { env } from "@/env";

/**
 * Production fails a slow Nexi request fast. Preview, development, and test
 * environments talk to the Nexi sandbox, which can take several seconds to
 * create a hosted payment page; a timeout there leaves the payment attempt
 * ambiguous, so they wait much longer.
 */
export const getNexiRequestTimeoutMilliseconds = (
  deploymentEnvironment: (typeof env)["VERCEL_ENV"]
) => (deploymentEnvironment === "production" ? 5_000 : 30_000);

const WorkspaceNexiRuntimeConfigLayer = Layer.succeed(NexiRuntimeConfig, {
  baseUrl: env.NEXI_API_ORIGIN,
  apiKey: env.NEXI_API_KEY,
  apiTimeout: getNexiRequestTimeoutMilliseconds(env.VERCEL_ENV),
});

export const WorkspaceNexiLayer = NexiService.Live.pipe(
  Layer.provide(WorkspaceNexiRuntimeConfigLayer)
);
