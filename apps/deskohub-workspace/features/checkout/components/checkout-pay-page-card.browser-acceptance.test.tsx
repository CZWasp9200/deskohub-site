import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCoworkCheckoutSummary } from "@/features/checkout/checkout-quote.test-utils";
import { type Locale, locales } from "@/features/i18n";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import {
  CheckoutPayCard,
  CheckoutPaySubmitButton,
} from "./checkout-pay-page-card";

const appDirectory = resolve(import.meta.dir, "../../..");
// The narrowest supported phone, the widths either side of the label's
// 18rem breakpoint (a 287px and a 288px button), a common phone and a
// desktop.
const viewportWidths = [320, 369, 370, 390, 1280] as const;

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  const brandFont = await readFile(
    join(appDirectory, "assets/fonts/Sculpin/regular.woff2")
  );
  // Production text widths come from the brand font that next/font injects.
  appStyles = `@font-face { font-family: "Sculpin"; font-weight: 400; src: url(data:font/woff2;base64,${brandFont.toString("base64")}) format("woff2"); }
:root { --font-sculpin: "Sculpin"; }
${await compileWorkspaceAppStyles()}`;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

const { total } = buildCoworkCheckoutSummary({
  entryTier: "basic",
  coffee: false,
});
// A six-figure amount, such as a long office booking, lengthens the label.
const largeTotal = { ...total, value: 12_345_650, exponent: 2 };

// The pay card inside the checkout page's gutter, with every label the pay
// button shows: pay, retry, the pending state and a large amount.
const payCardMarkup = (locale: Locale) =>
  renderToStaticMarkup(
    <main className="mx-auto w-full max-w-3xl px-4 sm:px-6">
      <CheckoutPayCard title="Checkout">
        <CheckoutPaySubmitButton locale={locale} total={total} variant="pay" />
        <CheckoutPaySubmitButton
          locale={locale}
          total={total}
          variant="retry"
        />
        <CheckoutPaySubmitButton
          locale={locale}
          pending
          total={total}
          variant="retry"
        />
        <CheckoutPaySubmitButton
          locale={locale}
          total={largeTotal}
          variant="pay"
        />
      </CheckoutPayCard>
    </main>
  );

test.skipIf(!chromiumAvailable)(
  "keeps the pay button's label and icon inside the button from the narrowest phone up, in every locale",
  async () => {
    if (!browser) throw new Error("The pay card browser has not launched.");
    let sawWrappedLabel = false;
    for (const locale of locales) {
      const page = await browser.newPage();
      try {
        await page.setContent(
          `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${payCardMarkup(locale)}</body></html>`
        );
        await page.addStyleTag({ content: appStyles });
        await page.evaluate(() => document.fonts.ready);
        for (const width of viewportWidths) {
          await page.setViewportSize({ height: 900, width });

          const buttons = await page.$$eval("main button", (elements) =>
            elements.map((button) => {
              const box = button.getBoundingClientRect();
              const style = getComputedStyle(button);
              const content = {
                left: box.left + Number.parseFloat(style.paddingLeft),
                right: box.right - Number.parseFloat(style.paddingRight),
              };
              const label = document.createRange();
              const labelElement = button.querySelector(
                "[data-checkout-pay-label]"
              );
              if (!labelElement) throw new Error("Missing pay button label");
              label.selectNodeContents(labelElement);
              const labelBox = labelElement.getBoundingClientRect();
              const icon = button.querySelector("svg")?.getBoundingClientRect();
              return {
                iconWidth: icon?.width,
                iconCentered:
                  !!icon &&
                  Math.abs(
                    (icon.top + icon.bottom) / 2 -
                      (labelBox.top + labelBox.bottom) / 2
                  ) <= 0.5,
                wrapped: label.getClientRects().length > 1,
                label: label.getBoundingClientRect(),
                content,
              };
            })
          );

          expect(buttons).toHaveLength(4);
          // The pending button shows no icon.
          const [pay, retry, , largePay] = buttons;
          for (const { iconCentered, iconWidth, wrapped } of [
            pay,
            retry,
            largePay,
          ]) {
            sawWrappedLabel ||= wrapped;
            expect({ locale, width, iconCentered, iconWidth }).toEqual({
              locale,
              width,
              iconCentered: true,
              iconWidth: 16,
            });
          }
          for (const { content, label } of buttons) {
            expect({ locale, width, overflow: false }).toEqual({
              locale,
              width,
              overflow:
                label.left < content.left - 0.5 ||
                label.right > content.right + 0.5,
            });
          }
        }
      } finally {
        await page.close();
      }
    }
    expect(sawWrappedLabel).toBe(true);
  }
);
