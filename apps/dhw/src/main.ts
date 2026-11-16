import { BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { FetchHttpClient, Headers } from "effect/http";
import { AccessCodeAttemptStore } from "./access-codes/access-code-attempt-store.service";
import { WorkspaceAdminApiClient } from "./api/workspace-admin-api-client.service";
import { AuthenticationService } from "./authentication/authentication.service";
import { ClientIdentity } from "./authentication/client-identity.service";
import { DHW_VERSION } from "./build-info";
import { CliConfigLive } from "./cli-config";
import { dhwCommand } from "./command";
import { DhwConfig } from "./config/dhw-config.service";
import { PlatformLive } from "./platform";
import { ExecutableInstaller } from "./update/executable-installer.service";
import { GithubReleaseService } from "./update/github-release.service";
import { UpdateService } from "./update/update.service";
import { UpdateStateStore } from "./update/update-state-store.service";

const UpdateLive = UpdateService.Default.pipe(
  Layer.provide(UpdateStateStore.Default),
  Layer.provide(GithubReleaseService.Default),
  Layer.provide(ExecutableInstaller.Default)
);

const ApplicationLive = Layer.mergeAll(
  WorkspaceAdminApiClient.Default,
  AccessCodeAttemptStore.Default,
  AuthenticationService.Live,
  ClientIdentity.Default,
  UpdateLive
).pipe(
  Layer.provideMerge(DhwConfig.Default),
  Layer.provide(FetchHttpClient.layer)
);

Command.run(dhwCommand.pipe(Command.provide(ApplicationLive)), {
  version: DHW_VERSION,
}).pipe(
  Effect.provide(Layer.mergeAll(PlatformLive, CliConfigLive)),
  Effect.updateService(Headers.CurrentRedactedNames, (names) => [
    ...names,
    "x-vercel-protection-bypass",
  ]),
  BunRuntime.runMain
);
