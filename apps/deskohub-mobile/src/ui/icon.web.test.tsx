import { describe, expect, spyOn, test } from "bun:test";
import { clientRoot } from "../testing/client-root";
import { iconHiddenProps } from "./icon";

const root = clientRoot();

describe("Icon on the web", () => {
  test("hides the icon with attributes the DOM accepts, so React logs no warning", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // react-native-svg draws a DOM <svg> on the web and passes these props on.
      await root.render(<svg {...iconHiddenProps("web")} />);
      expect(errors).not.toHaveBeenCalled();
      expect(
        root.container().querySelector("svg")?.getAttribute("aria-hidden")
      ).toBe("true");
    } finally {
      errors.mockRestore();
    }
  });

  test("the native props would be rejected by the DOM", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // Guards the test above: the warnings it checks for are real.
      await root.render(<svg {...iconHiddenProps("android")} />);
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
