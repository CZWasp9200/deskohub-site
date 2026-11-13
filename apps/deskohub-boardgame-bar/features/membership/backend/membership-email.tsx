import type { EmailMessage } from "@deskohub/email";
import { renderBoardgameEmailHtml } from "@/features/email/backend/email-rendering";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n/paraglide/messages";
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

/** What a membership email needs to know about the member and the period. */
export type MembershipEmailDetails = {
  readonly email: string;
  readonly name: string;
  readonly planName: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly locale: Locale;
};

/** The bar's calendar day, whatever time zone the server runs in. */
const formatDay = (date: Date, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "Europe/Prague",
  }).format(date);

const accountUrl = (locale: Locale): string =>
  `https://${siteConstants.brand.publicDomain}/${locale}/account`;

function membershipEmail(input: {
  readonly details: MembershipEmailDetails;
  readonly subject: string;
  readonly heading: string;
  readonly body: string;
  readonly note: string;
  readonly button: string;
  readonly tag: string;
}): EmailMessage {
  const { details } = input;
  const greeting = m["membership.email.greeting"](
    { name: details.name },
    { locale: details.locale }
  );
  const url = accountUrl(details.locale);

  return {
    from: {
      email: siteConstants.contact.fromEmail,
      name: siteConstants.brand.name,
    },
    to: { email: details.email },
    subject: input.subject,
    html: renderBoardgameEmailHtml(
      <div style={containerStyle}>
        <h2>{input.heading}</h2>
        <p>
          {greeting} {input.body}
        </p>
        <p>
          <a href={url} style={buttonStyle}>
            {input.button}
          </a>
        </p>
        <p style={mutedStyle}>{input.note}</p>
      </div>
    ),
    text: [`${greeting} ${input.body}`, input.note, url].join("\n\n"),
    tags: [input.tag],
  };
}

/** Tells the member that the payment was confirmed and the membership runs. */
export function buildMembershipActivatedEmail(
  details: MembershipEmailDetails
): EmailMessage {
  const { locale } = details;
  return membershipEmail({
    details,
    subject: m["membership.email.activated.subject"](undefined, { locale }),
    heading: m["membership.email.activated.heading"](undefined, { locale }),
    body: m["membership.email.activated.body"](
      {
        plan: details.planName,
        from: formatDay(details.startsAt, locale),
        to: formatDay(details.endsAt, locale),
      },
      { locale }
    ),
    note: m["membership.email.activated.note"](undefined, { locale }),
    button: m["membership.email.accountButton"](undefined, { locale }),
    tag: "membership-activated",
  });
}

/** Reminds the member that the membership ends soon and how to renew it. */
export function buildMembershipExpiringEmail(
  details: MembershipEmailDetails
): EmailMessage {
  const { locale } = details;
  return membershipEmail({
    details,
    subject: m["membership.email.expiring.subject"](undefined, { locale }),
    heading: m["membership.email.expiring.heading"](undefined, { locale }),
    body: m["membership.email.expiring.body"](
      { plan: details.planName, to: formatDay(details.endsAt, locale) },
      { locale }
    ),
    note: m["membership.email.expiring.note"](undefined, { locale }),
    button: m["membership.email.expiring.button"](undefined, { locale }),
    tag: "membership-expiring",
  });
}
