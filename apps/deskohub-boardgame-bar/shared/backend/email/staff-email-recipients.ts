import {
  type EmailRecipient,
  internalRecipientForOrigin,
} from "@deskohub/email";

const testStaffEmailAddress = "delivered+boardgame-staff@resend.dev";

/** Staff copy of mail triggered by the customer or submitter at `originEmail`. */
export const staffEmailRecipientFor = (
  originEmail: string,
  mailbox: EmailRecipient
): EmailRecipient =>
  internalRecipientForOrigin(originEmail, {
    real: mailbox,
    test: { email: testStaffEmailAddress, name: mailbox.name },
  });
