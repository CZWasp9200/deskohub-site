import { describe, expect, test } from "bun:test";
import { Context, Deferred, Effect, Layer } from "effect";
import { notFound, redirect } from "next/navigation";
import { NextEffect } from ".";

class TestService extends Context.Service<
  TestService,
  { readonly value: string }
>()("@deskohub/next-effect/test/RunnerService") {}

describe("NextEffect", () => {
  test("run provides the configured layer", async () => {
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "service" }),
    });

    await expect(
      next.run(
        Effect.gen(function* () {
          const service = yield* TestService;
          return service.value;
        })
      )
    ).resolves.toBe("service");
  });

  test("run maps fallible layer setup failures", async () => {
    const mapped = new Error("mapped");
    const next = NextEffect.make({
      layer: Layer.effect(TestService, Effect.fail("setup")),
      mapError: () => mapped,
    });

    await expect(next.run(TestService)).rejects.toBe(mapped);
  });

  test("run builds the layer once and shares it across runs", async () => {
    let builds = 0;
    const next = NextEffect.make({
      layer: Layer.sync(TestService, () => {
        builds += 1;
        return { value: `build-${builds}` };
      }),
    });

    const readValue = Effect.map(TestService, ({ value }) => value);
    const concurrent = await Promise.all([
      next.run(readValue),
      next.run(readValue),
    ]);
    const later = await next.run(readValue);

    expect(builds).toBe(1);
    expect([...concurrent, later]).toEqual(["build-1", "build-1", "build-1"]);
  });

  test("runtimes sharing a memo map reuse each other's built layers", async () => {
    let builds = 0;
    const layer = Layer.sync(TestService, () => {
      builds += 1;
      return { value: "shared" };
    });
    const memoMap = Layer.makeMemoMapUnsafe();
    const first = NextEffect.make({ layer, memoMap });
    const second = NextEffect.make({ layer, memoMap });

    await first.run(TestService);
    await second.run(TestService);

    expect(builds).toBe(1);
  });

  test("concurrent runs do not share layers their effects provide", async () => {
    class RequestService extends Context.Service<
      RequestService,
      { readonly build: number }
    >()("@deskohub/next-effect/test/RequestService") {}
    let builds = 0;
    const requestLayer = Layer.sync(RequestService, () => {
      builds += 1;
      return { build: builds };
    });
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "service" }),
    });
    const release = Deferred.makeUnsafe<void>();
    const handler = Effect.gen(function* () {
      const request = yield* RequestService;
      yield* Deferred.await(release);
      return request.build;
    }).pipe(Effect.provide(requestLayer));

    const first = next.run(handler);
    const second = next.run(handler);
    await Bun.sleep(0);
    Effect.runSync(Deferred.succeed(release, undefined));

    expect((await Promise.all([first, second])).sort()).toEqual([1, 2]);
  });

  test("runs that provide the shared layer again reuse its built instance", async () => {
    let builds = 0;
    const layer = Layer.sync(TestService, () => {
      builds += 1;
      return { value: "shared" };
    });
    const next = NextEffect.make({ layer });

    await next.run(TestService);
    await next.run(TestService.pipe(Effect.provide(layer)));

    expect(builds).toBe(1);
  });

  test("run interrupts a layer-backed effect with its signal", async () => {
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "service" }),
    });
    await next.run(TestService);
    const controller = new AbortController();
    let interrupted = false;
    const result = next.run(
      Effect.never.pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          })
        )
      ),
      { signal: controller.signal }
    );

    controller.abort();

    await expect(result).rejects.toBeDefined();
    expect(interrupted).toBe(true);
  });

  test("run preserves Next control-flow throws with a layer", async () => {
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "service" }),
    });

    await expect(
      next.run(Effect.sync(() => redirect("/target")))
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    await expect(next.run(Effect.sync(() => notFound()))).rejects.toMatchObject(
      {
        digest: "NEXT_HTTP_ERROR_FALLBACK;404",
      }
    );
  });

  test("page passes props into an Effect component", async () => {
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "service" }),
    });
    const Page = next.page((props: { readonly slug: string }) =>
      Effect.gen(function* () {
        const service = yield* TestService;
        return `${service.value}:${props.slug}`;
      })
    );

    await expect(Page({ slug: "menu" })).resolves.toBe("service:menu");
  });

  test("page preserves Next control-flow throws", async () => {
    const next = NextEffect.make();
    const Page = next.page(() => Effect.sync(() => redirect("/target")));

    await expect(Page({})).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  test("page suspends synchronous component construction", async () => {
    const next = NextEffect.make();
    const defect = new Error("construction failed");
    const Page = next.page(() => {
      throw defect;
    });

    await expect(Page({})).rejects.toBe(defect);
  });
});
