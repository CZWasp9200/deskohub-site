import { describe, expect, test } from "bun:test";
import { testDatabase } from "./auth-handler.test-utils";

type AuthHandlerTestUtils = typeof import("./auth-handler.test-utils");

/**
 * Loads a fresh instance of the helpers, as `bun test --parallel` gives each
 * test file, while every source of randomness returns the same value.
 */
const loadInstance = async (label: string) =>
  (await import(
    `./auth-handler.test-utils.ts?instance=${label}-${crypto.randomUUID()}`
  )) as AuthHandlerTestUtils;

const takeAddresses = (utils: AuthHandlerTestUtils, count: number) =>
  Array.from({ length: count }, () => utils.uniqueIp());

describe.skipIf(!testDatabase)("uniqueIp on the shared test database", () => {
  test("helper instances of separate test files never share an address", async () => {
    const random = Math.random;
    Math.random = () => 0.5;
    try {
      const first = await loadInstance("first");
      const second = await loadInstance("second");

      const firstAddresses = takeAddresses(first, 300);
      const secondAddresses = takeAddresses(second, 300);

      expect(new Set(firstAddresses).size).toBe(300);
      expect(
        secondAddresses.filter((address) => firstAddresses.includes(address))
          .length
      ).toBe(0);
    } finally {
      Math.random = random;
    }
  });
});
