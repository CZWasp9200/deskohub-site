import type { AppLocale } from "../i18n/app-locale";
import { m } from "../i18n/messages";
import type { UpdatePrompt } from "./update-prompt";

/** What an update offer says, in the banner and in the quiet card alike. */
export interface UpdateOfferCopy {
  readonly message: string;
  readonly acceptLabel: string;
  readonly dismissLabel: string;
}

/** The offer's message and button labels for `prompt`. */
export const updateOfferCopy = (
  prompt: UpdatePrompt,
  locale: AppLocale
): UpdateOfferCopy =>
  prompt.kind === "native-release"
    ? {
        message: m.native_update_available(
          { versionName: prompt.versionName },
          { locale }
        ),
        acceptLabel: m.native_update_download({}, { locale }),
        dismissLabel: m.update_prompt_dismiss({}, { locale }),
      }
    : {
        message: m.update_ready({}, { locale }),
        acceptLabel: m.update_ready_restart({}, { locale }),
        dismissLabel: m.update_prompt_dismiss({}, { locale }),
      };
