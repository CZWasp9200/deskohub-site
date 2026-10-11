import {
  type EmailRecipient,
  internalRecipientForOrigin,
  staffEmailSubject,
} from "@deskohub/email";
import { isProduction } from "@/shared/utils/environment";

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

/** Subject for a staff copy; tagged as test mail outside production. */
export const staffEmailSubjectFor = (subject: string): string =>
  staffEmailSubject(subject, { isProduction: isProduction() });
