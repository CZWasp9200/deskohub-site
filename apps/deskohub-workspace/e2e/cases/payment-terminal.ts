import { Effect } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  openPage,
  readPageUrl,
  waitForPageCondition,
  waitForPageText,
} from "../browser";
import type {
  E2EBrowserSession,
  OpenE2EBrowserSession,
} from "../browser-session";
import type { WorkspaceE2EStepRunner } from "../case-runner";
import {
  prepareCheckoutPaymentAttempt,
  submitPaymentAndWaitForHostedPage,
} from "../checkout/payment";
import {
  retryPaymentInPlace,
  retryPaymentSelector,
} from "../checkout/payment-retry";
import { capturePaymentRetryReview } from "../checkout/payment-retry-review";
import type { ReservationFormPreparation } from "../checkout/reservation-form-preparation";
import type { WorkspaceE2EConfig } from "../config";
import { WorkspaceE2EHostedPaymentPermitService } from "../coordination/hosted-payment-permit.service";
import { tryWorkspaceE2ESync, type WorkspaceE2EError } from "../errors";
import {
  assertPaymentTerminalRow,
  markPaymentTerminalForE2E,
  readCheckoutRow,
  requireProviderSessionRowAfterRedirect,
} from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import { pollUntil } from "../polling";
import { assert, log, parseUrl } from "../runtime";
import {
  type WorkspaceE2ETimeouts,
  workspaceE2EPollInitialIntervalMs,
  workspaceE2EPollIntervalMs,
} from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  CheckoutRow,
  PaymentTerminalScenario,
} from "../types";
import { makeUrl, setSearchParams } from "../urls";
import { completeHostedCheckoutPayment } from "./checkout";

export const getPaymentTerminalScenarios =
  (): readonly PaymentTerminalScenario[] => [
    {
      failureCode: "nexi_payment_failed",
      id: "payment-authentication-failed",
      providerStatus: "THREEDS_FAILED",
      state: "failed",
      titlePattern: /Payment was not completed\./i,
      trigger: "hosted_authentication_failure",
    },
    {
      failureCode: "workspace_e2e_nexi_cancelled",
      id: "payment-cancelled",
      providerStatus: "CANCELLED",
      state: "cancelled",
      titlePattern: /Payment was cancelled\./i,
      trigger: "injected",
    },
  ];

