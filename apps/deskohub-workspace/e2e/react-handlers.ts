import { errors, type Locator, type Page } from "@playwright/test";

const reactClickHandlerTimeoutMs = 15_000;

type ReactClickHandlerState = "ready" | "detached" | false;

/**
 * Runs in the browser: whether React has attached an `onClick` prop to the
 * element, or the element has left the document. A server-rendered control is
 * visible before hydration, and a native click before then is silently
 * dropped. A streamed Suspense reveal can also replace a server-rendered
 * fallback control with a new node after the document `load` event; the
 * replaced node never gains React props.
 */
const reactClickHandlerState = (
  element: Element | null
): ReactClickHandlerState => {
  if (element === null || !element.isConnected) return "detached";
  const reactPropsKey = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$")
  );
  if (reactPropsKey === undefined) return false;

  const reactProps = Object.getOwnPropertyDescriptor(
    element,
    reactPropsKey
  )?.value;
  if (typeof reactProps !== "object" || reactProps === null) return false;

  return "onClick" in reactProps &&
    typeof (reactProps as { readonly onClick?: unknown }).onClick === "function"
    ? "ready"
    : false;
};

/**
 * Waits until React has hydrated the click handler of the control the locator
 * currently resolves to, resolving the locator again whenever the observed
 * node is replaced.
 */
export const waitForReactClickHandler = async (
  page: Pick<Page, "waitForFunction">,
  control: Pick<Locator, "elementHandle">
): Promise<void> => {
  const deadline = Date.now() + reactClickHandlerTimeoutMs;
  let replacements = 0;

  for (;;) {
    const element = await control.elementHandle();
    if (element === null)
      throw new Error("React click control was not rendered");

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      await element.dispose();
      throw new errors.TimeoutError(
        `React click handler wait timed out after ${replacements} control replacements`
      );
    }

    try {
      const state = await page.waitForFunction(
        reactClickHandlerState,
        element,
        { timeout: remainingMs }
      );
      try {
        if ((await state.jsonValue()) !== "detached") return;
      } finally {
        await state.dispose();
      }
    } finally {
      await element.dispose();
    }
    replacements += 1;
  }
};
