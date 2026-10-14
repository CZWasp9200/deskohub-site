import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { SiteHeaderAccountEntry } from "@/shared/components/site-header-config";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type CapturedLink = {
  readonly href: string;
  readonly prefetch: boolean | null | undefined;
};

const capturedLinks: CapturedLink[] = [];
const capturedGuardedLinkHrefs: string[] = [];
let currentPathname = "/en-US";

mock.module("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    scroll: _scroll,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly children?: ReactNode;
    readonly href: string | URL;
    readonly prefetch?: boolean | null;
    readonly scroll?: boolean;
  }) => {
    const stringHref = href.toString();
    capturedLinks.push({ href: stringHref, prefetch });

    return (
      <a href={stringHref} {...props}>
        {children}
      </a>
    );
  },
}));

mock.module("@/shared/components/guarded-link", () => ({
  GuardedLink: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly href: string | URL;
    readonly prefetch?: boolean | "auto" | null;
  }) => {
    const stringHref = href.toString();
    capturedGuardedLinkHrefs.push(stringHref);

    return (
      <a href={stringHref} {...props}>
        {children}
      </a>
    );
  },
}));

mock.module("next/navigation", () => ({
  usePathname: () => currentPathname,
  useSearchParams: () => new URLSearchParams(),
}));

mock.module("@/shared/components/logo", () => ({
  HorizontalLogo: () => (
    <span data-testid="horizontal-logo">Deskohub Workspace</span>
  ),
  Logo: () => <span />,
}));

// Marked as already fulfilled so `use()` reads it without suspending.
const resolvedHref = (href: string) =>
  Object.assign(Promise.resolve(href), { status: "fulfilled", value: href });

const accountEntry = (
  href: string,
  signInHref = "/en-US/auth/sign-in"
): SiteHeaderAccountEntry => ({
  href: resolvedHref(href),
  label: "Account",
  signInHref,
});

const completeSiteHeaderProps = {
  account: accountEntry("/en-US/account"),
  closeNavigationMenuLabel: "Close navigation menu",
  contactHref: "/en-US/reservation/cowork",
  contactLabel: "Book",
  currentLocale: "en-US" as const,
  languageLabels: { "cs-CZ": "Czech", "en-US": "English" },
  languageSwitcherLabel: "Language switcher",
  links: [],
  mobilePrimaryNavigationLabel: "Mobile primary navigation",
  openNavigationMenuLabel: "Open navigation menu",
  primaryNavigationLabel: "Primary navigation",
};

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  capturedLinks.length = 0;
  capturedGuardedLinkHrefs.length = 0;
  currentPathname = "/en-US";
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

test("uses document navigation for every alternate-locale full-header link", async () => {
  const { SiteHeader } = await import("./site-header");

  for (const { alternateHref, contactHref, currentLocale, pathname } of [
    {
      alternateHref: "/cs-CZ",
      contactHref: "/en-US/contact",
      currentLocale: "en-US",
      pathname: "/en-US",
    },
    {
      alternateHref: "/en-US",
      contactHref: "/cs-CZ/contact",
      currentLocale: "cs-CZ",
      pathname: "/cs-CZ",
    },
  ] as const) {
    currentPathname = pathname;
    capturedLinks.length = 0;
    const view = render(
      <SiteHeader
        account={accountEntry(`/${currentLocale}/account`)}
        contactHref={contactHref}
        contactLabel="Contact"
        currentLocale={currentLocale}
        languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
        links={[]}
      />
    );

    expect(
      view.container.querySelectorAll(`a[href="${alternateHref}"]`)
    ).toHaveLength(2);
    expect(capturedLinks.filter(({ href }) => href === alternateHref)).toEqual(
      []
    );
    expect(
      view.container.querySelectorAll(`a[href="/${currentLocale}/account"]`)
    ).toHaveLength(2);
    view.unmount();
  }
});

test("renders only the configured full-header items without reserved slots", async () => {
  const { SiteHeader } = await import("./site-header");
  const galleryHref = "/en-US/gallery";
  render(
    <SiteHeader
      account={accountEntry("/en-US/account")}
      closeNavigationMenuLabel="Close navigation menu"
      contactHref="/en-US/reservation/cowork"
      contactLabel="Book"
      currentLocale="en-US"
      languageSwitcherLabel="Language switcher"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      links={[
        {
          id: "gallery",
          href: galleryHref,
          label: "Gallery",
        },
      ]}
      mobilePrimaryNavigationLabel="Mobile primary navigation"
      openNavigationMenuLabel="Open navigation menu"
      primaryNavigationLabel="Primary navigation"
    />
  );

  expect(capturedGuardedLinkHrefs).toEqual([
    "/en-US",
    galleryHref,
    "/en-US/reservation/cowork",
    "/en-US/account",
    "/en-US/account",
    galleryHref,
  ]);
});

