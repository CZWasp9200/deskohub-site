import type {
  NexiCorrelationId,
  NexiOperationId,
  NexiOrderId,
  NexiWebhookEventId,
} from "@deskohub/nexi";
import type { Effect } from "effect";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { Locale } from "@/features/i18n";
import type {
  OrderFulfillmentState,
  OrderId,
  OrderPaymentState,
} from "@/features/order/order";
import type { Money } from "@/shared/money/money";
import type { PaymentAttempt } from "../repositories/payment-attempt.repository";
import type { PaymentLifecycleRepositoryError } from "../repositories/payment-lifecycle.repository";
import type {
  NonTerminalPaymentAttemptState,
  PaymentLifecycleTransition,
} from "../repositories/payment-lifecycle-state";

export interface PaymentOrder {
  readonly id: OrderId;
  readonly correlationId: NexiCorrelationId;
  readonly activePaymentAttemptId: PaymentAttemptId | null;
  readonly paymentState: OrderPaymentState;
  readonly fulfillmentState: OrderFulfillmentState;
  readonly logFields: Readonly<Record<string, string | null | undefined>>;
}

export interface PaymentAdmission<Details> {
  readonly orderId: OrderId;
  readonly amount: Money;
  readonly locale: Locale;
  readonly details: Details;
}

interface PaymentOutcome {
  readonly orderId: OrderId;
  readonly id: PaymentAttemptId;
  readonly webhookEventId?: NexiWebhookEventId;
  readonly providerOperationId?: NexiOperationId;
  readonly providerStatus?: string;
}

export interface OrderPaymentHandler {
  readonly load: (
    orderId: OrderId
  ) => Effect.Effect<PaymentOrder | null, Error>;
  readonly markPaid: (
    input: PaymentOutcome & {
      readonly paidAt: Temporal.Instant;
    }
  ) => Effect.Effect<
    PaymentLifecycleTransition,
    PaymentLifecycleRepositoryError
  >;
  readonly markTerminal: (
    input: PaymentOutcome & {
      readonly state: "failed" | "cancelled" | "expired";
      readonly failureCode: string;
      readonly fromAttemptStates?: readonly NonTerminalPaymentAttemptState[];
    }
  ) => Effect.Effect<
    PaymentLifecycleTransition,
    PaymentLifecycleRepositoryError
  >;
  readonly fulfill: (orderId: OrderId) => Effect.Effect<void, Error>;
  readonly scheduleFulfillment: (input: {
    readonly orderId: OrderId;
    readonly paymentAttemptId?: PaymentAttemptId;
  }) => Effect.Effect<void>;
  readonly resumeRecovery: (input: {
    readonly orderId: OrderId;
    readonly paymentAttemptId: PaymentAttemptId;
  }) => Effect.Effect<boolean, Error>;
  readonly startRecovery: (
    input: Omit<PaymentOutcome, "id"> & {
      readonly paymentAttemptId: PaymentAttemptId;
      readonly verifiedPaidAt: Temporal.Instant;
    }
  ) => Effect.Effect<void, Error>;
}

export interface AdmittingOrderPaymentHandler<Details>
  extends OrderPaymentHandler {
  /** Admit the attempt and freeze its accounting data in the same transaction. */
  readonly admitNexi: (
    input: PaymentAdmission<Details> & {
      readonly providerOrderId: NexiOrderId;
    }
  ) => Effect.Effect<PaymentAttempt, PaymentLifecycleRepositoryError>;
  readonly admitInternal: (
    input: PaymentAdmission<Details>
  ) => Effect.Effect<
    PaymentLifecycleTransition,
    PaymentLifecycleRepositoryError
  >;
  readonly attachProviderSession: (input: {
    readonly id: PaymentAttemptId;
    readonly securityToken: string;
    readonly providerRedirectUrl: string;
  }) => Effect.Effect<PaymentAttempt, PaymentLifecycleRepositoryError>;
}
