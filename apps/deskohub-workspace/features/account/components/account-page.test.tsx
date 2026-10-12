import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { useState } from "react";
import type { CustomerProfileInput } from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";
import { parseReferralCode } from "@/features/referrals/client";
import {
  workspaceRouterPush,
  workspaceRouterRefresh,
  workspaceRouterReplace,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  flushWorkspaceComponentWork,
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { CustomerAccountPageState } from "../page-data.server";

registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);

const signInMagicLink = mock(() => Promise.resolve({ error: null }));
const getSession = mock(() => Promise.resolve({ data: null, error: null }));
const beginAnalyticsAccountTransition = mock(() => undefined);
const completeAnalyticsAccountSignOut = mock(() => undefined);
const refreshAnalyticsAccountIdentity = mock(() => Promise.resolve());
const completeCustomerProfile = mock((_input: CustomerProfileInput) =>
  Promise.resolve({ data: { status: "completed" } })
);
const executedWorkspaceActionNames: string[] = [];
mock.module("@/features/account/analytics-identity", () => ({
  beginAnalyticsAccountTransition,
  completeAnalyticsAccountSignOut,
  getAnalyticsAccountIdentity: () => ({ status: "anonymous" }),
  refreshAnalyticsAccountIdentity,
  subscribeAnalyticsAccountIdentity: () => () => undefined,
}));
mock.module("next/navigation", () => ({
  unstable_rethrow: (cause: unknown) => {
    throw cause;
  },
  usePathname: () => "/en-US/account",
  useRouter: () => ({
    push: workspaceRouterPush,
    refresh: workspaceRouterRefresh,
    replace: workspaceRouterReplace,
  }),
  useSearchParams: workspaceUseSearchParams,
}));
mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: (input: never) => Promise<unknown>,
    options?: {
      readonly actionName?: string;
      readonly onSuccess?: (args: { readonly data?: unknown }) => void;
    }
  ) => {
    const [result, setResult] = useState<{
      readonly data?: unknown;
      readonly serverError?: string;
      readonly validationErrors?: unknown;
    }>({});
    const [isExecuting, setExecuting] = useState(false);
    return {
      result,
      isExecuting,
      execute: (input: never) => {
        if (options?.actionName !== undefined) {
          executedWorkspaceActionNames.push(options.actionName);
        }
        setExecuting(true);
        void action(input).then((outcome) => {
          setExecuting(false);
          const nextResult = outcome as {
            readonly data?: unknown;
            readonly serverError?: string;
            readonly validationErrors?: unknown;
          };
          setResult(nextResult);
          if (!nextResult.serverError && !nextResult.validationErrors) {
            options?.onSuccess?.({ data: nextResult.data });
          }
        });
      },
      reset: () => setResult({}),
    };
  },
}));
mock.module("@/features/account/actions", () => ({
  lookupAresBusiness: () =>
    Promise.resolve({ data: { status: "not-found", message: "" } }),
  completeCustomerProfile,
  updateCustomerProfile: () => Promise.resolve({ data: { status: "updated" } }),
  deleteCustomerAccount: () => Promise.resolve({ data: { status: "deleted" } }),
}));

mock.module("@/features/account/avatar-actions", () => ({
  removeCustomerAvatar: () => Promise.resolve({ data: { status: "removed" } }),
  uploadCustomerAvatar: () =>
    Promise.resolve({
      data: {
        avatar: { url: "https://res.cloudinary.test/avatar.webp", version: 1 },
        status: "uploaded",
      },
    }),
}));
type MarketingPreferenceSaveInput = {
  readonly confirmed: true;
  readonly context: string;
  readonly granted: boolean;
  readonly locale: Locale;
  readonly source: "link" | "account";
};

type MarketingManagementInput = {
  readonly context: string;
};

type LegalActionResult = {
  readonly data?: { readonly status: string };
  readonly serverError?: string;
  readonly validationErrors?: unknown;
};

