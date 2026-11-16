import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { baseLocale, locales } from "@/features/i18n";

// Catalogs are flat message maps; a missing message is undefined.
const readCatalog = (locale: string): Partial<Record<string, string>> =>
  JSON.parse(
    readFileSync(
      join(import.meta.dir, "..", "i18n", "messages", `${locale}.json`),
      "utf8"
    )
  );

// The install bar and its guide, including the labels drawn in the guide's
// pictures, which must match what the visitor's own browser shows.
const isInstallMessage = (key: string) =>
  key.startsWith("installBar") || key.startsWith("installGuide");

const installMessageKeys = Object.keys(readCatalog(baseLocale)).filter(
  isInstallMessage
);

describe("install bar messages", () => {
  test("the base locale has install bar and guide messages", () => {
    expect(installMessageKeys.length).toBeGreaterThan(0);
  });

  test.each([...locales])(
    "%s has every install bar and guide message",
    (locale) => {
      const catalog = readCatalog(locale);
      const missing = installMessageKeys.filter((key) => !catalog[key]);
      expect(missing).toEqual([]);
    }
  );
});
