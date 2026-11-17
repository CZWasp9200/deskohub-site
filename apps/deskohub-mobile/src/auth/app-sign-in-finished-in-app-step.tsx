import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { AppSignInLayout } from "./app-sign-in-layout";

/**
 * The sign-in page the app opened, once the email's link signed the customer
 * in to the app instead. Shown only when the browser keeps the tab open
 * after the page asked to close it; nothing is left to do here.
 */
export function AppSignInFinishedInAppStep() {
  const locale = useAppLocale();
  return (
    <AppSignInLayout
      title={m.signin_signed_in_in_app_title({}, { locale })}
      instructions={m.signin_signed_in_in_app_body({}, { locale })}
    />
  );
}
