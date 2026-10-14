import { expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import type { WorkspaceE2EConfig } from "../config";
import { makeWorkspaceE2EHostedPaymentPermitRecorder } from "../coordination/hosted-payment-permit.service.mock";
import { workspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2EStepRunner,
} from "../types";
import { assertPaymentTerminalPath } from "./payment-terminal";

test("holds the hosted-payment permit from submission through the terminal state", async () => {
  const hostedPaymentPermit = makeWorkspaceE2EHostedPaymentPermitRecorder();
  const observedSteps: Array<{
    readonly capacity: "provider-verification" | undefined;
    readonly hosted: boolean;
    readonly id: string;
  }> = [];
  const orderId = "019f7082-1bec-7ab4-8fcd-2f0fdfd9dd71";
  const stop = workspaceE2EError("stop after the terminal status page");
  const runStep = ((step) => {
    observedSteps.push({
      capacity: step.capacity,
      hosted: hostedPaymentPermit.isHolding(),
      id: step.id,
    });
    if (step.id === "prepare-checkout-pay-page") return Effect.succeed(orderId);
    return step.id === "assert-failed-status-page"
      ? Effect.fail(stop)
      : Effect.void;
  }) as WorkspaceE2EStepRunner;
  const data = {} as CheckoutData;
  const state: CheckoutFlowState = { data };

  const exit = await Effect.runPromiseExit(
    assertPaymentTerminalPath({
      config: { timeouts: workspaceE2ETimeouts } as WorkspaceE2EConfig,
      data,
      reservationPath: "/en-US/reservation/cowork",
      run: (() =>
        Promise.reject(new Error("runner must not execute"))) as Runner,
      runStep,
      scenario: {
        providerStatus: "DECLINED",
        state: "failed",
        titlePattern: /failed/,
      },
      session: "payment-terminal-capacity",
      state,
      submitReservationScript: "unused",
    }).pipe(Effect.provide(hostedPaymentPermit.layer)) as Effect.Effect<
      void,
      typeof stop
    >
  );

  expect(Exit.isFailure(exit)).toBe(true);
  expect(observedSteps).toEqual([
    { capacity: undefined, hosted: false, id: "prepare-checkout-pay-page" },
    { capacity: undefined, hosted: true, id: "start-hosted-payment" },
    { capacity: undefined, hosted: true, id: "prepare-failed-payment-state" },
    { capacity: undefined, hosted: false, id: "assert-failed-status-page" },
  ]);
  expect(hostedPaymentPermit.isHolding()).toBe(false);
  expect(state.orderId).toBe(orderId);
});
