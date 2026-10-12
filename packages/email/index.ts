export type { EmailProvider } from "./backend/capabilities";
export {
  type EmailTestDomain,
  EmailTestDomainSchema,
  makeEmailConfigLayer,
} from "./backend/email-config";
export {
  internalRecipientForOrigin,
  staffEmailSubject,
} from "./backend/email-routing";
export { NetworkError } from "./backend/network-error";
export {
  ConsoleEmailProviderLive,
  isConsoleEmailDeliveryId,
} from "./backend/providers/console-provider";
export { ResendEmailProviderLive } from "./backend/providers/resend-provider";
export {
  EmailConfigTag,
  EmailDeliveryUnconfiguredError,
  EmailProviderTag,
  type EmailSendError,
  EmailServiceError,
  EmailServiceTag,
  EmailTemplateServiceTag,
} from "./backend/service";
export type {
  EmailAttachment,
  EmailConfig,
  EmailDeliveryId,
  EmailMessage,
  EmailRecipient,
  EmailSendResult,
  EmailTemplateData,
  EmailTemplateType,
  ReservationConfirmationData,
} from "./types/email.types";
export { EmailDeliveryIdSchema } from "./types/email.types";
