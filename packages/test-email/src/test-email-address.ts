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

/**
 * A test recipient on `EMAIL_TEST_DOMAIN`. Mail to it is logged by Console and
 * never sent. Tests build every address this way instead of writing one.
 */
export const testEmailAddress = (localPart: string) =>
  `${localPart}@${EMAIL_TEST_DOMAIN}`;

export type ResendSimulatorOutcome = "delivered" | "bounced" | "complained";

/**
 * A real Resend recipient whose outcome Resend simulates. Use it where a test
 * needs mail that leaves through Resend rather than Console.
 */
export const resendSimulatorAddress = (
  outcome: ResendSimulatorOutcome,
  label?: string
) => `${label ? `${outcome}+${label}` : outcome}@${resendSimulatorDomain}`;