test("marks navigation links for the current page", async () => {
  const { SiteHeader } = await import("./site-header");
  currentPathname = "/en-US/gallery";
  const view = render(
    <SiteHeader
      {...completeSiteHeaderProps}
      links={[
        { id: "gallery", href: "/en-US/gallery", label: "Gallery" },
        { id: "team", href: "/en-US/team", label: "Team" },
      ]}
    />
  );

  expect(
    [...view.container.querySelectorAll('a[href="/en-US/gallery"]')].map(
      (link) => link.getAttribute("aria-current")
    )
  ).toEqual(["page", "page"]);
  expect(
    [...view.container.querySelectorAll('a[href="/en-US/team"]')].map((link) =>
      link.getAttribute("aria-current")
    )
  ).toEqual([null, null]);
});

test.each([
  {
    accountHref: "/en-US/account",
    currentLocale: "en-US" as const,
    pathname: "/en-US/account",
    active: true,
  },
  {
    accountHref: "/en-US/account",
    currentLocale: "en-US" as const,
    pathname: "/en-US/accounting",
    active: false,
  },
  {
    accountHref: "/en-US/account",
    currentLocale: "en-US" as const,
    pathname: "/cs-CZ/account",
    active: false,
  },
] as const)(
  "marks both account links active only for an exact pathname ($pathname)",
  async ({ accountHref, active, currentLocale, pathname }) => {
    const { SiteHeader } = await import("./site-header");
    currentPathname = pathname;
    const view = render(
      <SiteHeader
        {...completeSiteHeaderProps}
        account={accountEntry(accountHref)}
        contactHref={`/${currentLocale}/contact`}
        currentLocale={currentLocale}
      />
    );

    const accountLinks = Array.from(
      view.container.querySelectorAll(`a[href="${accountHref}"]`)
    );
    expect(accountLinks).toHaveLength(2);
    expect(view.getAllByRole("link", { name: "Account" })).toHaveLength(2);

    for (const link of accountLinks) {
      expect(link.getAttribute("aria-current")).toBe(active ? "page" : null);
    }

    expect(accountLinks[0]?.getAttribute("aria-label")).toBe("Account");
    expect(accountLinks[0]?.getAttribute("title")).toBe("Account");
  }
);

test("links the account entry to sign-in while the session check is pending", async () => {
  const { SiteHeader } = await import("./site-header");
  let resolveHref!: (href: string) => void;
  const href = new Promise<string>((resolve) => {
    resolveHref = resolve;
  });
  let view!: RenderResult;
  await act(async () => {
    view = render(
      <SiteHeader
        {...completeSiteHeaderProps}
        account={{
          href,
          label: "Account",
          signInHref: "/en-US/auth/sign-in",
        }}
      />
    );
  });

  expect(
    view.container.querySelectorAll('a[href="/en-US/auth/sign-in"]')
  ).toHaveLength(2);
  expect(view.getAllByRole("link", { name: "Account" })).toHaveLength(2);

  await act(async () => {
    resolveHref("/en-US/account");
    await href;
  });

  expect(
    view.container.querySelectorAll('a[href="/en-US/account"]')
  ).toHaveLength(2);
  expect(
    view.container.querySelectorAll('a[href="/en-US/auth/sign-in"]')
  ).toHaveLength(0);
});

test("uses document navigation for the alternate-locale minimal-header link", async () => {
  const { MinimalSiteHeader } = await import("./minimal-site-header");

  for (const { alternateHref, currentLocale, pathname } of [
    {
      alternateHref: "/cs-CZ",
      currentLocale: "en-US",
      pathname: "/en-US",
    },
    {
      alternateHref: "/en-US",
      currentLocale: "cs-CZ",
      pathname: "/cs-CZ",
    },
  ] as const) {
    currentPathname = pathname;
    capturedLinks.length = 0;
    const view = render(
      <MinimalSiteHeader
        currentLocale={currentLocale}
        languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      />
    );

    expect(
      view.container.querySelectorAll(`a[href="${alternateHref}"]`)
    ).toHaveLength(1);
    expect(capturedLinks.filter(({ href }) => href === alternateHref)).toEqual(
      []
    );
    expect(capturedLinks).toContainEqual({
      href: `/${currentLocale}`,
      prefetch: false,
    });
    view.unmount();
  }
});

const localePreference = (signedIn: boolean) => {
  const saves: { locale: string }[] = [];
  const saved = Promise.withResolvers<void>();
  return {
    saves,
    saved,
    preference: {
      signedIn: Promise.resolve(signedIn),
      save: (input: { locale: "cs-CZ" | "en-US" }) => {
        saves.push(input);
        return saved.promise;
      },
    },
  };
};

