import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Page } from "@playwright/test";
import { m } from "@/features/i18n";
import {
  identifierNames,
  parseTrackedSource,
} from "../scripts/shared/source-ast";
import {
  dismissLegalCookieConsent,
  hasReactClickHandler,
} from "./legal-cookie-consent";

const locale = "en-US" as const;
const analyticsCheckboxSelector = "#cookie-category-analytics";
const necessaryOnlyLabel = m.cookieConsentConsentModalAcceptNecessaryBtn(
  {},
  { locale }
);

type FakeLocator = {
  readonly _apiName: string;
  readonly _expect: (
    expression: string,
    options: Record<string, unknown>
  ) => Promise<{
    readonly matches: boolean;
    readonly received: { readonly value: boolean };
  }>;
  readonly click: (options?: { readonly timeout?: number }) => Promise<void>;
  readonly isVisible: () => Promise<boolean>;
};

type FakeConsentPage = {
  readonly clickCount: () => number;
  readonly evaluateArguments: readonly string[];
  readonly page: Page;
};

const makeFakeConsentPage = (input: {
  readonly analyticsVisible: boolean;
  readonly hydrationResults: readonly boolean[];
  readonly necessaryVisible: boolean;
}): FakeConsentPage => {
  let necessaryVisible = input.necessaryVisible;
  let evaluateIndex = 0;
  let clickCount = 0;
  const evaluateArguments: string[] = [];
  const getNecessaryVisibility = () => necessaryVisible;
  const getAnalyticsVisibility = () => input.analyticsVisible;

  const makeLocator = (isVisible: () => boolean): FakeLocator => ({
    _apiName: "Locator",
    _expect: async (expression) => {
      if (expression !== "to.be.hidden")
        throw new Error(`unexpected fake locator assertion: ${expression}`);
      const visible = isVisible();
      return {
        matches: !visible,
        received: { value: !visible },
      };
    },
    click: async () => {
      if (!isVisible()) throw new Error("fake cookie consent target is hidden");
      clickCount += 1;
      necessaryVisible = false;
    },
    isVisible: async () => isVisible(),
  });

  const necessaryOnlyButton = makeLocator(getNecessaryVisibility);
  const analyticsCheckbox = makeLocator(getAnalyticsVisibility);
  const page = Object.assign({} as Page, {
    evaluate: async (_pageFunction: unknown, selector: string) => {
      evaluateArguments.push(selector);
      const result =
        input.hydrationResults[
          Math.min(evaluateIndex, input.hydrationResults.length - 1)
        ];
      evaluateIndex += 1;
      return result ?? false;
    },
    getByRole: (_role: string, options: { readonly name?: string }) => {
      if (options.name !== necessaryOnlyLabel)
        throw new Error("fake cookie consent helper used the wrong locale");
      return necessaryOnlyButton;
    },
    locator: (selector: string) => {
      if (selector !== analyticsCheckboxSelector)
        throw new Error(`unexpected fake cookie consent selector: ${selector}`);
      return analyticsCheckbox;
    },
  });

  return {
    clickCount: () => clickCount,
    evaluateArguments,
    page,
  };
};

test("clicks only the visible necessary-cookie action when the banner is present", async () => {
  const fake = makeFakeConsentPage({
    analyticsVisible: false,
    hydrationResults: [false],
    necessaryVisible: true,
  });

  await dismissLegalCookieConsent(fake.page, locale);

  expect(fake.clickCount()).toBe(1);
  expect(fake.evaluateArguments).toEqual([]);
});

test("waits for an inline analytics control when the consent banner is absent", async () => {
  const fake = makeFakeConsentPage({
    analyticsVisible: true,
    hydrationResults: [true],
    necessaryVisible: false,
  });

  await dismissLegalCookieConsent(fake.page, locale);

  expect(fake.clickCount()).toBe(0);
  expect(fake.evaluateArguments).toEqual([analyticsCheckboxSelector]);
});

test("does not race a visible but unhydrated inline analytics control", async () => {
  const fake = makeFakeConsentPage({
    analyticsVisible: true,
    hydrationResults: [false, true],
    necessaryVisible: false,
  });

  await dismissLegalCookieConsent(fake.page, locale);

  expect(fake.clickCount()).toBe(0);
  expect(fake.evaluateArguments).toEqual([
    analyticsCheckboxSelector,
    analyticsCheckboxSelector,
  ]);
});

test("detects the hydrated React click handler on the consent control", async () => {
  GlobalRegistrator.register({ url: "https://workspace.example.test/" });
  try {
    document.body.innerHTML = `<input id="cookie-category-analytics" type="checkbox" />`;
    const checkbox = document.querySelector(analyticsCheckboxSelector)!;

    expect(hasReactClickHandler(analyticsCheckboxSelector)).toBe(false);
    // React stores the current props on the element under a random suffix.
    const reactProps = { onChange: (): void => undefined } as {
      onChange: () => void;
      onClick?: () => void;
    };
    Object.assign(checkbox, { __reactProps$test: reactProps });
    expect(hasReactClickHandler(analyticsCheckboxSelector)).toBe(false);
    reactProps.onClick = () => undefined;
    expect(hasReactClickHandler(analyticsCheckboxSelector)).toBe(true);
    expect(hasReactClickHandler("#missing")).toBe(false);
  } finally {
    await GlobalRegistrator.unregister();
  }
});

test("does not forge consent cookies or use timer delays", () => {
  // Verdicts come from the parsed consent helper, so a commented-out cookie
  // write or timer call can never satisfy the absence checks.
  const { ast } = parseTrackedSource(
    fileURLToPath(new URL("./legal-cookie-consent.ts", import.meta.url))
  );
  const identifiers = identifierNames(ast);
  for (const forbidden of [
    "addCookies",
    "cookie",
    "CookieConsent",
    "acceptCategory",
    "setTimeout",
    "waitForTimeout",
  ]) {
    expect(identifiers.has(forbidden)).toBe(false);
  }
});
