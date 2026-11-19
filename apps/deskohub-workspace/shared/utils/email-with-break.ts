/**
 * An email address that, when it can't fit one line, breaks before the @
 * rather than anywhere inside it: a zero-width space marks the one break
 * opportunity. The app's `ui/email-with-break.ts` does the same.
 */
export const emailWithBreak = (email: string) => email.replace("@", "​@");
