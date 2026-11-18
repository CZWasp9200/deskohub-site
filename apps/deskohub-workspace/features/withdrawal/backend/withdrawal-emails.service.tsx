import {
  EmailConfigTag,
  type EmailSendError,
  type EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type { EmailMessage } from "@deskohub/email/types/email.types";
import { Context, Effect, Layer } from "effect";
import {
  ContractWithdrawalNoticeEmail,
  contractWithdrawalNoticeEmailSubject,
} from "@/emails/contract-withdrawal-notice";
import {
  ContractWithdrawalReceiptEmail,
  contractWithdrawalReceiptEmailSubject,
} from "@/emails/contract-withdrawal-receipt";
import { env } from "@/env";
import { WorkspaceEmailLayer } from "@/shared/backend/config/email.config";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import {
  internalWorkspaceEmailRecipientFor,
  internalWorkspaceEmailSubject,
  workspaceEmailRecipient,
} from "@/shared/backend/email/workspace-email-recipients";
import type { ContractWithdrawal } from "./withdrawal.repository";

type WithdrawalEmailError = EmailSendError | EmailServiceError;

interface IWithdrawalEmails {
  /** Sends the customer the receipt of their withdrawal statement. */
  readonly sendReceipt: (input: {
    readonly withdrawal: ContractWithdrawal;
    readonly receiptEmail: string;
    readonly customerName: string | null;
  }) => Effect.Effect<void, WithdrawalEmailError>;
  /** Tells staff about the withdrawal; `customerEmail` picks the test inbox in tests. */
  readonly sendOperatorNotice: (input: {
    readonly withdrawal: ContractWithdrawal;
    readonly customerEmail: string;
  }) => Effect.Effect<void, WithdrawalEmailError>;
}

/** The emails a withdrawal sends: the customer's receipt and the staff notice. */
export class WithdrawalEmails extends Context.Service<
  WithdrawalEmails,
  IWithdrawalEmails
>()("@deskohub-workspace/withdrawal/WithdrawalEmails") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const emailService = yield* EmailServiceTag;
      const emailConfig = yield* EmailConfigTag;

      const metadataOf = (withdrawal: ContractWithdrawal) => ({
        deploymentEnvironment: env.VERCEL_ENV,
        source: "workspace-contract-withdrawal",
        withdrawalId: withdrawal.id,
        contractKind: withdrawal.contract.kind,
        contractId: withdrawal.contract.id,
      });

      return {
        sendReceipt: Effect.fn("WithdrawalEmails.sendReceipt")(function* ({
          withdrawal,
          receiptEmail,
          customerName,
        }) {
          const props = {
            locale: withdrawal.locale,
            reference: withdrawal.contract.id,
            customerName,
            receiptEmail,
            contractLabel: withdrawal.contractLabel,
            submittedAt: withdrawal.submittedAt,
            paidAmount: withdrawal.paidAmount,
            refundAmount: withdrawal.refundAmount,
            refundBasis: withdrawal.refundBasis,
          };
          const rendered = yield* renderWorkspaceEmail(
            <ContractWithdrawalReceiptEmail {...props} />
          );
          const message: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: { email: receiptEmail },
            replyTo: workspaceEmailRecipient,
            subject: contractWithdrawalReceiptEmailSubject(props),
            html: rendered.html,
            text: rendered.text,
            tags: ["workspace-withdrawal-receipt"],
            metadata: metadataOf(withdrawal),
          };
          yield* emailService.send(message).pipe(Effect.asVoid);
        }),
        sendOperatorNotice: Effect.fn("WithdrawalEmails.sendOperatorNotice")(
          function* ({ withdrawal, customerEmail }) {
            const props = {
              contractLabel: withdrawal.contractLabel,
              contractId: withdrawal.contract.id,
              accountId: withdrawal.accountId,
              submittedAt: withdrawal.submittedAt,
              paidAmount: withdrawal.paidAmount,
              refundAmount: withdrawal.refundAmount,
            };
            const rendered = yield* renderWorkspaceEmail(
              <ContractWithdrawalNoticeEmail {...props} />
            );
            const message: EmailMessage = {
              from: emailConfig.defaultFrom,
              to: internalWorkspaceEmailRecipientFor(customerEmail),
              subject: internalWorkspaceEmailSubject(
                contractWithdrawalNoticeEmailSubject(props)
              ),
              html: rendered.html,
              text: rendered.text,
              tags: ["workspace-withdrawal-notice"],
              metadata: metadataOf(withdrawal),
            };
            yield* emailService.send(message).pipe(Effect.asVoid);
          }
        ),
      } satisfies IWithdrawalEmails;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceEmailLayer));
}
