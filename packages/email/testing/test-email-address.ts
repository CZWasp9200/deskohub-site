import { Schema } from "effect";
import {
  EmailTestDomainSchema,
  resendSimulatorDomain,
} from "../backend/email-config";

/** The decoded `EMAIL_TEST_DOMAIN`; throws when it is missing or invalid. */
export const emailTestDomain = () =>
  Schema.decodeUnknownSync(EmailTestDomainSchema)(
    process.env.EMAIL_TEST_DOMAIN
  );

/**
 * A test recipient on `EMAIL_TEST_DOMAIN`. Mail to it is logged by Console and
 * never sent. Tests build every address this way instead of writing one.
 */
export const testEmailAddress = (localPart: string) =>
  `${localPart}@${emailTestDomain()}`;

export type ResendSimulatorOutcome = "delivered" | "bounced" | "complained";

/**
 * A real Resend recipient whose outcome Resend simulates. Use it where a test
 * needs mail that leaves through Resend rather than Console.
 */
export const resendSimulatorAddress = (
  outcome: ResendSimulatorOutcome,
  label?: string
) => `${label ? `${outcome}+${label}` : outcome}@${resendSimulatorDomain}`;
