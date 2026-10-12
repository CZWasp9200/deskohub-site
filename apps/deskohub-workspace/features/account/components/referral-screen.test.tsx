import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { parseReferralCode } from "@/features/referrals/client";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

// Radix resolves its layout-effect hook on import, so load the screen only
// after the component test DOM is registered.
let ReferralScreen: typeof import("./referral-screen").ReferralScreen;

const code = parseReferralCode("RFL12345");
if (code === undefined) throw new Error("Invalid referral test code");

const summary = {
  code,
  inviteeCount: 5,
  eligibleInviteeCount: 3,
  discount: "14.2625",
  savings: [{ value: 9234, exponent: 2, currency: "CZK" }],
} as const;
const emptySummary = {
  code,
  inviteeCount: 0,
  eligibleInviteeCount: 0,
  discount: "0",
  savings: [],
} as const;
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard"
);

describe("ReferralScreen", () => {
  beforeAll(async () => {
    registerWorkspaceComponentTestEnv();
    ({ ReferralScreen } = await import("./referral-screen"));
  });
  afterEach(() => {
    cleanup();
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });
  afterAll(unregisterWorkspaceComponentTestEnv);

  test.each([
    {
      locale: "en-US",
      headings: [
        "Referrals",
        "Global discount",
        "Invite other Workspace customers",
        "How referrals work",
      ],
      countSummary: "Referrals counting toward your discount: 3 of 5.",
      discount: "14.2625%",
      saved: "CZK 92.34",
    },
    {
      locale: "cs-CZ",
      headings: [
        "Doporučení",
        "Globální sleva",
        "Pozvěte další zákazníky Workspace",
        "Jak doporučení fungují",
      ],
      countSummary: "Doporučení započítaná do vaší slevy: 3 z 5.",
      discount: "14,2625\u00a0%",
      // Text queries collapse the no-break space Intl puts before the symbol.
      saved: "92,34 Kč",
    },
  ] as const)(
    "shows the referral counts, discount, savings, and share code in $locale",
    ({ countSummary, discount, headings, locale, saved }) => {
      const view = render(<ReferralScreen locale={locale} summary={summary} />);

      expect(
        view.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
      ).toEqual([...headings]);
      const referrals = within(view.getByRole("region", { name: headings[0] }));
      expect(
        view.container.querySelector("#account-referrals-eligible-count")
          ?.textContent
      ).toBe("3");
      expect(referrals.getByText("/ 5")).toBeTruthy();
      expect(referrals.getByText(countSummary)).toBeTruthy();
      const discountBox = within(
        view.getByRole("region", { name: headings[1] })
      );
      expect(
        view.container.querySelector("#account-referrals-discount")?.textContent
      ).toBe(discount);
      expect(discountBox.getByText(saved)).toBeTruthy();
      expect(view.getByText("RFL12345")).toBeTruthy();
      expect(
        view.getByRole("link", { name: `/${locale}/account?ref=RFL12345` })
      ).toBeTruthy();
      expect(view.queryByText(/@/)).toBeNull();
    }
  );

  test("presents a customer without referrals or savings as an empty starting point", () => {
    const view = render(
      <ReferralScreen locale="en-US" summary={emptySummary} />
    );

    expect(
      view.container.querySelector("#account-referrals-eligible-count")
        ?.textContent
    ).toBe("0");
    expect(view.getByText("/ 0")).toBeTruthy();
    expect(
      view.getByText("No one has joined with your referral yet.")
    ).toBeTruthy();
    expect(
      view.container.querySelector("#account-referrals-discount")?.textContent
    ).toBe("0%");
    expect(view.getByText("Nothing saved through referrals yet.")).toBeTruthy();
    expect(view.getByText("RFL12345")).toBeTruthy();
  });

  test("lists savings in every currency the customer paid in", () => {
    const view = render(
      <ReferralScreen
        locale="en-US"
        summary={{
          ...summary,
          savings: [
            { value: 9234, exponent: 2, currency: "CZK" },
            { value: 200, exponent: 2, currency: "EUR" },
          ],
        }}
      />
    );

    expect(view.getByText("CZK 92.34 and €2")).toBeTruthy();
  });

  test.each([
    [
      "en-US",
      "What the referral numbers mean",
      "The large number shows invited customers who count toward your discount right now. The smaller number shows everyone who has joined with your referral.",
    ],
    [
      "cs-CZ",
      "Co znamenají čísla doporučení",
      "Velké číslo ukazuje pozvané zákazníky, kteří se právě počítají do vaší slevy. Menší číslo ukazuje všechny, kdo se připojili přes vaše doporučení.",
    ],
  ] as const)(
    "explains the eligible and total counts in a tooltip in %s",
    async (locale, label, explanation) => {
      const view = render(<ReferralScreen locale={locale} summary={summary} />);
      const trigger = view.getByRole("button", { name: label });

      await act(async () => {
        trigger.focus();
      });

      const tooltip = await waitFor(() =>
        within(view.baseElement).getByRole("tooltip")
      );
      expect(tooltip.textContent).toBe(explanation);
      expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
    }
  );

  test.each([
    [
      "en-US",
      [
        "Share your code or link. A new customer who uses it gets 15% off their first paid Workspace booking.",
        "An invited customer counts toward your discount for 30 days after their confirmed, paid Workspace booking ends. Each new visit restarts the 30 days.",
        "Each counted customer takes another 5% off the remaining price, so the discounts compound: 5% for one, 9.75% for two, and 14.2625% for three. Your discount applies automatically to your Workspace bookings.",
        "Your savings add up the referral discounts on your paid bookings, including your own first-booking discount if someone invited you. Refunded bookings are not included.",
      ],
    ],
    [
      "cs-CZ",
      [
        "Sdílejte svůj kód nebo odkaz. Nový zákazník, který ho použije, získá 15% slevu na svou první zaplacenou rezervaci ve Workspace.",
        "Pozvaný zákazník se do vaší slevy počítá 30 dní od konce své potvrzené a zaplacené rezervace ve Workspace. Každá další návštěva těchto 30 dní obnoví.",
        "Každý započítaný zákazník sníží zbývající cenu o dalších 5 %, slevy se tedy skládají: 5 % za jednoho, 9,75 % za dva a 14,2625 % za tři. Sleva se automaticky uplatní na vaše rezervace ve Workspace.",
        "Úspora sčítá doporučovací slevy na vašich zaplacených rezervacích, včetně vaší slevy na první rezervaci, pokud vás někdo pozval. Vrácené rezervace se nezapočítávají.",
      ],
    ],
  ] as const)(
    "explains the invitation benefit, booking-end window, discount, and savings in %s",
    (locale, terms) => {
      const view = render(<ReferralScreen locale={locale} summary={summary} />);

      for (const term of terms) expect(view.getByText(term)).toBeTruthy();
    }
  );

  test("offers only the customer's own share code and link, with no way to accept another code", () => {
    const view = render(<ReferralScreen locale="en-US" summary={summary} />);
    const screen = view.container.querySelector(
      '[data-screen="referrals-screen"]'
    );

    expect(screen?.querySelector("#account-referrals-code")?.textContent).toBe(
      "RFL12345"
    );
    expect(
      screen?.querySelector("#account-referrals-link")?.getAttribute("href")
    ).toBe("/en-US/account?ref=RFL12345");
    expect(view.queryByRole("textbox")).toBeNull();
    expect(
      view.getAllByRole("button").map((button) => button.textContent)
    ).toEqual(["", "Copy referral link"]);
  });

  test("shows the unavailable summary without any acceptance control", () => {
    const view = render(<ReferralScreen locale="cs-CZ" />);

    expect(
      view.getByText("Informace o doporučeních jsou dočasně nedostupné.")
    ).toBeTruthy();
    expect(view.queryByRole("button")).toBeNull();
    expect(view.queryByRole("textbox")).toBeNull();
  });

  test("shows copied and failed share-link feedback", async () => {
    window.location.href = "http://localhost/en-US/account";
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const view = render(<ReferralScreen locale="en-US" summary={summary} />);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Copy referral link" }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(
      new URL("/en-US/account?ref=RFL12345", window.location.origin).href
    );
    expect(
      view.getByRole("button", { name: "Referral link copied." })
    ).toBeTruthy();

    writeText.mockImplementation(() =>
      Promise.reject(new Error("clipboard denied"))
    );
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Referral link copied." })
      );
      await Promise.resolve();
    });
    expect(view.getByRole("status").textContent).toContain(
      "Your browser could not copy the link. Select and copy it instead."
    );
  });
});