export const assertPaymentTerminalPath = ({
  config,
  data,
  runStep,
  scenario,
  openSession,
  state,
  preparation,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  runStep: WorkspaceE2EStepRunner;
  scenario: PaymentTerminalScenario;
  openSession: OpenE2EBrowserSession;
  state: CheckoutFlowState;
  preparation: ReservationFormPreparation;
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  E2EDatabase | WorkspaceE2EHostedPaymentPermitService
> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    const orderId = yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* openSession;
        return yield* prepareCheckoutPaymentAttempt({
          config,
          data,
          onOrderId: (startedOrderId) => {
            state.orderId = startedOrderId;
          },
          preparation,
          session: browser,
        });
      }),
      id: "prepare-checkout-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    if (scenario.trigger === "hosted_authentication_failure") {
      // The hosted-payment permit ends once Nexi returns to checkout status.
      yield* completeHostedCheckoutPayment({
        challengeOutcome: "failed",
        config,
        data,
        orderId,
        runStep,
        openSession,
        state,
      });
      // The status page reconciles the order with Nexi; no webhook replay.
      yield* runStep({
        execute: Effect.flatMap(openSession, (browser) =>
          assertReturnedTerminalStatusPage({
            orderId,
            scenario,
            session: browser,
            timeouts: config.timeouts,
          })
        ),
        id: `assert-${scenario.state}-status-page`,
        timeoutMs: config.timeouts.uiTransition,
      });
      yield* runStep({
        execute: validateReconciledTerminalRow({ orderId, scenario, state }),
        id: `validate-${scenario.state}-payment-state`,
        timeoutMs: config.timeouts.datasource,
      });
    } else {
      yield* injectPaymentTerminalState({
        config,
        orderId,
        runStep,
        scenario,
        openSession,
        state,
      });
      yield* runStep({
        execute: Effect.flatMap(openSession, (browser) =>
          assertTerminalStatusPage({
            config,
            orderId,
            scenario,
            session: browser,
          })
        ),
        id: `assert-${scenario.state}-status-page`,
        timeoutMs: config.timeouts.uiTransition,
      });
    }
    // The failed payment's case captures the retry for review; the
    // cancelled one would only overwrite it.
    const captureReview =
      scenario.trigger === "hosted_authentication_failure"
        ? capturePaymentRetryReview
        : () => Effect.void;
    yield* runStep({
      execute: Effect.flatMap(openSession, (browser) =>
        captureReview({
          orderId,
          session: browser,
          target: "checkout-status-payment-retry",
        }).pipe(
          Effect.andThen(
            retryPaymentInPlace({
              label: `${scenario.state} payment`,
              orderId,
              session: browser,
              timeouts: config.timeouts,
            })
          ),
          Effect.andThen(
            captureReview({
              orderId,
              session: browser,
              target: "checkout-pay-retry",
            })
          )
        )
      ),
      id: "retry-payment-in-place",
      timeoutMs: config.timeouts.uiTransition,
    });
    if (scenario.trigger === "hosted_authentication_failure") {
      // The same order, paid on the Nexi sandbox after its failed payment.
      const failedAttemptId = state.checkoutRow?.payment_attempt_id ?? null;
      yield* completeHostedCheckoutPayment({
        config,
        data,
        orderId,
        runStep,
        openSession,
        state,
      });
      // The status page reconciles the order with Nexi; no webhook replay.
      state.checkoutRow = yield* runStep({
        execute: waitForRetriedPayment({
          failedAttemptId,
          orderId,
          timeouts: config.timeouts,
        }),
        id: "validate-retried-payment",
        timeoutMs: config.timeouts.providerTransition,
      });
    }

    log(`Payment ${scenario.state} status e2e passed for order ${orderId}`);
  });

