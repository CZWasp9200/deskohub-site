import { Effect, Layer } from "effect";
import { HttpApi, HttpApiBuilder, type HttpApiGroup } from "effect/http-api";

/** A group's handler builder, seen without its endpoint types. */
interface UntypedHandlers {
  readonly handle: (
    endpoint: never,
    handler: () => Effect.Effect<never>
  ) => UntypedHandlers;
}

/**
 * Handlers for every group of `api` except `handled`, each failing with a
 * defect if called, so a test can serve an API's real handlers for a few
 * groups through `HttpRouter.toWebHandler`.
 */
export const unhandledHttpApiGroups = <
  ApiId extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  handled: ReadonlyArray<string>
): Layer.Layer<never> => {
  const groups: Array<HttpApiGroup.Top> = [];
  HttpApi.reflect(api, {
    onGroup: ({ group }) => {
      groups.push(group);
    },
    onEndpoint: () => undefined,
  });
  return groups
    .filter(({ identifier }) => !handled.includes(identifier))
    .map((group) => unhandledGroup(api, [group.identifier, group]))
    .reduce<Layer.Layer<never>>(
      (merged, group) => Layer.merge(merged, group),
      Layer.empty
    );
};

const unhandledGroup = <
  ApiId extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  [name, group]: readonly [string, HttpApiGroup.Constraint]
): Layer.Layer<never> =>
  HttpApiBuilder.group(api, name as never, (handlers) => {
    let builder: UntypedHandlers = handlers as never;
    for (const endpoint of Object.keys(group.endpoints)) {
      builder = builder.handle(endpoint as never, () =>
        Effect.die(new Error(`Unhandled endpoint: ${name}.${endpoint}`))
      );
    }
    return builder as never;
  }) as never;
