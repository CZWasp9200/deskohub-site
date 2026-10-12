import { createLocaleActionMiddleware } from "@deskohub/i18n/action";
import { baseLocale } from "@/features/i18n";
import { requestLocaleScope } from "@/features/i18n/server/request-locale-scope";
import { getLocaleFromServer } from "@/features/i18n/utils/get-locale.server";

export const localeMiddleware = createLocaleActionMiddleware({
  resolveLocale: getLocaleFromServer,
  fallbackLocale: baseLocale,
  scope: requestLocaleScope,
});
