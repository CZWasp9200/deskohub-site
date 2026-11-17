import { describe, expect, test } from "bun:test";
import { RegistryProvider } from "@effect/atom-react";
import { Option } from "effect";
import { createElement, useEffect } from "react";
import { clientRoot } from "../../testing/client-root";
import { CheckoutState } from "../checkout/checkout-state";
import { keepsDetailsDraft, useDetailsDraft } from "./details-draft";
import { type DetailsDraft, initialDetailsDraft } from "./details-form";

const root = clientRoot();
const fresh = () =>
  initialDetailsDraft({ address: Option.none(), company: Option.none() }, "CZ");

/**
 * A stand-in checkout screen: reads the kept details into `seen` and, once,
 * applies `edit` as the form would.
 */
const Checkout = ({
  seen,
  edit,
}: {
  readonly seen: Array<DetailsDraft>;
  readonly edit?: (draft: DetailsDraft) => DetailsDraft;
}) => {
  const [draft, setDraft] = useDetailsDraft(fresh);
  seen.push(draft);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one edit on mount, as a customer's.
  useEffect(() => {
    if (edit) setDraft(edit(draft));
  }, []);
  return null;
};

describe("useDetailsDraft (details survive going back and a hold expiry)", () => {
  test("a new checkout screen opens with the details the last one left", async () => {
    const seen: Array<DetailsDraft> = [];
    const app = (screen: ReturnType<typeof createElement> | null) =>
      createElement(RegistryProvider, null, screen);
    await root.render(
      app(
        createElement(Checkout, {
          seen,
          edit: (draft) => ({
            ...draft,
            billing: "business",
            someoneElse: { ...draft.someoneElse, name: "Guest Person" },
          }),
        })
      )
    );
    // Back to the selection: the checkout screen is gone.
    await root.render(app(null));
    seen.length = 0;
    await root.render(app(createElement(Checkout, { seen })));
    expect(seen.at(-1)?.billing).toBe("business");
    expect(seen.at(-1)?.someoneElse.name).toBe("Guest Person");
  });
});

describe("keepsDetailsDraft", () => {
  test("a restart, such as an expired hold, keeps the details", () => {
    expect(
      keepsDetailsDraft(CheckoutState.Restart({ reason: "hold_expired" }))
    ).toBe(true);
  });

  test("a submitted booking ends them", () => {
    expect(keepsDetailsDraft(CheckoutState.Done({ orderId: "order-1" }))).toBe(
      false
    );
  });
});
