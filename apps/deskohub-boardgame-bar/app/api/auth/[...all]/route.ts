import { getAuth } from "@/features/account/backend/auth.server";

/**
 * The Better Auth GET/POST handler (sign-in link request and verification,
 * session, sign-out). Responses are never cached.
 */
const handleAuthRequest = async (request: Request): Promise<Response> => {
  const auth = getAuth();
  if (!auth) {
    return Response.json(
      { message: "Accounts are not available." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const response = await auth.handler(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
};

export { handleAuthRequest as GET, handleAuthRequest as POST };
