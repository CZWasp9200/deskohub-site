import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { notFound, redirect } from "next/navigation";
import { execute } from "./executor";

describe("execute", () => {
  test("returns successful values", async () => {
    await expect(execute(Effect.succeed("ok"))).resolves.toBe("ok");
  });

  test("maps typed failures when mapError is provided", async () => {
    const mapped = new Error("mapped");

    await expect(
      execute(Effect.fail("domain"), {
        mapError: () => mapped,
      })
    ).rejects.toBe(mapped);
  });

  test("rejects typed failures directly without mapError", async () => {
    const failure: { readonly _tag: "DomainError" } = { _tag: "DomainError" };

    await expect(execute(Effect.fail(failure))).rejects.toBe(failure);
  });

  test("rejects defects without swallowing them", async () => {
    const defect = new Error("boom");

    await expect(execute(Effect.die(defect))).rejects.toBe(defect);
  });

  test("preserves Next redirect control-flow defects", async () => {
    await expect(
      execute(Effect.sync(() => redirect("/target")))
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  test("preserves Next notFound control-flow defects", async () => {
    await expect(execute(Effect.sync(() => notFound()))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });

  test("interrupts execution with an explicit signal", async () => {
    const controller = new AbortController();
    const result = execute(Effect.never, { signal: controller.signal });

    controller.abort();

    await expect(result).rejects.toBeDefined();
  });
});
