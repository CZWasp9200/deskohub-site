import type { ComponentProps } from "react";
import type { ProfileScreenProps } from "./profile/profile-screen";
import type { ProfileForm } from "./profile-form";

/**
 * The preferred language is required for every active
 * account, so the loaded state (a saved locale or the explicit read
 * failure) must be structurally mandatory wherever the profile screen
 * renders: an omitted prop must not compile into an unset-success state.
 */
type ProfileFormProps = ComponentProps<typeof ProfileForm>;

const screenProps = (
  preferredLanguage: ProfileScreenProps["preferredLanguage"]
): ProfileScreenProps => ({
  children: null,
  copy: {
    emailLabel: "",
    emailVerification: { unverified: "", verified: "" },
    languageLabel: "",
    languageReadUnavailable: "",
    languageSave: "",
    languageSaveFailed: "",
    languageSaved: "",
    languageOptionCs: "",
    languageOptionEn: "",
    languageSaving: "",
    memberFallback: "",
    title: "",
    verifiedEmail: "",
  },
  email: "",
  firstName: "",
  lastName: null,
  preferredLanguage,
});

const {
  preferredLanguage: requiredScreenLanguage,
  ...screenPropsWithoutLanguage
} = screenProps("cs-CZ");
void requiredScreenLanguage;

// @ts-expect-error ProfileScreen must require the loaded preferred-language state; omitting it must not compile into an unset-success render.
const screenOmittingPreferredLanguage: ProfileScreenProps =
  screenPropsWithoutLanguage;
void screenOmittingPreferredLanguage;

// @ts-expect-error Edit mode must carry the server-read preferred-language state; omitting it must not compile.
const editFormWithoutPreferredLanguage: ProfileFormProps = {
  email: "",
  locale: "en-US",
  mode: "edit",
};
void editFormWithoutPreferredLanguage;

const editFormsWithPreferredLanguage: ProfileFormProps[] = [
  { email: "", locale: "en-US", mode: "edit", preferredLanguage: "cs-CZ" },
  {
    email: "",
    locale: "en-US",
    mode: "edit",
    preferredLanguage: "read-failed",
  },
];
void editFormsWithPreferredLanguage;

const completeFormWithoutPreferredLanguage: ProfileFormProps = {
  email: "",
  locale: "en-US",
  mode: "complete",
};
void completeFormWithoutPreferredLanguage;
