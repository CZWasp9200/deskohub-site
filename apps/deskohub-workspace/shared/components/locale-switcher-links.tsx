"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  Fragment,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import {
  type Locale,
  locales,
  withLocalePrefixAndSearch,
} from "@/features/i18n";
import { cn } from "@/shared/utils";

/**
 * Saves a signed-in customer's language preference when they switch locale.
 * Their saved preference decides the site locale, so a switch that skipped it
 * would be redirected straight back.
 */
export type LocalePreferenceSaving = {
  /** Resolves `true` for a signed-in customer; streamed after the shell. */
  readonly signedIn: Promise<boolean>;
  readonly save: (input: { readonly locale: Locale }) => Promise<unknown>;
};

type LocaleSwitcherLinksProps = {
  readonly currentLocale: Locale;
  readonly languageLabels: Record<Locale, string>;
  readonly closeMenu?: () => void;
  readonly isMobile?: boolean;
  readonly localePreference?: LocalePreferenceSaving;
};

const useSignedIn = (localePreference?: LocalePreferenceSaving) => {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let current = true;
    localePreference?.signedIn.then(
      (value) => {
        if (current) setSignedIn(value);
      },
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [localePreference]);
  return signedIn;
};

const isPlainClick = (event: MouseEvent<HTMLAnchorElement>) =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

export function LocaleSwitcherLinks({
  currentLocale,
  languageLabels,
  closeMenu,
  isMobile = false,
  localePreference,
}: LocaleSwitcherLinksProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const signedIn = useSignedIn(localePreference);

  const getLocaleHref = (locale: Locale) =>
    withLocalePrefixAndSearch(pathname, locale, searchParams);

  // Guests keep plain document navigation. A signed-in switch saves the
  // preference first, then navigates whether or not the save succeeded.
  const selectLocale =
    signedIn && localePreference
      ? (locale: Locale, event: MouseEvent<HTMLAnchorElement>) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          const href = event.currentTarget.href;
          void localePreference
            .save({ locale })
            .catch(() => undefined)
            .then(() => window.location.assign(href));
        }
      : undefined;

  return (
    <LocaleSwitcherLabels
      currentLocale={currentLocale}
      languageLabels={languageLabels}
      closeMenu={closeMenu}
      getLocaleHref={getLocaleHref}
      isMobile={isMobile}
      selectLocale={selectLocale}
    />
  );
}

export function LocaleSwitcherLabels({
  currentLocale,
  languageLabels,
  closeMenu,
  getLocaleHref,
  isMobile = false,
  selectLocale,
}: Omit<LocaleSwitcherLinksProps, "localePreference"> & {
  readonly getLocaleHref?: (locale: Locale) => string;
  readonly selectLocale?: (
    locale: Locale,
    event: MouseEvent<HTMLAnchorElement>
  ) => void;
}) {
  return locales.map((locale, index) => {
    const isCurrent = locale === currentLocale;
    let label: ReactNode = languageLabels[locale];

    if (isCurrent) {
      label = <strong className="text-white">{languageLabels[locale]}</strong>;
    } else if (getLocaleHref) {
      label = (
        <a
          href={getLocaleHref(locale)}
          onClick={(event) => {
            closeMenu?.();
            selectLocale?.(locale, event);
          }}
          className="transition-colors hover:text-sunset-yellow"
        >
          {languageLabels[locale]}
        </a>
      );
    }

    if (isMobile) {
      return <Fragment key={locale}>{label}</Fragment>;
    }

    return (
      <span
        key={locale}
        className={cn(
          index > 0 &&
            "before:absolute before:translate-x-[0.5ch] before:text-white/28 before:content-['/']"
        )}
      >
        {index > 0 && <br />}
        {label}
      </span>
    );
  });
}
