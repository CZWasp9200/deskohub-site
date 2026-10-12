import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { type Locale, m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const syntheticOccupancy = {
  averageReservationsPerDay: 2.36,
  coworkSeatCapacity: 17,
} as const;
const loadFaqOccupancyStats = mock(async () => syntheticOccupancy);
let requestLocale: Locale = "en-US";

function runWithRequestLocale<A>(resolve: (locale: Locale) => A) {
  return Promise.resolve(resolve(requestLocale));
}

mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale,
}));
mock.module("@/features/faq/backend/faq-occupancy.server", () => ({
  loadFaqOccupancyStats,
}));

const { default: LocalizedFaqPage } = await import("./page");

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
  loadFaqOccupancyStats.mockClear();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

test.each(["en-US", "cs-CZ"] as const)(
  "the localized FAQ route renders the %s FAQ with loaded occupancy",
  async (locale) => {
    requestLocale = locale;
    const view = render(await LocalizedFaqPage());

    expect(
      view.getByRole("heading", {
        level: 1,
        name: m.faqPageTitle({}, { locale }),
      })
    ).toBeTruthy();
    expect(loadFaqOccupancyStats).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain(
      String(syntheticOccupancy.coworkSeatCapacity)
    );
  }
);
