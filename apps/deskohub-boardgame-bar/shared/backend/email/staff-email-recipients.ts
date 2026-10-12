import {
  type EmailRecipient,
  internalRecipientForOrigin,
  staffEmailSubject,
} from "@deskohub/email";
import { isProduction } from "@/shared/utils/environment";

/** Staff copy of mail triggered by the customer or submitter at `originEmail`. */
export const staffEmailRecipientFor = (
  originEmail: string,
  mailbox: EmailRecipient
): EmailRecipient =>
  internalRecipientForOrigin(originEmail, {
    real: mailbox,
    testLocalPart: "boardgame-staff",
  });

/** Subject for a staff copy; tagged as test mail outside production. */
export const staffEmailSubjectFor = (subject: string): string =>
  staffEmailSubject(subject, { isProduction: isProduction() });