const saveMarketingPreferencesAction = mock(
  (_input: MarketingPreferenceSaveInput): Promise<LegalActionResult> =>
    Promise.resolve({ data: { status: "saved" } })
);
const confirmMarketingManagementAction = mock(
  (_input: MarketingManagementInput): Promise<LegalActionResult> =>
    Promise.resolve({ data: { status: "confirmed" } })
);
const clearMarketingManagementAction = mock(
  (_input: MarketingManagementInput): Promise<LegalActionResult> =>
    Promise.resolve({ data: { status: "cleared" } })
);

mock.module("@/features/legal/actions", () => ({
  clearMarketingManagementAction,
  confirmMarketingManagementAction,
  saveMarketingPreferencesAction,
}));
mock.module("@/features/account/auth.client", () => ({
  authClient: {
    getSession,
    signIn: { magicLink: signInMagicLink },
    signOut: () => Promise.resolve({ error: null }),
  },
}));

class TestResizeObserver implements ResizeObserver {
  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  disconnect() {}

  observe(_target: Element) {}

  unobserve(_target: Element) {}
}

const originalResizeObserver = globalThis.ResizeObserver;
const en = { locale: "en-US" } as const;

const linkedState = {
  kind: "linked",
  email: "ada@example.test",
  profile: {
    firstName: "Ada",
    lastName: "Lovelace",
    phone: null,
    billing: null,
  },
  history: {
    kind: "available",
    groups: { current: [], past: [], unavailable: [] },
  },
  avatar: { kind: "hidden" },
} as const;

