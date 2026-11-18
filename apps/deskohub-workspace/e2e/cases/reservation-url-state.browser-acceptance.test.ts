import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "@playwright/test";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  areOfficePricesReady,
  hasOfficeContactAlone,
  isSwitchChecked,
  readOfficeDisplay,
} from "./reservation-url-state";

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let page: Page | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
});

/** What the in-page `read` returns for `html` and `arg`. */
const readOn = async <Arg, A>(
  html: string,
  read: (arg: Arg) => A,
  arg: Arg
) => {
  if (!page) throw new Error("Chromium is not running");
  await page.setContent(html);
  return page.evaluate(read as (arg: unknown) => A, arg);
};

const coffee = '[data-cowork-optional-addon-toggle="coffee"] [role="switch"]';

test.skipIf(!chromiumAvailable)(
  "reads a switch's checked state only from a switch button",
  async () => {
    const switchHtml = (tag: string, checked: string) =>
      `<div data-cowork-optional-addon-toggle="coffee"><${tag} role="switch" aria-checked="${checked}"></${tag}></div>`;

    expect(
      await readOn(switchHtml("button", "true"), isSwitchChecked, {
        checked: true,
        selector: coffee,
      })
    ).toBe(true);
    expect(
      await readOn(switchHtml("button", "false"), isSwitchChecked, {
        checked: true,
        selector: coffee,
      })
    ).toBe(false);
    expect(
      await readOn(switchHtml("button", "false"), isSwitchChecked, {
        checked: false,
        selector: coffee,
      })
    ).toBe(true);
    expect(
      await readOn(switchHtml("div", "true"), isSwitchChecked, {
        checked: true,
        selector: coffee,
      })
    ).toBe(false);
  }
);

test.skipIf(!chromiumAvailable)(
  "accepts the live people list with the contact alone out of the seat capacity",
  async () => {
    const people = (count: string, extra = "") =>
      `${extra}<span data-office-people-count>${count}</span>`;

    expect(await readOn(people("1 of 3"), hasOfficeContactAlone, 3)).toBe(true);
    expect(await readOn(people("2 of 3"), hasOfficeContactAlone, 3)).toBe(
      false
    );
    expect(await readOn(people("1 of 2"), hasOfficeContactAlone, 3)).toBe(
      false
    );
    expect(
      await readOn(
        people("1 of 3", "<div data-office-people-fallback></div>"),
        hasOfficeContactAlone,
        3
      )
    ).toBe(false);
  }
);

const seatPrice = "[data-office-seats-price]";

const officePrices = ({
  basePrice = "<span>CZK  1 000</span>",
  continueAttributes = 'data-reservation-price-loading="false"',
  seatPrice: seatPriceHtml = "<span>CZK\n    500</span>",
} = {}) => `
  <div data-office-base-price>${basePrice}</div>
  <div data-office-seats-price>${seatPriceHtml}</div>
  <input name="startsOn" value="2099-09-01" />
  <button id="reservation-continue" ${continueAttributes}>Continue</button>`;

test.skipIf(!chromiumAvailable)(
  "waits for settled office access and per-person prices",
  async () => {
    expect(await readOn(officePrices(), areOfficePricesReady, seatPrice)).toBe(
      true
    );
    expect(
      await readOn(
        officePrices({ basePrice: '<span data-slot="skeleton"></span>' }),
        areOfficePricesReady,
        seatPrice
      )
    ).toBe(false);
    expect(
      await readOn(
        officePrices({ seatPrice: '<span data-slot="skeleton"></span>' }),
        areOfficePricesReady,
        seatPrice
      )
    ).toBe(false);
    expect(
      await readOn(
        officePrices({
          continueAttributes: 'data-reservation-price-loading="true"',
        }),
        areOfficePricesReady,
        seatPrice
      )
    ).toBe(false);
    expect(
      await readOn(
        officePrices({
          continueAttributes:
            'data-reservation-price-loading="false" data-reservation-price-error="true"',
        }),
        areOfficePricesReady,
        seatPrice
      )
    ).toBe(false);
  }
);

test.skipIf(!chromiumAvailable)(
  "reads the office start date and whitespace-normalized prices",
  async () => {
    expect(await readOn(officePrices(), readOfficeDisplay, seatPrice)).toEqual({
      basePrice: "CZK 1 000",
      seatPrice: "CZK 500",
      startDate: "2099-09-01",
    });
  }
);
