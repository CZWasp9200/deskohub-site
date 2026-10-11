import {
  type EmailRecipient,
  internalRecipientForOrigin,
} from "@deskohub/email";
import { workspaceSiteConstants } from "@/shared/utils";

export const workspaceEmailRecipient: EmailRecipient = {
  email: workspaceSiteConstants.contact.infoEmail,
  name: workspaceSiteConstants.brand.name,
};

const testInternalWorkspaceEmailRecipient: EmailRecipient = {
  email: "delivered+workspace-internal@resend.dev",
  name: workspaceSiteConstants.brand.name,
};

/** Staff copy of mail triggered by the customer or submitter at `originEmail`. */
export const internalWorkspaceEmailRecipientFor = (
  originEmail: string
): EmailRecipient =>
  internalRecipientForOrigin(originEmail, {
    real: workspaceEmailRecipient,
    test: testInternalWorkspaceEmailRecipient,
  });
