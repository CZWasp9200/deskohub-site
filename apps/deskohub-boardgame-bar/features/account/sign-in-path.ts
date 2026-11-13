/**
 * The page a customer returns to after signing in. Only same-site paths are
 * accepted, so a crafted link can't send a freshly signed-in customer to
 * another website.
 */
export function safeReturnPath(next: string | undefined): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/account";
  }
  return next;
}

/** The sign-in page address that returns to `next` afterwards. */
export function signInHref(next: string): string {
  return `/sign-in?next=${encodeURIComponent(next)}`;
}
