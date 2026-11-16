import type { AppLocale } from "../i18n/app-locale";
import { m } from "../i18n/messages";
import type { NativeHandoffRequest } from "./native-handoff-request";

/** What the app's email step says above its field. */
export interface AppSignInEmailHeading {
  readonly title: string;
  readonly body?: string;
  /** The app asked to sign in again: the page shows the shield. */
  readonly confirmsAccount: boolean;
}

/**
 * The heading of the email step the app opens. A reauthentication is titled
 * "Confirm it's you" and says what it is for when the app names a purpose;
 * without one the title says it all. Any other request is the ordinary
 * sign-in.
 */
export const appSignInEmailHeading = (
  request: NativeHandoffRequest,
  locale: AppLocale
): AppSignInEmailHeading => {
  if (!request.reauthenticate) {
    return {
      title: m.signin_create_title({}, { locale }),
      confirmsAccount: false,
    };
  }
  return {
    title: m.signin_reauthenticate_title({}, { locale }),
    ...(request.purpose === "delete-account"
      ? { body: m.signin_reauthenticate_delete_account_body({}, { locale }) }
      : {}),
    confirmsAccount: true,
  };
};
