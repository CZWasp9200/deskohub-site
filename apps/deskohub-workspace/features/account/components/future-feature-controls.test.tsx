import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { type ComponentPropsWithoutRef, useState } from "react";
import { type Locale, m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type {
  CustomerReservationHistory,
  CustomerReservationSummary,
} from "../contracts";

type NavigateEvent = {
  readonly preventDefault: () => void;
};

type MockNextLinkProps = ComponentPropsWithoutRef<"a"> & {
  readonly href: string;
  readonly onNavigate?: (event: NavigateEvent) => void;
  readonly prefetch?: boolean | "auto" | null;
};

function MockNextLink({
  children,
  href,
  onNavigate: _onNavigate,
  prefetch: _prefetch,
  ...props
}: MockNextLinkProps) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

mock.module("next/link", () => ({ default: MockNextLink }));

const routerRefresh = mock(() => undefined);
mock.module("next/navigation", () => ({
  usePathname: () => "/en-US/account",
  useRouter: () => ({ refresh: routerRefresh }),
  unstable_rethrow: (cause: unknown) => {
    throw cause;
  },
}));

type ActionResult = {
  readonly data?: { readonly status?: string };
  readonly serverError?: string;
  readonly validationErrors?: unknown;
};
type ActionInput = object;

const completeCustomerProfile = mock(
  (): Promise<ActionResult> =>
    Promise.resolve({ data: { status: "completed" } })
);
const updateCustomerProfile = mock(
  (): Promise<ActionResult> => Promise.resolve({ data: { status: "updated" } })
);
const deleteCustomerAccount = mock(
  (): Promise<ActionResult> => Promise.resolve({ data: { status: "deleted" } })
);

mock.module("@/features/account/actions", () => ({
  lookupAresBusiness: () =>
    Promise.resolve({ data: { status: "not-found", message: "" } }),
  completeCustomerProfile,
  deleteCustomerAccount,
  updateCustomerProfile,
}));

const uploadCustomerAvatar = mock(() =>
  Promise.resolve({ data: { status: "removed" } })
);
const removeCustomerAvatar = mock(() =>
  Promise.resolve({ data: { status: "removed" } })
);

mock.module("@/features/account/avatar-actions", () => ({
  removeCustomerAvatar,
  uploadCustomerAvatar,
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

const saveMarketingPreferencesAction = mock(
  (_input: MarketingPreferenceSaveInput): Promise<ActionResult> =>
    Promise.resolve({ data: { status: "saved" } })
);
const confirmMarketingManagementAction = mock(
  (_input: MarketingManagementInput): Promise<ActionResult> =>
    Promise.resolve({ data: { status: "confirmed" } })
);
const clearMarketingManagementAction = mock(
  (_input: MarketingManagementInput): Promise<ActionResult> =>
    Promise.resolve({ data: { status: "cleared" } })
);

mock.module("@/features/legal/actions", () => ({
  clearMarketingManagementAction,
  confirmMarketingManagementAction,
  saveMarketingPreferencesAction,
}));

const signInMagicLink = mock(() => Promise.resolve({ error: null }));
const signOut = mock(() => Promise.resolve({ error: null }));

mock.module("@/features/account/analytics-identity", () => ({
  beginAnalyticsAccountTransition: () => undefined,
  completeAnalyticsAccountSignOut: () => undefined,
  getAnalyticsAccountIdentity: () => ({ status: "anonymous" }),
  refreshAnalyticsAccountIdentity: () => Promise.resolve(),
  subscribeAnalyticsAccountIdentity: () => () => undefined,
}));

mock.module("@/features/account/auth.client", () => ({
  authClient: {
    getSession: () => Promise.resolve({ data: null, error: null }),
    signIn: { magicLink: signInMagicLink },
    signOut,
  },
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: (input: ActionInput) => Promise<ActionResult>,
    options?: {
      readonly onSuccess?: (args: { readonly data?: unknown }) => void;
    }
  ) => {
    const [result, setResult] = useState<ActionResult>({});
    const [isExecuting, setIsExecuting] = useState(false);

    const execute = (input: ActionInput) => {
      setIsExecuting(true);
      void action(input).then((nextResult) => {
        setResult(nextResult);
        setIsExecuting(false);
        options?.onSuccess?.({ data: nextResult.data });
      });
    };

    return {
      execute,
      isExecuting,
      reset: () => setResult({}),
      result,
    };
  },
}));

registerWorkspaceComponentTestEnv();

const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);

const { AccountLoading } = await import("./account-loading");
const { getAccountScreenCopy } = await import("./account-screen-copy");
const { BillingScreen } = await import("./billing/billing-screen");
const { DeleteAccountCard } = await import("./delete-account-card");
const { LegalScreen } = await import("./legal/legal-screen");
const { ProfileForm } = await import("./profile-form");
const { ProfileScreen } = await import("./profile/profile-screen");
const { ReservationHistory } = await import("./reservation-history");
const { SignInCard } = await import("./sign-in-card");
const { SignInLoading } = await import("./sign-in-loading");
const { SignOutButton } = await import("./sign-out-button");

afterEach(() => {
  cleanup();
  completeCustomerProfile.mockClear();
  deleteCustomerAccount.mockClear();
  routerRefresh.mockClear();
  signInMagicLink.mockClear();
  signOut.mockClear();
  updateCustomerProfile.mockClear();
  uploadCustomerAvatar.mockClear();
  removeCustomerAvatar.mockClear();
});

afterAll(unregisterWorkspaceComponentTestEnv);

const profileFields = (
  <>
    <div>
      <label htmlFor="future-feature-first-name">First name</label>
      <input id="future-feature-first-name" name="firstName" required />
    </div>
    <div>
      <label htmlFor="future-feature-last-name">Last name</label>
      <input id="future-feature-last-name" name="lastName" />
    </div>
  </>
);

const reservation = (
  overrides: Partial<CustomerReservationSummary>
): CustomerReservationSummary => ({
  endsAt: null,
  id: "future-feature-reservation",
  product: { kind: "other" },
  seats: null,
  startsAt: null,
  status: "confirmed",
  ...overrides,
});

const futureFeatureHistory: CustomerReservationHistory = {
  kind: "available",
  groups: {
    current: [reservation({})],
    past: [],
    unavailable: [],
  },
};

type ScreenView = ReturnType<typeof render>;

const locale = "en-US";
const screenCopy = getAccountScreenCopy(locale);

function renderProfileScreen(): ScreenView {
  return render(
    <ProfileScreen
      copy={screenCopy.profile}
      email="ada@example.test"
      firstName="Ada"
      lastName="Lovelace"
      locale={locale}
    >
      {profileFields}
    </ProfileScreen>
  );
}

function renderBillingScreen(): ScreenView {
  return render(
    <BillingScreen copy={screenCopy.billing} locale={locale}>
      <div>Caller-owned billing fields</div>
    </BillingScreen>
  );
}

function renderLegalScreen(): ScreenView {
  return render(<LegalScreen locale={locale} />);
}

function renderReservationHistory(): ScreenView {
  return render(
    <ReservationHistory
      copy={screenCopy.reservations}
      history={futureFeatureHistory}
      locale={locale}
    />
  );
}

const futureFeatureMessage = m.account_future_feature_tooltip({}, { locale });

async function expectFutureFeatureWrapper(
  view: ScreenView,
  label: string,
  role: "button" | "combobox"
) {
  const control = view.getByRole(role, { name: label });
  expect(control.tagName).toBe("BUTTON");
  expect((control as HTMLButtonElement).disabled).toBe(true);

  const wrapper = control.closest<HTMLElement>('[tabindex="0"]');
  if (!wrapper) throw new Error(`No future-feature wrapper for ${label}`);
  expect(view.getAllByRole("group", { name: label })).toContain(wrapper);

  await act(async () => {
    wrapper.focus();
  });
  expect(view.getByRole("group", { description: futureFeatureMessage })).toBe(
    wrapper
  );
}

function expectNoFutureTooltipWrapper(control: Element) {
  expect(control.closest("[tabindex='0']")).toBeNull();
}

const futureFeatureTargets = [
  {
    label: screenCopy.profile.languageLabel,
    name: "language control",
    render: renderProfileScreen,
    role: "combobox",
  },
  {
    label: screenCopy.billing.addPaymentCard,
    name: "add payment card control",
    render: renderBillingScreen,
    role: "button",
  },
  {
    label: screenCopy.billing.downloadInvoice,
    name: "download invoice control",
    render: renderBillingScreen,
    role: "button",
  },
  {
    label: screenCopy.billing.exportInvoices,
    name: "export invoices control",
    render: renderBillingScreen,
    role: "button",
  },
  {
    label: screenCopy.reservations.checkIn,
    name: "check-in control",
    render: renderReservationHistory,
    role: "button",
  },
  {
    label: m.legalScreenArchiveAction({}, { locale }),
    name: "GDPR archive control",
    render: renderLegalScreen,
    role: "button",
  },
] as const;

describe("account future-feature controls", () => {
  test.each(futureFeatureTargets)(
    "wraps the disabled $name in a focusable group described by the future-feature message",
    async (target) => {
      await expectFutureFeatureWrapper(
        target.render(),
        target.label,
        target.role
      );
    }
  );

  test("does not wrap the known reservation PIN control", () => {
    const view = renderReservationHistory();
    const pinButton = view.getByRole("button", {
      name: screenCopy.reservations.showPinCode,
    });

    expect((pinButton as HTMLButtonElement).disabled).toBe(true);
    expectNoFutureTooltipWrapper(pinButton);
    expect(
      view.getByText(m.accountReservationPinUnavailable({}, { locale }))
    ).toBeTruthy();
    expect(view.queryByText(futureFeatureMessage)).toBeNull();
  });

  test("does not wrap runtime-disabled, loading, auth, or confirmation controls", async () => {
    let resolveProfileUpdate!: (result: ActionResult) => void;
    const pendingProfileUpdate = new Promise<ActionResult>((resolve) => {
      resolveProfileUpdate = resolve;
    });
    updateCustomerProfile.mockImplementationOnce(() => pendingProfileUpdate);

    const profileView = render(
      <ProfileForm
        email="ada@example.test"
        locale={locale}
        mode="edit"
        profile={{
          billing: null,
          firstName: "Ada",
          lastName: "Lovelace",
          phone: null,
        }}
      />
    );
    await act(async () => {
      fireEvent.input(
        profileView.getByLabelText(
          m.accountProfileFirstNameLabel({}, { locale })
        ),
        {
          target: { value: "Grace" },
        }
      );
      fireEvent.submit(
        profileView.container.querySelector("#account-profile-form")!
      );
      await Promise.resolve();
    });

    const saveButton = profileView.container.querySelector(
      "#account-profile-submit"
    );
    if (!saveButton) throw new Error("Profile save button was not rendered");
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expectNoFutureTooltipWrapper(saveButton);
    profileView.unmount();
    resolveProfileUpdate({ data: { status: "updated" } });

    const loadingViews = [
      render(<AccountLoading locale={locale} />),
      render(<SignInLoading locale={locale} />),
    ];
    for (const view of loadingViews) {
      expect(view.container.querySelectorAll("[tabindex='0']")).toHaveLength(0);
      view.unmount();
    }

    signInMagicLink.mockImplementationOnce(
      () =>
        new Promise<{ readonly error: null }>(() => {
          // Pending for the rest of the test: the request is in flight.
        })
    );
    const signInView = render(<SignInCard locale={locale} />);
    fireEvent.change(
      signInView.getByLabelText(m.accountSignInEmailLabel({}, { locale })),
      { target: { value: "ada@example.test" } }
    );
    await act(async () => {
      fireEvent.submit(
        signInView.container.querySelector("#account-sign-in-form")!
      );
      await Promise.resolve();
    });
    const signInButton = signInView.getByRole("button", {
      name: m.accountSignInSubmitting({}, { locale }),
    });
    expect((signInButton as HTMLButtonElement).disabled).toBe(true);
    expectNoFutureTooltipWrapper(signInButton);
    signInView.unmount();

    let resolveSignOut!: (result: { readonly error: null }) => void;
    const pendingSignOut = new Promise<{ readonly error: null }>((resolve) => {
      resolveSignOut = resolve;
    });
    signOut.mockImplementationOnce(() => pendingSignOut);
    const signOutView = render(<SignOutButton locale={locale} />);
    await act(async () => {
      fireEvent.click(
        signOutView.getByRole("button", {
          name: m.accountSignOut({}, { locale }),
        })
      );
      await Promise.resolve();
    });
    const signOutButton = signOutView.getByRole("button", {
      name: m.accountSignOut({}, { locale }),
    });
    expect((signOutButton as HTMLButtonElement).disabled).toBe(true);
    expectNoFutureTooltipWrapper(signOutButton);
    signOutView.unmount();
    resolveSignOut({ error: null });

    const deletionView = render(
      <DeleteAccountCard
        deletionPending={false}
        email="ada@example.test"
        locale={locale}
      />
    );
    await act(async () => {
      fireEvent.click(
        deletionView.getByRole("button", {
          name: m.accountDeletionButton({}, { locale }),
        })
      );
    });
    const confirmationButton = deletionView.baseElement.querySelector(
      "#delete-account-confirm"
    );
    if (!confirmationButton) {
      throw new Error("Delete confirmation button was not rendered");
    }
    expect((confirmationButton as HTMLButtonElement).disabled).toBe(true);
    expectNoFutureTooltipWrapper(confirmationButton);
  });
});
