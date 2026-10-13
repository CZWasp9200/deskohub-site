import type { Duration } from "effect";
import type { env } from "@/env";

export type DeploymentEnvironment = (typeof env)["VERCEL_ENV"];

/**
 * Production fails a slow provider request fast. Preview, development, and
 * test deployments talk to provider sandboxes or share provider capacity with
 * parallel E2E runs, so they wait much longer before giving up.
 */
export const getDeploymentRequestTimeout = (
  timeouts: {
    readonly production: Duration.Duration;
    readonly nonProduction: Duration.Duration;
  },
  deploymentEnvironment: DeploymentEnvironment
) =>
  deploymentEnvironment === "production"
    ? timeouts.production
    : timeouts.nonProduction;
