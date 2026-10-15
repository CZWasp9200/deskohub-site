import type { ReactNode } from "react";
import { Link, Text } from "react-email";
import {
  WorkspaceEmailLayout,
  type WorkspaceEmailLocale,
} from "./_components/workspace-email-layout";
import { workspaceCampaignPreviewProps } from "./_fixtures/preview-props";

export type WorkspaceCampaignEmailProps = {
  readonly locale: WorkspaceEmailLocale;
  readonly preview: string;
  readonly body: ReactNode;
  readonly footer: {
    readonly note: string;
    readonly link?: { readonly label: string; readonly href: string };
  };
};

export function WorkspaceCampaignEmail({
  locale,
  preview,
  body,
  footer,
}: WorkspaceCampaignEmailProps) {
  return (
    <WorkspaceEmailLayout
      footer={
        <Text className="m-0 px-5 pt-2 text-center text-[12px] leading-[18px] text-[#666983]">
          {footer.note}
          {footer.link && (
            <>
              {" "}
              <Link
                className="text-[#666983] underline"
                href={footer.link.href}
              >
                {footer.link.label}
              </Link>
            </>
          )}
        </Text>
      }
      locale={locale}
      preview={preview}
    >
      {body}
    </WorkspaceEmailLayout>
  );
}

WorkspaceCampaignEmail.PreviewProps = workspaceCampaignPreviewProps;

export default WorkspaceCampaignEmail;
