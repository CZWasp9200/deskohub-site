/**
 * Email Configuration
 *
 * Configuration for the email service
 */

import {
  type EmailConfig,
  EmailConfigTag,
  EmailServiceTag,
} from "@deskohub/email";
import { Config, Layer, Option } from "effect";
import { siteConstants } from "@/shared/utils/constants";

/**
 * Email configuration from environment variables
 */
const emailConfig = Config.all({
  defaultFromEmail: Config.withDefault(
    Config.string("EMAIL_FROM_ADDRESS"),
    siteConstants.contact.fromEmail
  ),
  defaultFromName: Config.withDefault(
    Config.string("EMAIL_FROM_NAME"),
    siteConstants.brand.name
  ),
  apiKey: Config.option(Config.string("EMAIL_API_KEY")),
});

/**
 * Email configuration layer
 */
export const EmailConfigLayer = Layer.effect(
  EmailConfigTag,
  emailConfig.pipe(
    Config.map(
      (config): EmailConfig => ({
        defaultFrom: {
          email: config.defaultFromEmail,
          name: config.defaultFromName,
        },
        apiKey: Option.getOrUndefined(config.apiKey),
      })
    )
  )
);

export const BoardgameEmailLayer = EmailServiceTag.Live.pipe(
  Layer.provide(EmailConfigLayer)
);
