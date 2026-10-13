import "@/shared/testing/workspace-test-env";

import { expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import {
  getWorkspaceCallbackOrigin,
  WorkspaceUrlConfigError,
} from "./workspace-url.config";

const getOrigin = (environment: {
  readonly deploymentEnvironment: "development" | "preview" | "production";
  readonly deploymentUrl: string;
  readonly productionUrl?: string;
}) => Effect.runSync(getWorkspaceCallbackOrigin(environment)).origin;

test("selects the callback origin from the runtime environment", () => {
  expect(
    getOrigin({
      deploymentEnvironment: "preview",
      deploymentUrl: "preview-a.vercel.app",
    })
  ).toBe("https://preview-a.vercel.app");

  expect(
    getOrigin({
      deploymentEnvironment: "preview",
      deploymentUrl: "preview-b.vercel.app",
    })
  ).toBe("https://preview-b.vercel.app");

  expect(
    getOrigin({
      deploymentEnvironment: "development",
      deploymentUrl: "localhost:3000",
    })
  ).toBe("http://localhost:3000");

  expect(
    getOrigin({
      deploymentEnvironment: "production",
      deploymentUrl: "ignored.vercel.app",
      productionUrl: "workspace.deskohub.cz",
    })
  ).toBe("https://workspace.deskohub.cz");
});

test("fails with a typed configuration error when the callback URL is missing", () => {
  const exit = Effect.runSyncExit(
    getWorkspaceCallbackOrigin({
      deploymentEnvironment: "production",
      deploymentUrl: "ignored.vercel.app",
      productionUrl: undefined,
    })
  );

  expect(exit).toEqual(
    Exit.fail(
      new WorkspaceUrlConfigError({
        message: "Payment checkout callback URL is not configured.",
      })
    )
  );
});

test("fails with a typed configuration error that keeps the URL parse cause", () => {
  const exit = Effect.runSyncExit(
    getWorkspaceCallbackOrigin({
      deploymentEnvironment: "preview",
      deploymentUrl: "https://exa mple.vercel.app",
      productionUrl: undefined,
    })
  );

  expect(Exit.isFailure(exit)).toBe(true);
  const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
  expect(error).toBeInstanceOf(WorkspaceUrlConfigError);
  expect(error).toMatchObject({
    message: "Payment checkout callback URL is not configured.",
  });
  expect((error as WorkspaceUrlConfigError).cause).toBeInstanceOf(TypeError);
});
