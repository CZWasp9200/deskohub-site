import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium } from "@playwright/test";
import { Effect } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { waitForBrowserReactFormSubmit } from "./browser";
import type { Runner } from "./runtime";

// happy-dom reports client rects for display:none elements and an empty
// computed visibility, so the readiness script runs in real Chromium.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

const formSelector = `[data-testid='contact "form"']`;
const readyAttribute = { name: "data-ready", value: `it's "ready"` } as const;

const readinessScript = async (
  visibleFieldSelectors: readonly string[],
  options: Parameters<typeof waitForBrowserReactFormSubmit>[4] = {}
) => {
  let script: string | undefined;
  const run: Runner = async (_command, args) => {
    script = args.at(4);
    return { exitCode: 0, stderr: "", stdout: "" };
  };
  await Effect.runPromise(
    waitForBrowserReactFormSubmit(
      run,
      "browser-test",
      formSelector,
      visibleFieldSelectors,
      options
    )
  );
  if (script === undefined)
    throw new Error("The readiness script was not passed to the runner.");
  return script;
};

const contactForm = (fields: string, readyValue = readyAttribute.value) =>
  `<form data-testid='contact "form"' data-ready='${readyValue.replaceAll("'", "&#39;")}'>${fields}</form>`;

const wiredFields = `
  <input id="email" name="email" />
  <textarea id="message" name="message"></textarea>
  <input id="token" name="token" type="hidden" />
`;

/** Handler names to attach as fake React props, keyed by element selector. */
type ReactHandlers = Readonly<Record<string, readonly string[]>>;

const evaluateReadiness = async (
  html: string,
  handlers: ReactHandlers,
  script: string
) => {
  if (!browser) throw new Error("The readiness browser has not been launched.");
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<!doctype html><html lang="en"><body>${html}</body></html>`
    );
    await page.evaluate((handlersBySelector) => {
      for (const [selector, names] of Object.entries(handlersBySelector)) {
        const element = document.querySelector(selector);
        if (element === null) throw new Error(`Missing ${selector}`);
        Object.assign(element, {
          __reactProps$test: Object.fromEntries(
            names.map((name) => [name, () => undefined])
          ),
        });
      }
    }, handlers);
    return await page.evaluate(script);
  } finally {
    await page.close();
  }
};

const wiredHandlers: ReactHandlers = {
  [formSelector]: ["onSubmit"],
  "#email": ["onChange"],
  "#message": ["onChange"],
};
const wiredFieldSelectors = ["#email", "#message", "#token"];

test.skipIf(!chromiumAvailable)(
  "reports a hydrated form with visible handled fields as ready",
  async () => {
    const script = await readinessScript(wiredFieldSelectors, {
      requiredReadyAttribute: readyAttribute,
    });

    expect(
      await evaluateReadiness(contactForm(wiredFields), wiredHandlers, script)
    ).toBe(true);
  }
);

test.skipIf(!chromiumAvailable)(
  "waits for the form's React submit handler",
  async () => {
    const script = await readinessScript(wiredFieldSelectors);

    expect(
      await evaluateReadiness(
        contactForm(wiredFields),
        { ...wiredHandlers, [formSelector]: ["onChange"] },
        script
      )
    ).toBe(false);
  }
);

test.skipIf(!chromiumAvailable)(
  "waits for the required ready attribute value",
  async () => {
    const script = await readinessScript(wiredFieldSelectors, {
      requiredReadyAttribute: readyAttribute,
    });

    expect(
      await evaluateReadiness(
        contactForm(wiredFields, "loading"),
        wiredHandlers,
        script
      )
    ).toBe(false);
  }
);

test.skipIf(!chromiumAvailable)(
  "waits for every field to exist inside the form",
  async () => {
    const script = await readinessScript([...wiredFieldSelectors, "#outside"]);
    const outsideHandlers = { ...wiredHandlers, "#outside": ["onChange"] };

    expect(
      await evaluateReadiness(
        `${contactForm(wiredFields)}<input id="outside" />`,
        outsideHandlers,
        script
      )
    ).toBe(false);
    expect(
      await evaluateReadiness(contactForm(wiredFields), wiredHandlers, script)
    ).toBe(false);
  }
);

test.skipIf(!chromiumAvailable)(
  "waits for visible fields to render and receive change handlers",
  async () => {
    const script = await readinessScript(["#email"]);
    const emailHandlers = {
      [formSelector]: ["onSubmit"],
      "#email": ["onChange"],
    };

    expect(
      await evaluateReadiness(
        contactForm('<input id="email" />'),
        { [formSelector]: ["onSubmit"] },
        script
      )
    ).toBe(false);
    for (const style of ["display: none", "visibility: hidden"])
      expect(
        await evaluateReadiness(
          contactForm(`<input id="email" style="${style}" />`),
          emailHandlers,
          script
        )
      ).toBe(false);
  }
);

test.skipIf(!chromiumAvailable)(
  "does not treat an empty field list as ready",
  async () => {
    const script = await readinessScript([]);

    expect(
      await evaluateReadiness(contactForm(wiredFields), wiredHandlers, script)
    ).toBe(false);
  }
);
