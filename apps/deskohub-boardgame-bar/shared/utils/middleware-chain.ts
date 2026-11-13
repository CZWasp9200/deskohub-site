import {
  type NextFetchEvent,
  type NextRequest,
  NextResponse,
} from "next/server";

export type NextMiddleware = (
  request: NextRequest,
  event: NextFetchEvent,
  response?: NextResponse
) =>
  | NextResponse
  | Response
  | null
  | undefined
  | Promise<NextResponse | Response | null | undefined>;

export type MiddlewareFactory = (next: NextMiddleware) => NextMiddleware;

export function createMiddlewareChain(factories: MiddlewareFactory[]) {
  return createMiddlewareChainAtIndex(factories, 0);
}

function createMiddlewareChainAtIndex(
  factories: readonly MiddlewareFactory[],
  index: number
): NextMiddleware {
  const factory = factories[index];
  // Forward the (possibly extended) headers to the app as *request* headers.
  // Passing them as `NextResponse.next({ headers })` would send them back to
  // the browser as response headers: the visitor's Cookie header would be
  // echoed, and the request's Content-Type would replace the response's,
  // which breaks every Server Action reply.
  if (!factory) {
    return (request) =>
      NextResponse.next({ request: { headers: request.headers } });
  }

  return factory((request, event, response) =>
    createMiddlewareChainAtIndex(factories, index + 1)(request, event, response)
  );
}
