/**
 * An email address that, when it can't fit one line, breaks before the @
 * rather than anywhere inside it: a zero-width space marks the one break
 * opportunity.
 */
export const emailWithBreak = (email: string) => email.replace("@", "​@");
