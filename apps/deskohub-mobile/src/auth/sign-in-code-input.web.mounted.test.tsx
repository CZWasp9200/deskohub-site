import { afterEach, describe, expect, test } from "bun:test";
import { clientRoot } from "../testing/client-root";
import { SignInCodeInput } from "./sign-in-code-input.web";

const input = (disabled: boolean) => (
  <SignInCodeInput
    value=""
    onChange={() => undefined}
    label="code"
    disabled={disabled}
  />
);

describe("SignInCodeInput, mounted", () => {
  const { render, container } = clientRoot();
  afterEach(async () => {
    await render(null);
  });

  test("takes focus again when it re-enables, for the next code", async () => {
    // Focus needs the input in the document.
    document.body.append(container());
    await render(input(true));
    const field = container().querySelector("input");
    expect(field?.disabled).toBe(true);
    (document.activeElement as HTMLElement | null)?.blur();
    await render(input(false));
    expect(document.activeElement).toBe(field);
  });
});