describe("AccountPage states", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    globalThis.ResizeObserver = TestResizeObserver;
  });

  afterEach(() => {
    cleanup();
    completeCustomerProfile.mockClear();
    executedWorkspaceActionNames.length = 0;
    workspaceRouterRefresh.mockClear();
    workspaceRouterRefresh.mockImplementation(() => undefined);
    workspaceRouterReplace.mockClear();
    beginAnalyticsAccountTransition.mockClear();
    completeAnalyticsAccountSignOut.mockClear();
    refreshAnalyticsAccountIdentity.mockClear();
    workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
    getSession.mockClear();
  });

  afterAll(async () => {
    cleanup();
    await flushWorkspaceComponentWork();
    globalThis.ResizeObserver = originalResizeObserver;
    await unregisterWorkspaceComponentTestEnv();
  });

  const renderState = async (
    state: CustomerAccountPageState,
    locale: "en-US" | "cs-CZ" = "en-US",
    referralCode?: ReturnType<typeof parseReferralCode>
  ) => {
    const { AccountPage } = await import("./account-page");
    if (state.kind === "unauthenticated") {
      return render(
        <AccountPage
          locale={locale}
          referralCode={referralCode}
          state={state}
        />
      );
    }

    const { AccountLayoutShell } = await import("./account-layout-shell");
    const signedIn =
      state.kind !== "unauthenticated" && state.kind !== "unavailable";
    const view = render(
      <AccountLayoutShell accountsEnabled locale={locale} signedIn={signedIn}>
        <AccountPage
          locale={locale}
          referralCode={referralCode}
          state={state}
        />
      </AccountLayoutShell>
    );

    expect(view.container.querySelectorAll("main")).toHaveLength(1);
    expect(
      within(view.container).getAllByRole("heading", { level: 1 })
    ).toHaveLength(1);
    expect(
      within(view.container).getAllByText(m.accountTitle({}, { locale }))
    ).toHaveLength(1);
    expect(view.container.querySelectorAll("#account-sign-out")).toHaveLength(
      signedIn ? 1 : 0
    );

    return view;
  };

  test("asks for profile completion with the read-only verified email", async () => {
    const view = await renderState({
      kind: "completion-required",
      email: "ada@example.test",
    });

    expect(
      view.getByRole("heading", {
        level: 2,
        name: m.accountCompletionTitle({}, en),
      })
    ).toBeTruthy();
    const email = view.getByLabelText(
      m.accountProfileEmailLabel({}, en)
    ) as HTMLInputElement;
    expect(email.value).toBe("ada@example.test");
    expect(email.readOnly).toBe(true);
    expect(
      view.getByLabelText(m.accountProfileFirstNameLabel({}, en))
    ).toBeTruthy();
    expect(view.getByText(m.accountSignOut({}, en))).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: m.accountDeletionButton({}, en) })
      );
    });
    expect(
      view.getByRole("button", { name: m.accountDeletionConfirm({}, en) })
    ).toBeTruthy();
  });

  test("renders the linked account with profile, reservations, sign out, and deletion", async () => {
    const view = await renderState(linkedState);
    const sectionNavigation = within(
      view.getByRole("group", { name: m.accountSectionLabel({}, en) })
    );

    expect(view.getByText(m.accountTitle({}, en))).toBeTruthy();
    expect(
      sectionNavigation.getByRole("button", {
        name: new RegExp(`^${m.accountSectionReservations({}, en)}`),
      })
    ).toBeTruthy();
    expect(view.getByText(m.accountDeletionButton({}, en))).toBeTruthy();
    expect(view.getByText(m.accountSignOut({}, en))).toBeTruthy();
    expect(view.container.querySelectorAll("main")).toHaveLength(1);

    fireEvent.click(
      sectionNavigation.getByRole("button", {
        name: m.accountSectionProfile({}, en),
      })
    );
    expect(view.getByText(m.accountProfileSave({}, en))).toBeTruthy();
    expect(view.getByText("Ada Lovelace")).toBeTruthy();
    expect(view.getByText("ada@example.test")).toBeTruthy();

    fireEvent.click(
      sectionNavigation.getByRole("button", {
        name: m.accountSectionBilling({}, en),
      })
    );
    expect(view.getByText(m.accountBillingDetailsTitle({}, en))).toBeTruthy();
    expect(view.getByText(m.accountProfileSave({}, en))).toBeTruthy();
  });

  test("ignores a shared referral code on the linked account page", async () => {
    const referralCode = parseReferralCode("RFL12345");
    if (referralCode === undefined) throw new Error("invalid referral code");
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams(`ref=${referralCode}`)
    );

    const view = await renderState(linkedState, "en-US", referralCode);

    expect(
      view.container.querySelector('[data-screen="referrals-screen"]')
    ).toBeTruthy();
    expect(view.queryByRole("button", { name: /accept/i })).toBeNull();
    expect(view.container.querySelector("#profile-referral-code")).toBeNull();
    expect(
      within(view.getByRole("group", { name: m.accountSectionLabel({}, en) }))
        .getByRole("button", {
          name: new RegExp(`^${m.accountSectionReservations({}, en)}`),
        })
        .getAttribute("aria-current")
    ).toBe("page");
  });

  test("submits the shared-link referral code with completion and shows its outcome after the refresh", async () => {
    completeCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        data: { status: "completed", referral: { status: "applied" } },
      } as never)
    );
    const referralCode = parseReferralCode("RFL12345");
    if (referralCode === undefined) throw new Error("invalid referral code");
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams(`ref=${referralCode}`)
    );
    let refreshLinkedAccount!: () => void;
    function ProfileCompletionRefreshJourney() {
      const [state, setState] = useState<CustomerAccountPageState>({
        kind: "completion-required",
        email: "ada@example.test",
        referralCode,
      });
      refreshLinkedAccount = () => setState(linkedState);

      return (
        <AccountLayoutShell accountsEnabled locale="en-US" signedIn>
          <AccountPage
            locale="en-US"
            referralCode={referralCode}
            state={state}
          />
        </AccountLayoutShell>
      );
    }

    const { AccountLayoutShell } = await import("./account-layout-shell");
    const { AccountPage } = await import("./account-page");
    workspaceRouterRefresh.mockImplementation(() => refreshLinkedAccount());
    const view = render(<ProfileCompletionRefreshJourney />);
    const field = view.container.querySelector(
      "#profile-referral-code"
    ) as HTMLInputElement;
    expect(field.value).toBe("RFL12345");

    fireEvent.change(
      view.getByLabelText(m.accountProfileFirstNameLabel({}, en)),
      { target: { value: "Ada" } }
    );
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    await waitFor(() => {
      expect(completeCustomerProfile).toHaveBeenCalledWith({
        firstName: "Ada",
        referralCode: "RFL12345",
        prefilledReferralCode: "RFL12345",
      });
      expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        view.container.querySelector('[data-screen="referrals-screen"]')
      ).toBeTruthy();
    });
    expect(
      view.getByText(m.accountProfileReferralApplied({}, en))
    ).toBeTruthy();
    expect(view.container.querySelector("#profile-referral-code")).toBeNull();
    expect(view.queryByRole("button", { name: /accept/i })).toBeNull();
  });

  test("leaves the completion referral field empty without a usable code", async () => {
    const view = await renderState(
      { kind: "completion-required", email: "ada@example.test" },
      "en-US",
      parseReferralCode("RFL12345")
    );

    const field = view.container.querySelector(
      "#profile-referral-code"
    ) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(
      view.queryByText(m.accountProfileReferralCodeUnavailable({}, en))
    ).toBeNull();
  });

  test("renders the support state with the contact destination and no profile data", async () => {
    const view = await renderState({
      kind: "support-required",
      email: "ada@example.test",
    });

    expect(
      view.getByRole("heading", {
        level: 2,
        name: m.accountSupportTitle({}, en),
      })
    ).toBeTruthy();
    expect(
      view
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === "/en-US/contact")
    ).toBe(true);
    expect(view.queryByText(m.accountProfileSave({}, en))).toBeNull();
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: m.accountDeletionButton({}, en) })
      );
    });
    expect(
      view.getByRole("button", { name: m.accountDeletionConfirm({}, en) })
    ).toBeTruthy();
  });

  test("renders the pending deletion state with retry and sign out", async () => {
    const view = await renderState({
      kind: "deletion-pending",
      email: "ada@example.test",
    });

    expect(view.getByText(m.accountDeletionPendingTitle({}, en))).toBeTruthy();
    expect(view.getByText(m.accountDeletionConfirm({}, en))).toBeTruthy();
    expect(view.getByText(m.accountSignOut({}, en))).toBeTruthy();
  });

  test("renders the unavailable state without any account data", async () => {
    const view = await renderState({ kind: "unavailable" });

    expect(view.getByText(m.accountUnavailableTitle({}, en))).toBeTruthy();
    expect(view.getByText(m.accountTitle({}, en))).toBeTruthy();
    expect(view.queryByText(m.accountSignOut({}, en))).toBeNull();
    expect(view.queryByText(m.accountDeletionButton({}, en))).toBeNull();
  });

  test("redirects unauthenticated visitors without loading account data", async () => {
    const view = await renderState({ kind: "unauthenticated" });

    expect(
      view.getByRole("status", { name: m.accountSignInLoading({}, en) })
    ).toBeTruthy();
    expect(workspaceRouterReplace).toHaveBeenCalledWith("/en-US/auth/sign-in");
    expect(refreshAnalyticsAccountIdentity).not.toHaveBeenCalled();
    expect(view.queryByText(m.accountTitle({}, en))).toBeNull();
    expect(view.queryByText(m.accountSectionReservations({}, en))).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
    expect(view.queryByText(m.accountDeletionButton({}, en))).toBeNull();
    expect(
      view.queryByLabelText(m.accountProfileScreenVerifiedEmail({}, en))
    ).toBeNull();
    expect(view.container.textContent).not.toContain("ada@example.test");
  });

  test("renders the authenticated unavailable state with account controls", async () => {
    const view = await renderState({
      kind: "authenticated-unavailable",
      email: "ada@example.test",
    });

    expect(view.getByText(m.accountTitle({}, en))).toBeTruthy();
    expect(view.getByText(m.accountSignOut({}, en))).toBeTruthy();
    expect(view.getByText(m.accountDeletionButton({}, en))).toBeTruthy();
    expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      view.getByRole("heading", {
        level: 2,
        name: m.accountUnavailableTitle({}, en),
      })
    ).toBeTruthy();
  });

  test("asks the account identity adapter to refresh once per authenticated view", async () => {
    await renderState(linkedState);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);

    await renderState({ kind: "unavailable" });
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
  });

  test("swallows a failed identity refresh instead of leaving an unhandled rejection", async () => {
    refreshAnalyticsAccountIdentity.mockImplementationOnce(() =>
      Promise.reject(new Error("identity refresh unavailable"))
    );

    await renderState(linkedState);
    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
  });
});
