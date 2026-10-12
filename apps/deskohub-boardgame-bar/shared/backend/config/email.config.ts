/**
 * Email Configuration
 *
 * Configuration for the email service
 */

import { EmailServiceTag, makeEmailConfigLayer } from "@deskohub/email";
import { Config, Layer } from "effect";
import { siteConstants } from "@/shared/utils/constants";

/**
 * Email configuration from environment variables. The shared layer adds the
 * Resend key.
 */
export const EmailConfigLayer = makeEmailConfigLayer(
  Config.all({
    email: Config.withDefault(
      Config.string("EMAIL_FROM_ADDRESS"),
      siteConstants.contact.fromEmail
    ),
    name: Config.withDefault(
      Config.string("EMAIL_FROM_NAME"),
      siteConstants.brand.name
    ),
  })
);

export const BoardgameEmailLayer = EmailServiceTag.Live.pipe(
  Layer.provide(EmailConfigLayer)
);
