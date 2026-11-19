import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { act, type ReactNode } from "react";
import * as ReactNative from "react-native";
import { clientRoot } from "../../testing/client-root";
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";
import { emptyProfileDraft } from "../profile/profile-draft";
import type { ProfileFieldRefs } from "../profile/profile-fields";

mock.module("expo-router", () => expoRouterStandIn());

const native = { ...ReactNative };
const { BillingAddressSection } = await import("./billing-sections");

describe("BillingAddressSection, mounted", () => {
  const { render, container } = clientRoot();
  // Render the native containers without forwarding their styles to the DOM.
  beforeAll(() => {
    mock.module("react-native", () => ({
      ...native,
      View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
      Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
      Pressable: ({ children }: { children?: ReactNode }) => (
        <button type="button">{children}</button>
      ),
      Modal: () => null,
      TextInput: ({ autoComplete, value }: ReactNative.TextInputProps) => (
        <input autoComplete={autoComplete} value={value} readOnly />
      ),
    }));
  });
  afterAll(() => mock.module("react-native", () => native));

  test.each(["postal-address-locality", "postal-code"])(
    "keeps the %s input focused when the address switches layout",
    async (autocomplete) => {
      const inputs: ProfileFieldRefs = { current: new Map() };
      const address = (layout: "compact" | "onboarding") => (
        <BillingAddressSection
          draft={emptyProfileDraft}
          invalid={undefined}
          onChange={() => undefined}
          inputs={inputs}
          editable
          locale="en-US"
          layout={layout}
        />
      );
      const field = () =>
        container().querySelector<HTMLInputElement>(
          `input[autocomplete="${autocomplete}"]`
        );

      document.body.append(container());
      await render(address("onboarding"));
      const original = field();
      if (original === null) throw new Error("Address input did not mount");
      await act(async () => original.focus());
      expect(document.activeElement === original).toBe(true);

      await render(address("compact"));
      expect(field() === original).toBe(true);
      expect(document.activeElement === original).toBe(true);

      await render(address("onboarding"));
      expect(field() === original).toBe(true);
      expect(document.activeElement === original).toBe(true);
    }
  );
});