test("a signed-in switch saves the preference before navigating to the new locale", async () => {
  const { LocaleSwitcherLinks } = await import("./locale-switcher-links");
  window.location.href = "http://localhost/en-US";
  const { saves, saved, preference } = localePreference(true);
  const view = render(
    <LocaleSwitcherLinks
      currentLocale="en-US"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      localePreference={preference}
    />
  );
  await act(() => preference.signedIn);

  fireEvent.click(view.getByRole("link", { name: "Czech" }));

  await waitFor(() => expect(saves).toEqual([{ locale: "cs-CZ" }]));
  expect(window.location.pathname).toBe("/en-US");

  await act(async () => {
    saved.resolve();
    await saved.promise;
  });

  expect(window.location.pathname).toBe("/cs-CZ");
});

test("a signed-in switch still navigates when the save fails", async () => {
  const { LocaleSwitcherLinks } = await import("./locale-switcher-links");
  window.location.href = "http://localhost/en-US";
  const saves: { locale: string }[] = [];
  const signedIn = Promise.resolve(true);
  const view = render(
    <LocaleSwitcherLinks
      currentLocale="en-US"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      localePreference={{
        signedIn,
        save: (input) => {
          saves.push(input);
          return Promise.reject(new Error("network unreachable"));
        },
      }}
    />
  );
  await act(() => signedIn);

  fireEvent.click(view.getByRole("link", { name: "Czech" }));

  await waitFor(() => expect(window.location.pathname).toBe("/cs-CZ"));
  expect(saves).toEqual([{ locale: "cs-CZ" }]);
});

test("a guest switch stays a plain link without saving", async () => {
  const { LocaleSwitcherLinks } = await import("./locale-switcher-links");
  const { saves, preference } = localePreference(false);
  const view = render(
    <LocaleSwitcherLinks
      currentLocale="en-US"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      localePreference={preference}
    />
  );
  await act(() => preference.signedIn);

  const link = view.getByRole("link", { name: "Czech" });
  const notPrevented = fireEvent.click(link);

  expect(notPrevented).toBe(true);
  expect(link.getAttribute("href")).toBe("/cs-CZ");
  expect(saves).toEqual([]);
});

test("a switch before the session check settles waits for it, then saves when signed in", async () => {
  const { LocaleSwitcherLinks } = await import("./locale-switcher-links");
  window.location.href = "http://localhost/en-US";
  const signedIn = Promise.withResolvers<boolean>();
  const saves: { locale: string }[] = [];
  const view = render(
    <LocaleSwitcherLinks
      currentLocale="en-US"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      localePreference={{
        signedIn: signedIn.promise,
        save: (input) => {
          saves.push(input);
          return Promise.resolve();
        },
      }}
    />
  );

  const notPrevented = fireEvent.click(
    view.getByRole("link", { name: "Czech" })
  );
  expect(notPrevented).toBe(false);
  expect(saves).toEqual([]);

  await act(async () => {
    signedIn.resolve(true);
    await signedIn.promise;
  });

  await waitFor(() => expect(window.location.pathname).toBe("/cs-CZ"));
  expect(saves).toEqual([{ locale: "cs-CZ" }]);
});

test("a guest switch before the session check settles navigates without saving", async () => {
  const { LocaleSwitcherLinks } = await import("./locale-switcher-links");
  window.location.href = "http://localhost/en-US";
  const signedIn = Promise.withResolvers<boolean>();
  const saves: { locale: string }[] = [];
  const view = render(
    <LocaleSwitcherLinks
      currentLocale="en-US"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      localePreference={{
        signedIn: signedIn.promise,
        save: (input) => {
          saves.push(input);
          return Promise.resolve();
        },
      }}
    />
  );

  fireEvent.click(view.getByRole("link", { name: "Czech" }));
  await act(async () => {
    signedIn.resolve(false);
    await signedIn.promise;
  });

  await waitFor(() => expect(window.location.pathname).toBe("/cs-CZ"));
  expect(saves).toEqual([]);
});

// React hands a client component the server's streamed promise as a bare
// thenable: it has `then` and nothing else, so `catch` and `finally` are absent.
const bareThenable = <T,>(value: T): PromiseLike<T> => ({
  // biome-ignore lint/suspicious/noThenProperty: models React's streamed thenable.
  then: (onFulfilled, onRejected) =>
    Promise.resolve(value).then(onFulfilled, onRejected),
});

test("a signed-in switch with a streamed bare thenable saves, then navigates", async () => {
  const { LocaleSwitcherLinks } = await import("./locale-switcher-links");
  window.location.href = "http://localhost/en-US";
  const saves: { locale: string }[] = [];
  const signedIn = bareThenable(true);
  const view = render(
    <LocaleSwitcherLinks
      currentLocale="en-US"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      localePreference={{
        signedIn,
        save: (input) => {
          saves.push(input);
          return bareThenable(undefined);
        },
      }}
    />
  );
  await act(async () => {
    await signedIn;
  });

  const notPrevented = fireEvent.click(
    view.getByRole("link", { name: "Czech" })
  );

  expect(notPrevented).toBe(false);
  await waitFor(() => expect(window.location.pathname).toBe("/cs-CZ"));
  expect(saves).toEqual([{ locale: "cs-CZ" }]);
});
