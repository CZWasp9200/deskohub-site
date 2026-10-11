import type { EmailConfig } from "@deskohub/email";
import { EmailConfigTag } from "@deskohub/email";
import { Config, Layer, Option } from "effect";
import { workspaceSiteConstants } from "@/shared/utils";

const defaultFromEmail = "reservations@workspace.deskohub.cz";

export const EmailConfigLayer = Layer.effect(
  EmailConfigTag,
  Config.option(Config.string("EMAIL_API_KEY")).pipe(
    Config.map(
      (apiKey): EmailConfig => ({
        defaultFrom: {
          email: defaultFromEmail,
          name: workspaceSiteConstants.brand.name,
        },
        apiKey: Option.getOrUndefined(apiKey),
      })
    )
  )
);
