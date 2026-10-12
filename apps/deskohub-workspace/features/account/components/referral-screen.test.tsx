import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { parseReferralCode } from "@/features/referrals/client";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const { ReferralScreen } = await import("./referral-screen");

const code = parseReferralCode("RFL12345");
if (code === undefined) throw new Error("Invalid referral test code");

const summary = {
  code,
  eligibleInviteeCount: 3,
  discount: "14.2625",
} as const;
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard"
);

describe("ReferralScreen", () => {
  beforeAll(registerWorkspaceComponentTestEnv);
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
    [
      "en-US",
      "Invite other Workspace customers",
      "Currently eligible invited customers: 3",
    ],
    [
      "cs-CZ",
      "Pozvěte další zákazníky Workspace",
      "Právě způsobilí pozvaní zákazníci: 3",
    ],
  ] as const)(
    "shows the share code and eligible count in %s",
    (locale, title, countLabel) => {
      const view = render(<ReferralScreen locale={locale} summary={summary} />);

      expect(view.getByRole("heading", { name: title })).toBeTruthy();
      expect(view.getByText("RFL12345")).toBeTruthy();
      expect(view.getByText(countLabel)).toBeTruthy();
      expect(view.getByText(/14[,.]2625%/)).toBeTruthy();
      expect(
        view.getByRole("link", { name: `/${locale}/account?ref=RFL12345` })
      ).toBeTruthy();
      expect(view.queryByText(/@/)).toBeNull();
    }
  );

  test.each([
    [
      "en-US",
      "Each invited customer with a confirmed, paid Workspace booking that ended within the past 30 days adds a compounding 5% discount to your reservations.",
    ],
    [
      "cs-CZ",
      "Každý pozvaný zákazník s potvrzenou a zaplacenou rezervací ve Workspace, která skončila během posledních 30 dnů, zvyšuje vaši slevu na rezervace o dalších 5 %. Slevy se skládají.",
    ],
  ] as const)(
    "explains the booking-end reward window in %s",
    (locale, terms) => {
      const view = render(<ReferralScreen locale={locale} summary={summary} />);

      expect(view.getByText(terms)).toBeTruthy();
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
    ).toEqual(["Copy referral link"]);
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
