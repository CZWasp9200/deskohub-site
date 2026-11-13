"use client";

import { UserRound } from "lucide-react";
import Image from "next/image";
import { useEffect } from "react";
import logoImage from "@/assets/images/logo/for-dark-bg.png";
import { LanguageSwitcher, LocalizedLink, m, setLocale } from "@/features/i18n";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { siteConstants } from "@/shared/utils/constants";
import { MobileMenu } from "./mobile-menu";
import { ReservationButton } from "./reservation-button";

export function Header() {
  const locale = useLocale();
  const ttrpgRoomHref = `https://workspace.deskohub.cz/${locale}/ttrpg-room`;
  setLocale(locale, { reload: false });

  useEffect(() => {
    // Set --bg-top globally to match the navbar background (gray-900)
    document.documentElement.style.setProperty("--bg-top", "rgb(17, 24, 39)");

    // Cleanup function to reset on unmount
    return () => {
      document.documentElement.style.setProperty("--bg-top", "");
    };
  }, []);

  return (
    <header className="bg-gray-900 text-white px-6 sticky top-0 z-20 safe-padding-top flex items-center justify-center">
      <div className="flex items-center justify-between max-w-7xl w-full gap-x-6 2xl:gap-x-8 min-h-[var(--header-height)]">
        <LocalizedLink href="/">
          <Image
            src={logoImage}
            alt={m["altText.deskohub"]()}
            width={100}
            height={80}
            priority
          />
        </LocalizedLink>
        <nav className="hidden xl:flex space-x-5 2xl:space-x-8 whitespace-nowrap">
          <LocalizedLink
            href="/"
            className="hover:text-green-400 transition-colors"
          >
            {m["nav.home"]()}
          </LocalizedLink>
          <LocalizedLink
            href="/board-games"
            className="hover:text-green-400 transition-colors"
          >
            {m["nav.boardGames"]()}
          </LocalizedLink>
          {siteConstants.featureFlags.accounts && (
            <>
              <LocalizedLink
                href="/events"
                className="hover:text-green-400 transition-colors"
              >
                {m["nav.events"]()}
              </LocalizedLink>
              <LocalizedLink
                href="/membership"
                className="hover:text-green-400 transition-colors"
              >
                {m["nav.membership"]()}
              </LocalizedLink>
            </>
          )}
          <LocalizedLink
            href="/gallery"
            className="hover:text-green-400 transition-colors"
          >
            {m["nav.gallery"]()}
          </LocalizedLink>
          <LocalizedLink
            href="/menu"
            className="hover:text-green-400 transition-colors"
          >
            {m["nav.menu"]()}
          </LocalizedLink>
          <a
            href={ttrpgRoomHref}
            className="hover:text-green-400 transition-colors"
          >
            {m["nav.trainingRoom"]()}
          </a>
          <LocalizedLink
            href="/contact"
            className="hover:text-green-400 transition-colors"
          >
            {m["nav.contact"]()}
          </LocalizedLink>
        </nav>
        <div className="flex items-center space-x-4">
          <div className="hidden xl:flex items-center space-x-4">
            <LanguageSwitcher />
            {siteConstants.featureFlags.accounts && (
              <LocalizedLink
                href="/account"
                aria-label={m["nav.account"]()}
                title={m["nav.account"]()}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10 hover:text-green-400 transition-colors"
              >
                <UserRound className="h-5 w-5" aria-hidden />
              </LocalizedLink>
            )}
            <ReservationButton />
          </div>
          {/* Mobile reservation button - visible on smaller screens */}
          <div className="xl:hidden">
            <ReservationButton size="sm" />
          </div>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
