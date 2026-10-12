import {
  EMAIL_TEST_DOMAIN,
  resendSimulatorDomain,
} from "../backend/test-recipients";

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
