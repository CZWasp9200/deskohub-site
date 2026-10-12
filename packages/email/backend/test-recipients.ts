/**
 * Test recipients live on this reserved `.test` domain (RFC 6761), which can
 * never deliver mail. The email service logs their messages through Console
 * and never sends them. Dependency-free so browser bundles can import it.
 */
export const EMAIL_TEST_DOMAIN = "deskohub.test";

/**
 * Resend's simulator domain. Mail to it is a real Resend send whose delivered,
 * bounced, or complained outcome tests can choose, so it is never a test
 * recipient.
 */
export const resendSimulatorDomain = "resend.dev";

export const isTestEmailRecipient = (email: string): boolean =>
  email.trim().toLowerCase().endsWith(`@${EMAIL_TEST_DOMAIN}`);
