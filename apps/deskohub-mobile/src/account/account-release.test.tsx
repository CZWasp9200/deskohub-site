import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { clientRoot } from "../testing/client-root";
import type { AccountRelease } from "./account-gating";

// The test runs as a development build without sample data.
(globalThis as { __DEV__?: boolean }).__DEV__ = true;
const { useAccountRelease } = await import("./account-release");

const { render } = clientRoot();

describe("useAccountRelease", () => {
  test("payment methods stay hidden while their flag hasn't loaded", async () => {
    const seen: { release?: AccountRelease } = {};
    function Probe() {
      seen.release = useAccountRelease();
      return null;
    }

    await render(createElement(Probe));

    expect(seen.release).toEqual({ paymentMethods: false });
  });
});
