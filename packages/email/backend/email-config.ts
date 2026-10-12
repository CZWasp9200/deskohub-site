import { Config, Layer, Option, Schema } from "effect";
import type { EmailConfig, EmailRecipient } from "../types/email.types";
import { EmailConfigTag } from "./capabilities";

/**
 * Resend's simulator domain. Mail to it is a real Resend send whose delivered,
 * bounced, or complained outcome tests can choose, so it is never a test
 * domain.
 */
export const resendSimulatorDomain = "resend.dev";

const hostnamePattern =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const isResendSimulatorDomain = (domain: string) =>
  domain === resendSimulatorDomain ||
  domain.endsWith(`.${resendSimulatorDomain}`);

/**
 * Domain whose recipients Console logs and never sends. Decoding rejects
 * anything but a lowercase hostname, and rejects Resend's simulator domain.
 */
export const EmailTestDomainSchema = Schema.String.check(
  Schema.isPattern(hostnamePattern, {
    message: "EMAIL_TEST_DOMAIN must be a lowercase hostname",
  }),
  Schema.makeFilter((domain: string) => !isResendSimulatorDomain(domain), {
    message: "EMAIL_TEST_DOMAIN must not be Resend's simulator domain",
  })
).pipe(Schema.brand("EmailTestDomain"));
export type EmailTestDomain = typeof EmailTestDomainSchema.Type;

/**
 * Shared delivery configuration for every app. A missing or invalid
 * `EMAIL_TEST_DOMAIN` fails the layer, so no mail is routed without knowing
 * which recipients are test recipients.
 */
export const makeEmailConfigLayer = (
  defaultFrom: Config.Config<EmailRecipient>
) =>
  Layer.effect(
    EmailConfigTag,
    Config.all({
      defaultFrom,
      apiKey: Config.option(Config.string("EMAIL_API_KEY")),
      testDomain: Config.schema(EmailTestDomainSchema, "EMAIL_TEST_DOMAIN"),
    }).pipe(
      Config.map(
        ({ defaultFrom, apiKey, testDomain }): EmailConfig => ({
          defaultFrom,
          apiKey: Option.getOrUndefined(apiKey),
          testDomain,
        })
      )
    )
  );
