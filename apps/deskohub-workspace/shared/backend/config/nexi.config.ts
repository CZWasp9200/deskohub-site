import {
  getNexiRequestWorstCaseDuration,
  NexiRuntimeConfig,
  NexiService,
} from "@deskohub/nexi";
import { Duration, Layer } from "effect";
import { env } from "@/env";
import {
  type DeploymentEnvironment,
  getDeploymentRequestTimeout,
} from "./deployment-request-timeout";

/**
 * The Nexi sandbox can take several seconds to create a hosted payment page,
 * and a timeout there leaves the payment attempt ambiguous, so non-production
 * deployments wait much longer than production.
 */
export const getNexiRequestTimeoutMilliseconds = (
  deploymentEnvironment: DeploymentEnvironment
) =>
  Duration.toMillis(
    getDeploymentRequestTimeout(
      {
        production: Duration.seconds(5),
        nonProduction: Duration.seconds(30),
      },
      deploymentEnvironment
    )
  );

/** The per-request Nexi timeout of this deployment. */
export const nexiRequestTimeout = Duration.millis(
  getNexiRequestTimeoutMilliseconds(env.VERCEL_ENV)
);

/**
 * The longest a retried Nexi request of this deployment can take when every
 * attempt times out.
 */
export const nexiRequestWorstCaseDuration =
  getNexiRequestWorstCaseDuration(nexiRequestTimeout);

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
