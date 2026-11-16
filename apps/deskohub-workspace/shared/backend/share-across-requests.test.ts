import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Context, Effect, Layer, Schema } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";
import { shareAcrossRequests } from "./share-across-requests";
import { runWorkspaceEffect, toWorkspaceWebHandler } from "./workspace-effect";

const overlapping = 3;

/**
 * A process-wide resource such as a connection pool, provided where it is
 * used with a plain `Effect.provide`, as `WorkspaceDatabase.Default` is.
 */
const makePool = () => {
  const counts = { builds: 0 };
  class Pool extends Context.Service<Pool, { readonly id: number }>()(
    "test/Pool"
  ) {
    static Live = shareAcrossRequests(
      Layer.sync(this, () => ({ id: ++counts.builds }))
    );
  }
  return { Pool, counts };
};

/** Resolves once `overlapping` callers wait on it, so they all overlap. */
const meetingPoint = () => {
  let arrived = 0;
  const allArrived = Promise.withResolvers<void>();
  return Effect.promise(() => {
    arrived += 1;
    if (arrived === overlapping) allArrived.resolve();
    return allArrived.promise;
  });
};

const Answer = Schema.Struct({ pool: Schema.Number });
const Api = HttpApi.make("test").add(
  HttpApiGroup.make("pool").add(
    HttpApiEndpoint.get("pool", "/pool", { success: Answer })
  )
);

describe("shareAcrossRequests", () => {
  test("overlapping API requests that each provide the pool use one pool", async () => {
    const { Pool, counts } = makePool();
    const meet = meetingPoint();
    const handlers = HttpApiBuilder.group(Api, "pool", (group) =>
      group.handle("pool", () =>
        Effect.map(Effect.andThen(meet, Pool), ({ id }) => ({
          pool: id,
        })).pipe(Effect.provide(Pool.Live))
      )
    );
    const handle = toWorkspaceWebHandler(
      HttpApiBuilder.layer(Api).pipe(Layer.provide(handlers))
    );

    const answers = await Promise.all(
      Array.from({ length: overlapping }, async () =>
        Schema.decodeUnknownSync(Answer)(
          await (
            await handle(new Request("https://workspace.deskohub.test/pool"))
          ).json()
        )
      )
    );

    expect(new Set(answers.map(({ pool }) => pool))).toEqual(new Set([1]));
    expect(counts.builds).toBe(1);
  });

  test("overlapping Workspace runs that each provide the pool use one pool", async () => {
    const { Pool, counts } = makePool();
    const meet = meetingPoint();

    const ids = await Promise.all(
      Array.from({ length: overlapping }, () =>
        Effect.map(Effect.andThen(meet, Pool), ({ id }) => id).pipe(
          Effect.provide(Pool.Live),
          runWorkspaceEffect("test.shared-pool")
        )
      )
    );

    expect(new Set(ids)).toEqual(new Set([1]));
    expect(counts.builds).toBe(1);
  });
});
