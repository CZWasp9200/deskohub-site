import { Effect } from "effect";
import { Link, Section, Text } from "react-email";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
  WorkspaceEmailNote,
} from "@/emails/_components/workspace-email-content";
import {
  WorkspaceEmailLayout,
  type WorkspaceEmailLocale,
} from "@/emails/_components/workspace-email-layout";
import { m } from "@/features/i18n";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import type { MagicLinkDeliveryRequest } from "./send-magic-link-email";

export type MagicLinkEmailProps = {
  readonly locale: WorkspaceEmailLocale;
  readonly url: string;
  readonly signInCode?: string;
};

// Grouped 3 + 3 so the code is easy to read back and copy.
const formatSignInCode = (code: string) =>
  `${code.slice(0, 3)} ${code.slice(3)}`;

/**
 * Account-owned magic-link renderer. The bearer URL is embedded only in the
 * rendered body and must never reach logs, traces, or error messages.
 */
function MagicLinkEmail({ locale, url, signInCode }: MagicLinkEmailProps) {
  return (
    <WorkspaceEmailLayout
      locale={locale}
      preview={m.accountMagicLinkEmailHeading({}, { locale })}
    >
      <WorkspaceEmailHeading>
        {m.accountMagicLinkEmailHeading({}, { locale })}
      </WorkspaceEmailHeading>
      <WorkspaceEmailBody>
        {m.accountMagicLinkEmailBody({}, { locale })}
      </WorkspaceEmailBody>
      <Section className="mt-6 text-center">
        <Link
          className="inline-block rounded-full bg-aquamarine px-7 py-3 text-[14px] font-bold leading-[20px] text-navy no-underline"
          href={url}
          rel="noopener"
          style={{ backgroundColor: "#00df99", color: "#00024f" }}
          target="_blank"
        >
          {m.accountMagicLinkEmailButton({}, { locale })}
        </Link>
      </Section>
      {signInCode !== undefined && (
        <Section className="mt-7 rounded-2xl bg-cream px-5 py-5 text-center">
          <Text className="m-0 text-[14px] leading-[22px] text-[#373a59]">
            {m.accountMagicLinkEmailCodeIntro({}, { locale })}
          </Text>
          <Text
            className="m-0 mt-2 text-[32px] font-bold leading-[40px] tracking-[6px] text-navy"
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
            }}
          >
            {formatSignInCode(signInCode)}
          </Text>
          <Text className="m-0 mt-2 text-[13px] leading-[20px] text-[#565975]">
            {m.accountMagicLinkEmailCodeExpiry({}, { locale })}
          </Text>
        </Section>
      )}
      <WorkspaceEmailNote>
        {m.accountMagicLinkEmailNote({}, { locale })}
      </WorkspaceEmailNote>
    </WorkspaceEmailLayout>
  );
}

export const renderMagicLinkEmail = (request: MagicLinkDeliveryRequest) =>
  Effect.map(
    renderWorkspaceEmail(
      MagicLinkEmail({
        locale: request.locale,
        url: request.url,
        signInCode: request.signInCode,
      })
    ),
    (rendered) => ({
      subject: m.accountMagicLinkEmailSubject({}, { locale: request.locale }),
      ...rendered,
    })
  );
