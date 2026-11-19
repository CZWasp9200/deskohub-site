/**
 * Email Configuration
 *
 * Configuration for the email service
 */

import {
  type EmailConfig,
  EmailConfigTag,
  type EmailProvider,
  type EmailProviderConfig,
  EmailProviders,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email";
import {
  deploymentResendRequestTimeouts,
  makeResendEmailProvider,
} from "@deskohub/email-resend";
import { Config, Effect, Layer, Option } from "effect";
import { siteConstants } from "@/shared/utils/constants";

/**
 * Email configuration from environment variables
 */
const emailConfig = Config.all({
  provider: Config.option(
    Config.Literals(["resend", "console"], "EMAIL_PROVIDER")
  ),
  defaultFromEmail: Config.withDefault(
    Config.String("EMAIL_FROM_ADDRESS"),
    siteConstants.contact.fromEmail
  ),
  defaultFromName: Config.withDefault(
    Config.String("EMAIL_FROM_NAME"),
    siteConstants.brand.name
  ),
  apiKey: Config.option(Config.String("EMAIL_API_KEY")),
  testMode: Config.withDefault(Config.Boolean("EMAIL_TEST_MODE"), false),
  vercelEnv: Config.option(Config.String("VERCEL_ENV")),
});

/**
 * Email configuration layer
 */
export const EmailConfigLayer = Layer.effect(
  EmailConfigTag,
  emailConfig.pipe(
    Config.map((config) => {
      const apiKey = Option.getOrUndefined(config.apiKey);
      const provider: EmailProviderConfig["provider"] = Option.getOrElse(
        config.provider,
        () => (apiKey ? "resend" : "console")
      );
      const providerConfig: EmailProviderConfig = {
        provider,
        defaultFrom: {
          email: config.defaultFromEmail,
          name: config.defaultFromName,
        },
        apiKey,
        // Test mode sends mail to the console, so the live site ignores it.
        testMode:
          config.testMode && !Option.contains(config.vercelEnv, "production"),
      };
      return providerConfig;
    })
  )
);

const resendChain = Effect.fnUntraced(function* (config: EmailConfig) {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    return yield* new EmailServiceError(
      "EMAIL_API_KEY is required for Resend email provider",
      undefined,
      "resend"
    );
  }
  yield* Effect.logInfo("Using Resend email provider");
  const resend = makeResendEmailProvider({
    apiKey,
    timeouts: yield* deploymentResendRequestTimeouts,
  });
  return [resend] as ReadonlyArray<EmailProvider>;
});

/**
 * Boardgame Bar sends through the one provider `EMAIL_PROVIDER` names.
 * Console, an empty chain, is allowed outside production, in Preview, and
 * in test mode; production falls back to Resend when a key exists.
 */
const boardgameProviderChain = Effect.fnUntraced(function* (
  config: EmailConfig
) {
  if (config.provider === "resend") return yield* resendChain(config);

  if (config.provider !== "console") {
    return yield* new EmailServiceError(
      `Unsupported email provider: ${config.provider}`,
      undefined,
      config.provider
    );
  }

  const stage = yield* Config.all({
    nodeEnv: Config.option(Config.String("NODE_ENV")),
    vercelEnv: Config.option(Config.String("VERCEL_ENV")),
  });
  const consoleProviderAllowed =
    !Option.contains(stage.nodeEnv, "production") ||
    Option.contains(stage.vercelEnv, "preview") ||
    config.testMode === true;

  if (!consoleProviderAllowed) {
    if (config.apiKey) return yield* resendChain(config);

    return yield* new EmailServiceError(
      "Console email provider is disabled in production",
      undefined,
      "console"
    );
  }

  yield* Effect.logInfo("Using Console email provider");
  return [] as ReadonlyArray<EmailProvider>;
});

/** Boardgame Bar sends only transactional mail; it has no marketing stream. */
const BoardgameEmailProvidersLayer = Layer.effect(
  EmailProviders,
  Effect.gen(function* () {
    const chain = yield* boardgameProviderChain(yield* EmailConfigTag);
    return {
      transactional: chain,
      marketing: chain,
      marketingCategories: new Set<string>(),
    };
  })
);

export const BoardgameEmailLayer = EmailServiceTag.Default.pipe(
  Layer.provide(
    BoardgameEmailProvidersLayer.pipe(Layer.provideMerge(EmailConfigLayer))
  )
);
