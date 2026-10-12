import { EMAIL_TEST_DOMAIN } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import type { EmailMessage, EmailRecipient } from "../types/email.types";
import {
  EmailConfigTag,
  EmailDeliveryUnconfiguredError,
  type EmailProvider,
  EmailProviderTag,
} from "./capabilities";
import { ConsoleEmailProvider } from "./providers/console-provider";
import { createResendProvider } from "./providers/resend-provider";
import { isTestEmailRecipient } from "./test-recipients";

export type EmailRoute = "console" | "resend";

const recipientList = (
  recipients: EmailRecipient | EmailRecipient[] | undefined
): EmailRecipient[] => [recipients ?? []].flat();

/**
 * The single provider decision for every message: mail addressed only to test
 * recipients is logged by Console and never sent; anything that reaches
 * another recipient goes to Resend.
 */
export const routeEmailMessage = (
  message: Pick<EmailMessage, "to" | "cc" | "bcc">
): EmailRoute =>
  [
    ...recipientList(message.to),
    ...recipientList(message.cc),
    ...recipientList(message.bcc),
  ].every((recipient) => isTestEmailRecipient(recipient.email))
    ? "console"
    : "resend";

/**
 * Staff copies follow the provenance of the request that triggered them: a
 * test-recipient origin addresses the staff mailbox's test twin on the test
 * domain, so automated runs never reach staff, and every other origin reaches
 * the real mailbox in every environment.
 */
export const internalRecipientForOrigin = (
  originEmail: string,
  mailbox: { readonly real: EmailRecipient; readonly testLocalPart: string }
): EmailRecipient =>
  isTestEmailRecipient(originEmail)
    ? {
        email: `${mailbox.testLocalPart}@${EMAIL_TEST_DOMAIN}`,
        name: mailbox.real.name,
      }
    : mailbox.real;

const testEmailSubjectPrefix = "[TESTING]";

/**
 * Staff copies sent outside production carry the test tag, whoever triggered
 * them, so staff can tell Preview and local mail from live requests.
 */
export const staffEmailSubject = (
  subject: string,
  environment: { readonly isProduction: boolean }
): string =>
  environment.isProduction ? subject : `${testEmailSubjectPrefix} ${subject}`;

/**
 * Routes each message by its recipients. A missing Resend key fails only the
 * messages that need Resend, so test mail keeps working without credentials.
 */
export const RoutedEmailProviderLive = Layer.effect(
  EmailProviderTag,
  Effect.gen(function* () {
    const config = yield* EmailConfigTag;
    const apiKey = config.apiKey?.trim();
    const resend = apiKey ? createResendProvider(apiKey) : undefined;

    const provider: EmailProvider = {
      name: "routed",
      send: Effect.fn("routedEmailProvider.send")(function* (
        message: EmailMessage
      ) {
        if (routeEmailMessage(message) === "console") {
          return yield* ConsoleEmailProvider.send(message);
        }
        if (!resend) {
          return yield* new EmailDeliveryUnconfiguredError();
        }
        return yield* resend.send(message);
      }),
      verify: resend ? resend.verify : Effect.succeed(false),
    };

    return provider;
  })
);
