import { Effect } from "effect";
import type { CanonicalPromotionCode } from "@/features/discounts/persistence-contracts";
import {
  fillBrowserField,
  focusBrowserElement,
  pressBrowserKey,
  waitForBrowserCondition,
  waitForBrowserReactFormSubmit,
  waitForBrowserTextContent,
} from "../browser";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { addRedaction } from "../runtime";

export const applyDiscountCode = ({
  appliedMessage,
  code,
  config,
  run,
  session,
}: {
  readonly appliedMessage: string;
  readonly code: string;
  readonly config: WorkspaceE2EConfig;
  readonly run: Runner;
  readonly session: string;
}) =>
  submitDiscountCode({ code, config, run, session }).pipe(
    Effect.andThen(
      waitForBrowserTextContent(run, session, appliedMessage, {
        timeoutMs: config.timeouts.uiTransition,
      })
    )
  );

export const applyUnavailableDiscountCode = ({
  code,
  config,
  run,
  session,
}: {
  readonly code: string;
  readonly config: WorkspaceE2EConfig;
  readonly run: Runner;
  readonly session: string;
}) =>
  submitDiscountCode({ code, config, run, session }).pipe(
    Effect.andThen(
      waitForBrowserTextContent(
        run,
        session,
        "That discount, voucher, or referral code isn’t available. Check it and try again, or continue with the current price.",
        { timeoutMs: config.timeouts.uiTransition }
      )
    )
  );

export const submitDiscountCode = ({
  code,
  config,
  run,
  session,
}: {
  readonly code: string;
  readonly config: WorkspaceE2EConfig;
  readonly run: Runner;
  readonly session: string;
}) =>
  Effect.gen(function* () {
    addRedaction(code, true);
    yield* waitForBrowserReactFormSubmit(
      run,
      session,
      "#checkout-discount-code-form",
      ["#checkout-discount-code"],
      { timeoutMs: config.timeouts.uiTransition }
    );
    yield* fillBrowserField(run, session, "#checkout-discount-code", code, {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* focusBrowserElement(
      run,
      session,
      '#checkout-discount-code-form button[type="submit"]',
      { timeoutMs: config.timeouts.browserAction }
    );
    yield* pressBrowserKey(run, session, "Enter", {
      timeoutMs: config.timeouts.browserAction,
    });
  });

/** The code box holds a requested code without having applied it. */
export const assertRequestedOnlyDiscountCode = ({
  code,
  config,
  run,
  session,
}: {
  readonly code: CanonicalPromotionCode;
  readonly config: WorkspaceE2EConfig;
  readonly run: Runner;
  readonly session: string;
}) =>
  waitForBrowserCondition(
    run,
    session,
    "requested-only discount code input",
    `
(() => {
  const form = document.querySelector('#checkout-discount-code-form');
  if (!(form instanceof HTMLFormElement)) return false;
  if (form.querySelector('output')) return false;
  const input = form.querySelector('#checkout-discount-code');
  return input instanceof HTMLInputElement && input.value === ${JSON.stringify(code)};
})()
`,
    { timeoutMs: config.timeouts.uiTransition }
  );
