import { Effect, Layer } from "effect";
import { HttpClient } from "effect/http";
import { AccessCodeAttemptStore } from "../access-codes/access-code-attempt-store.service";
import { WorkspaceAdminApiClient } from "../api/workspace-admin-api-client.service";
import { AuthenticationService } from "../authentication/authentication.service";
import { ClientIdentity } from "../authentication/client-identity.service";
import { UpdateService } from "../update/update.service";

/*
 * `dhwCommand` requires the services of every subcommand. A test provides the
 * services its commands use and these stand-ins for the rest. Each operation
 * dies, so a test that reaches one fails instead of passing on a fake.
 */

const unreached = (operation: string) =>
  Effect.die(
    new Error(`${operation} was called, but this test does not provide it.`)
  );

export const UnreachedUpdateService = Layer.succeed(UpdateService, {
  check: () => unreached("UpdateService.check"),
  install: () => unreached("UpdateService.install"),
});

export const UnreachedClientIdentity = Layer.succeed(ClientIdentity, {
  defaultName: unreached("ClientIdentity.defaultName"),
});

export const UnreachedAccessCodeAttemptStore = Layer.succeed(
  AccessCodeAttemptStore,
  {
    reserve: () => unreached("AccessCodeAttemptStore.reserve"),
    forget: () => unreached("AccessCodeAttemptStore.forget"),
  }
);

export const UnreachedAuthenticationService = Layer.succeed(
  AuthenticationService,
  {
    current: unreached("AuthenticationService.current"),
    save: () => unreached("AuthenticationService.save"),
    clear: unreached("AuthenticationService.clear"),
  }
);

/** The real client over an HTTP client that dies on any request. */
export const UnreachedWorkspaceAdminApiClient =
  WorkspaceAdminApiClient.Default.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => unreached("WorkspaceAdminApiClient request"))
      )
    )
  );
