"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useId, useState } from "react";
import { updatePreferredLanguage } from "@/features/account/actions";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import {
  isLocale,
  type Locale,
  locales,
  withLocalePrefixAndSearch,
} from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import {
  EmailVerificationStatus,
  type EmailVerificationStatusCopy,
} from "./email-verification-status";

/*
 * Direction: extend the account's quiet Sculpin operate surface with a white
 * profile card. Identity is factual, while unavailable settings stay visibly
 * non-interactive and all editable fields remain caller-owned. The avatar
 * media and its controls are caller-owned so the profile form owns their
 * mutation state. The preferred communication language is a Workspace-owned
 * durable preference: it saves through its own server action, never through
 * the surrounding Dotypos profile form.
 */

/**
 * The server-read state of the preference: the saved locale,
 * `{ suggested }` for an account that has none yet (it preselects the page
 * locale and can be saved as is), or `"read-failed"` when the read could not
 * be completed.
 */
export type PreferredLanguageState =
  | Locale
  | { readonly suggested: Locale }
  | "read-failed";

export interface ProfileScreenCopy {
  readonly title: string;
  readonly memberFallback: string;
  readonly verifiedEmail: string;
  readonly emailLabel: string;
  readonly emailVerification: EmailVerificationStatusCopy;
  readonly languageLabel: string;
  readonly languageSave: string;
  readonly languageSaving: string;
  readonly languageSaved: string;
  readonly languageSaveFailed: string;
  readonly languageReadUnavailable: string;
  readonly languageOptionCs: string;
  readonly languageOptionEn: string;
}

export interface ProfileScreenProps {
  readonly firstName: string;
  readonly lastName: string | null;
  readonly email: string;
  readonly copy: ProfileScreenCopy;
  readonly preferredLanguage: PreferredLanguageState;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly avatar?: ReactNode;
}

/**
 * Resolves the announced save-status copy for the current action state:
 * saving wins while executing, then the saved result, then the failure.
 */
const languageStatusCopy = (input: {
  readonly copy: ProfileScreenCopy;
  readonly isSaving: boolean;
  readonly saved: boolean;
  readonly failed: boolean;
}): string | null => {
  if (input.isSaving) return input.copy.languageSaving;
  if (input.saved) return input.copy.languageSaved;
  if (input.failed) return input.copy.languageSaveFailed;
  return null;
};

/**
 * Every Inlang locale must have a translated label key, so adding a locale
 * to the tuple is a compile error until this record gains its label. The
 * option list derives from the tuple, keeping the selector exhaustive.
 */
type LanguageOptionLabelKey = "languageOptionCs" | "languageOptionEn";

const languageOptionLabels: Readonly<Record<Locale, LanguageOptionLabelKey>> = {
  "cs-CZ": "languageOptionCs",
  "en-US": "languageOptionEn",
};

