import type { EmailMessage } from "@deskohub/email";
import {
  boardgameEmailStyles,
  renderBoardgameEmailHtml,
} from "@/features/email/backend/email-rendering";
import { baseLocale, type Locale } from "@/features/i18n";
import { m } from "@/features/i18n/paraglide/messages";
import { getLocaleFromPathname } from "@/features/i18n/utils/locale-url";
import { siteConstants } from "@/shared/utils/constants";

/**
 * The language of a sign-in callback (`/cs-CZ/account`), the one the customer
 * was browsing in. The callback may be absolute or a bare path; only its
 * pathname matters.
 */
export function callbackLocale(callbackUrl: string): Locale {
  const pathname = new URL(callbackUrl, "https://placeholder.invalid").pathname;
  return getLocaleFromPathname(pathname) ?? baseLocale;
}

/** The sign-in link carries the page the customer returns to. */
export function signInEmailLocale(signInUrl: string): Locale {
  return callbackLocale(
    new URL(signInUrl).searchParams.get("callbackURL") ?? ""
  );
}

export function buildSignInEmail({
  email,
  url,
  expiresInMinutes,
}: {
  readonly email: string;
  readonly url: string;
  readonly expiresInMinutes: number;
}): EmailMessage {
  const locale = signInEmailLocale(url);
  const expiry = m["account.email.expiry"](
    { minutes: expiresInMinutes },
    { locale }
  );
  const ignore = m["account.email.ignore"](undefined, { locale });

  return {
    from: {
      email: siteConstants.contact.fromEmail,
      name: siteConstants.brand.name,
    },
    to: { email },
    subject: m["account.email.subject"](undefined, { locale }),
    html: renderBoardgameEmailHtml(
      <div style={boardgameEmailStyles.container}>
        <h2>{m["account.email.heading"](undefined, { locale })}</h2>
        <p>{m["account.email.intro"](undefined, { locale })}</p>
        <p>
          <a href={url} style={boardgameEmailStyles.button}>
            {m["account.email.button"](undefined, { locale })}
          </a>
        </p>
        <p style={boardgameEmailStyles.muted}>{expiry}</p>
        <p style={boardgameEmailStyles.muted}>{ignore}</p>
      </div>
    ),
    text: [
      m["account.email.intro"](undefined, { locale }),
      url,
      expiry,
      ignore,
    ].join("\n\n"),
    tags: ["account-sign-in"],
  };
}
