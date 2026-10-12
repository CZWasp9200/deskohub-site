import { describe, expect, mock, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

const requestHeaders = new AsyncLocalStorage<Headers>();

mock.module("next/headers", () => ({
  headers: async () => requestHeaders.getStore() ?? new Headers(),
}));

function request<T>(localeCookie: string | undefined, callback: () => T) {
  const headers = new Headers({ referer: "https://deskohub.test/checkout" });
  if (localeCookie) headers.set("cookie", `PARAGLIDE_LOCALE=${localeCookie}`);

  return requestHeaders.run(headers, callback);
}

async function createLocaleReader(
  beforeRead: () => Promise<unknown> = () => Promise.resolve()
) {
  const { actionClient } = await import("../safe-action-client");
  const { getLocale } = await import("@/features/i18n/paraglide/runtime.js");

  return actionClient.action(async ({ ctx }) => {
    await beforeRead();
    return { contextLocale: ctx.locale, messageLocale: getLocale() };
  });
}

describe("action locale middleware", () => {
  test("a request without a locale cookie keeps the default after a Czech request", async () => {
    const readLocale = await createLocaleReader();

    await request("cs-CZ", () => readLocale());
    const result = await request(undefined, () => readLocale());

    expect(result.data).toEqual({
      contextLocale: "en-US",
      messageLocale: "en-US",
    });
  });

  test("overlapping requests each read their own locale", async () => {
    const bothStarted = Promise.withResolvers<void>();
    let started = 0;
    const readLocale = await createLocaleReader(() => {
      started += 1;
      if (started === 2) bothStarted.resolve();
      return bothStarted.promise;
    });

    const [czech, english] = await Promise.all([
      request("cs-CZ", () => readLocale()),
      request("en-US", () => readLocale()),
    ]);

    expect(czech.data).toEqual({
      contextLocale: "cs-CZ",
      messageLocale: "cs-CZ",
    });
    expect(english.data).toEqual({
      contextLocale: "en-US",
      messageLocale: "en-US",
    });
  });
});