const injectPaymentTerminalState = ({
  config,
  orderId,
  runStep,
  scenario,
  openSession,
  state,
}: {
  config: WorkspaceE2EConfig;
  orderId: WorkspaceReservationId;
  runStep: WorkspaceE2EStepRunner;
  scenario: PaymentTerminalScenario;
  openSession: OpenE2EBrowserSession;
  state: CheckoutFlowState;
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  E2EDatabase | WorkspaceE2EHostedPaymentPermitService
> =>
  Effect.gen(function* () {
    const hostedPaymentPermit = yield* WorkspaceE2EHostedPaymentPermitService;
    // The hosted session ends once the attempt reaches its terminal state.
    yield* hostedPaymentPermit.withPermit(
      "hosted payment terminal state",
      Effect.gen(function* () {
        yield* runStep({
          execute: Effect.gen(function* () {
            const browser = yield* openSession;
            const { checkoutPage } = yield* submitPaymentAndWaitForHostedPage({
              session: browser,
              timeouts: config.timeouts,
            });
            yield* browser.activate(checkoutPage);
          }),
          id: "start-hosted-payment",
          timeoutMs: config.timeouts.providerTransition,
        });
        log(`Started hosted payment attempt for order ${orderId}`);
        yield* runStep({
          execute: preparePaymentTerminalState({
            orderId,
            scenario,
            state,
            timeoutMs: config.timeouts.browserAction,
          }),
          id: `prepare-${scenario.state}-payment-state`,
          timeoutMs: config.timeouts.datasource,
        });
      })
    );
  });

const preparePaymentTerminalState = ({
  orderId,
  scenario,
  state,
  timeoutMs,
}: {
  orderId: WorkspaceReservationId;
  scenario: PaymentTerminalScenario;
  state: CheckoutFlowState;
  timeoutMs: number;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const providerSessionRow = yield* requireProviderSessionRowAfterRedirect(
      orderId,
      {
        onRow: (row) => {
          state.checkoutRow = row;
        },
        timeoutMs,
      }
    );
    state.checkoutRow = providerSessionRow;
    const checkoutRow = yield* markPaymentTerminalForE2E(
      orderId,
      providerSessionRow.payment_attempt_id,
      scenario
    );
    state.checkoutRow = checkoutRow;
    yield* assertPaymentTerminalRow(checkoutRow, scenario);
  });

/** Waits until a newer attempt than the failed one paid the same order. */
const waitForRetriedPayment = ({
  failedAttemptId,
  orderId,
  timeouts,
}: {
  failedAttemptId: string | null;
  orderId: WorkspaceReservationId;
  timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<CheckoutRow, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const row = yield* pollUntil(
      readCheckoutRow(orderId).pipe(
        Effect.map((value) =>
          value?.payment_state === "paid" ? value : undefined
        )
      ),
      {
        initialIntervalMs: workspaceE2EPollInitialIntervalMs.database,
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: "the retried order paid",
        timeoutMs: timeouts.providerTransition,
      }
    );
    yield* tryWorkspaceE2ESync("validate retried payment", () =>
      assert(
        row.payment_attempt_id !== null &&
          row.payment_attempt_id !== failedAttemptId,
        "the retried payment reused the failed attempt"
      )
    );
    return row;
  });

export const assertTerminalStatusPage = ({
  config,
  orderId,
  scenario,
  session,
}: {
  config: Pick<WorkspaceE2EConfig, "baseUrl" | "bypassSecret" | "timeouts">;
  orderId: WorkspaceReservationId;
  scenario: PaymentTerminalScenario;
  session: E2EBrowserSession;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const url = yield* makeUrl(
      "build payment terminal checkout status URL",
      `${config.baseUrl}/en-US/reservation/status/${orderId}`
    );
    yield* setSearchParams(url, { e2eAt: String(Date.now()) });

    yield* openPage(session, config, url.toString(), { timeoutMs: 60_000 });
    yield* waitForPageText({
      description: `${scenario.state} checkout status copy`,
      matches: (text) => scenario.titlePattern.test(text),
      session,
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* waitForRetryPaymentControl(session, scenario, config.timeouts);

    log(`Checkout ${scenario.state} status page validated`);
  });

const waitForRetryPaymentControl = (
  session: E2EBrowserSession,
  scenario: PaymentTerminalScenario,
  timeouts: WorkspaceE2ETimeouts
) =>
  waitForPageCondition(
    session,
    `${scenario.state} checkout status offers paying the order again`,
    (selector) => document.querySelector(selector) !== null,
    retryPaymentSelector,
    { timeoutMs: timeouts.uiTransition }
  );

const isOrderStatusUrl = (value: string, orderId: WorkspaceReservationId) =>
  parseUrl(value)?.pathname.endsWith(`/reservation/status/${orderId}`) === true;

// The customer stays on the status page Nexi returned to; it refreshes while
// the payment is pending and reconciles the order with Nexi.
export const assertReturnedTerminalStatusPage = ({
  orderId,
  scenario,
  session,
  timeouts,
}: {
  orderId: WorkspaceReservationId;
  scenario: PaymentTerminalScenario;
  session: E2EBrowserSession;
  timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const url = yield* readPageUrl(session);
    yield* tryWorkspaceE2ESync("assert returned checkout status order", () =>
      assert(
        url && isOrderStatusUrl(url, orderId),
        "Nexi returned to a different checkout status page"
      )
    );
    yield* waitForPageText({
      description: `${scenario.state} checkout status copy after the Nexi return`,
      matches: (text) => scenario.titlePattern.test(text),
      session,
      timeoutMs: timeouts.uiTransition,
    });
    yield* waitForRetryPaymentControl(session, scenario, timeouts);

    log(
      `Checkout ${scenario.state} status page validated after the Nexi return`
    );
  });

const validateReconciledTerminalRow = ({
  orderId,
  scenario,
  state,
}: {
  orderId: WorkspaceReservationId;
  scenario: PaymentTerminalScenario;
  state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const row = yield* readCheckoutRow(orderId);
    const checkoutRow = yield* tryWorkspaceE2ESync(
      "read reconciled terminal checkout row",
      () => {
        assert(row, "checkout row missing after the Nexi return");
        return row;
      }
    );
    state.checkoutRow = checkoutRow;
    yield* assertPaymentTerminalRow(checkoutRow, scenario);
  });
