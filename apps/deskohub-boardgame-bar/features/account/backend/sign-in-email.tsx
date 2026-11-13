import type { EmailMessage } from "@deskohub/email";
import { renderBoardgameEmailHtml } from "@/features/email/backend/email-rendering";
import { baseLocale, type Locale } from "@/features/i18n";
import { m } from "@/features/i18n/paraglide/messages";
import { getLocaleFromPathname } from "@/features/i18n/utils/locale-url";
import { siteConstants } from "@/shared/utils/constants";

const containerStyle = {
  fontFamily: "Arial, sans-serif",
  maxWidth: "600px",
  margin: "0 auto",
  color: "#1f2937",
} as const;
const buttonStyle = {
  display: "inline-block",
  padding: "12px 24px",
  backgroundColor: "#16a34a",
  color: "#ffffff",
  borderRadius: "6px",
  textDecoration: "none",
  fontWeight: "bold",
} as const;
const mutedStyle = { color: "#6b7280", fontSize: "13px" } as const;

/**
 * The sign-in link carries the page the customer returns to
 * (`/cs-CZ/account`), so its locale is the language they were browsing in.
 */
export function signInEmailLocale(signInUrl: string): Locale {
  const callbackUrl = new URL(signInUrl).searchParams.get("callbackURL") ?? "";
  // The callback may be absolute or a bare path; only its pathname matters.
  const pathname = new URL(callbackUrl, "https://placeholder.invalid").pathname;
  return getLocaleFromPathname(pathname) ?? baseLocale;
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
      <div style={containerStyle}>
        <h2>{m["account.email.heading"](undefined, { locale })}</h2>
        <p>{m["account.email.intro"](undefined, { locale })}</p>
        <p>
          <a href={url} style={buttonStyle}>
            {m["account.email.button"](undefined, { locale })}
          </a>
        </p>
        <p style={mutedStyle}>{expiry}</p>
        <p style={mutedStyle}>{ignore}</p>
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