export function ProfileScreen({
  avatar,
  children,
  copy,
  email,
  firstName,
  footer,
  lastName,
  preferredLanguage,
}: ProfileScreenProps) {
  const router = useRouter();
  const titleId = useId();
  const languageId = useId();
  const [selectedLanguage, setSelectedLanguage] = useState<Locale | null>(null);
  const [transportFailed, setTransportFailed] = useState(false);
  const {
    execute: saveLanguage,
    isExecuting: isSaving,
    result,
    reset: resetLanguageResult,
  } = useWorkspaceAction(updatePreferredLanguage, {
    actionName: "account.update-language",
    onSuccess: ({ input }) => {
      // The saved preference is the signed-in site locale, so a changed
      // language moves the page to it with a document navigation.
      const { pathname, search } = window.location;
      const href = withLocalePrefixAndSearch(pathname, input.locale, search);
      if (href !== `${pathname}${search}`) {
        window.location.assign(href);
        return;
      }
      void router.refresh();
    },
    onTransportError: () => {
      setTransportFailed(true);
    },
  });
  const nameParts = [firstName, lastName ?? ""]
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const displayName = nameParts.join(" ") || copy.memberFallback;

  /**
   * The read-failed placeholder is the only missing-selection state. An
   * account without a saved preference preselects the suggested page locale,
   * and Save stays enabled so it can store that value without a change.
   */
  const languagePlaceholder = copy.languageReadUnavailable;
  const savedLanguage = isLocale(preferredLanguage) ? preferredLanguage : null;
  const suggestedLanguage =
    preferredLanguage !== "read-failed" && !isLocale(preferredLanguage)
      ? preferredLanguage.suggested
      : null;
  const languageToSave = selectedLanguage ?? suggestedLanguage;
  const languageValue = selectedLanguage ?? savedLanguage ?? suggestedLanguage;
  const saveFailed = transportFailed || result.serverError != null;
  const languageStatus = languageStatusCopy({
    copy,
    isSaving,
    saved: result.data != null,
    failed: saveFailed,
  });

  /**
   * Clears the announced save outcome so a stale "saved" or failure message
   * never survives next to a different, not-yet-saved selection.
   */
  const clearLanguageFeedback = () => {
    resetLanguageResult();
    setTransportFailed(false);
  };

  const handleLanguageChange = (value: string) => {
    setSelectedLanguage(value as Locale);
    clearLanguageFeedback();
  };

  const handleSaveLanguage = () => {
    if (!languageToSave || isSaving) return;
    clearLanguageFeedback();
    saveLanguage({ locale: languageToSave });
  };

  return (
    <AccountSectionPanel
      className="min-w-0"
      data-screen="profile-screen"
      footer={footer}
      title={copy.title}
      titleId={titleId}
    >
      <div className="flex min-w-0 flex-col gap-5 @xl:flex-row @xl:items-start">
        {avatar}
        <div className="min-w-0">
          <p className="break-words text-2xl font-semibold leading-tight text-[#202b3d]">
            {displayName}
          </p>
          <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#eef0ff] px-2.5 py-1 text-sm font-semibold text-[#3536c9]">
            <Check aria-hidden="true" className="size-4 shrink-0" />
            <span className="break-words">{copy.verifiedEmail}</span>
          </span>
        </div>
      </div>

      <div className="mt-8 grid min-w-0 gap-x-6 gap-y-5 @xl:grid-cols-2 [&>div]:min-w-0 [&>div]:space-y-2 [&_label]:block [&_label]:text-[13px] [&_label]:font-bold [&_label]:uppercase [&_label]:leading-5 [&_label]:tracking-[0.04em] [&_label]:text-[#344258] [&_[data-slot=label]]:block [&_[data-slot=label]]:text-[13px] [&_[data-slot=label]]:font-bold [&_[data-slot=label]]:uppercase [&_[data-slot=label]]:leading-5 [&_[data-slot=label]]:tracking-[0.04em] [&_[data-slot=label]]:text-[#344258] [&_input]:h-11 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-2xl [&_input]:px-3 [&_input]:py-2 [&_input]:text-base [&_[data-slot=input]]:h-11 [&_[data-slot=input]]:min-h-11 [&_[data-slot=input]]:w-full [&_[data-slot=input]]:rounded-2xl [&_[data-slot=input]]:px-3 [&_[data-slot=input]]:py-2 [&_[data-slot=input]]:text-base">
        {children}

        <fieldset
          aria-labelledby={`${languageId}-email-label`}
          className="m-0 min-w-0 space-y-2 border-0 p-0 @xl:col-span-2 @3xl:col-span-1"
        >
          <legend
            className="block text-[13px] font-bold uppercase leading-5 tracking-[0.04em] text-[#344258]"
            id={`${languageId}-email-label`}
          >
            {copy.emailLabel}
          </legend>
          <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-[#cad3df] bg-[#f8fafc] px-3 py-2 text-base leading-6 text-[#202b3d]">
            <span className="min-w-0 flex-1 break-all">{email}</span>
            <EmailVerificationStatus
              copy={copy.emailVerification}
              emailVerified={true}
            />
          </div>
        </fieldset>
      </div>

      <div className="mt-6 min-w-0">
        <Label
          className="block text-[13px] font-bold uppercase leading-5 tracking-[0.04em] text-[#344258]"
          htmlFor={languageId}
        >
          {copy.languageLabel}
        </Label>
        <Select
          disabled={isSaving}
          onValueChange={handleLanguageChange}
          value={languageValue ?? undefined}
        >
          <SelectTrigger
            id={languageId}
            className="mt-2 min-h-11 w-full rounded-2xl border border-[#cad3df] bg-[#f8fafc] px-3 py-2 text-base text-[#52647c] outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
          >
            <SelectValue placeholder={languagePlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {locales.map((optionLocale) => (
              <SelectItem key={optionLocale} value={optionLocale}>
                {copy[languageOptionLabels[optionLocale]]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            className="rounded-xl bg-burned-orange px-4 text-xs uppercase tracking-[0.08em] hover:bg-burned-orange/90"
            disabled={isSaving || languageToSave === null}
            onClick={handleSaveLanguage}
            size="sm"
            type="button"
          >
            {isSaving ? copy.languageSaving : copy.languageSave}
          </Button>
          <div aria-live="polite" className="min-h-5 text-sm">
            {languageStatus !== null ? (
              <p className={saveFailed ? "text-red-700" : "text-emerald-800"}>
                {languageStatus}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </AccountSectionPanel>
  );
}
