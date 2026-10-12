import { NexiRuntimeConfig, NexiService } from "@deskohub/nexi";
import { Duration, Layer } from "effect";
import { env } from "@/env";

type DeploymentEnvironment = (typeof env)["VERCEL_ENV"];

/**
 * Production fails a slow Nexi request fast. Preview, development, and test
 * environments talk to the Nexi sandbox, which can take several seconds to
 * create a hosted payment page; a timeout there leaves the payment attempt
 * ambiguous, so they wait much longer.
 */
export const getNexiRequestTimeoutMilliseconds = (
  deploymentEnvironment: DeploymentEnvironment
) => (deploymentEnvironment === "production" ? 5_000 : 30_000);

/** The per-request Nexi timeout of this deployment. */
export const nexiRequestTimeout = Duration.millis(
  getNexiRequestTimeoutMilliseconds(env.VERCEL_ENV)
);

export const makeWorkspaceNexiLayer = (
  deploymentEnvironment: DeploymentEnvironment
) =>
  NexiService.Live.pipe(
    Layer.provide(
      Layer.succeed(NexiRuntimeConfig, {
        baseUrl: env.NEXI_API_ORIGIN,
        apiKey: env.NEXI_API_KEY,
        apiTimeout: getNexiRequestTimeoutMilliseconds(deploymentEnvironment),
      })
    )
  );

export const WorkspaceNexiLayer = makeWorkspaceNexiLayer(env.VERCEL_ENV);
