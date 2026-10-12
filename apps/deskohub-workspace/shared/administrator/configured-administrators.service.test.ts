import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { AdministrationActorUsername } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { ConfiguredAdministrators } from "./configured-administrators.service";

const membershipProgram = Effect.gen(function* () {
  const administrators = yield* ConfiguredAdministrators;
  return {
    admin: yield* administrators.hasUsername(
      AdministrationActorUsername.make("admin")
    ),
    operator: yield* administrators.hasUsername(
      AdministrationActorUsername.make("operator")
    ),
    nobody: yield* administrators.hasUsername(
      AdministrationActorUsername.make("nobody")
    ),
  };
});

describe("configured administrators capability", () => {
  test("answers exact username membership from the validated environment registry", async () => {
    const membership = await Effect.runPromise(
      membershipProgram.pipe(Effect.provide(ConfiguredAdministrators.Default))
    );

    expect(membership).toEqual({
      admin: true,
      operator: true,
      nobody: false,
    });
  });
});
