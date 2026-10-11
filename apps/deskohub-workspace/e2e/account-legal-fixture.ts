import { afterAll, afterEach, beforeAll } from "bun:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type BrowserContext,
  type BrowserContextOptions,
  chromium,
} from "@playwright/test";
import postcss from "postcss";
import loadPostCssConfig from "postcss-load-config";
import type { Locale } from "@/features/i18n";

const fixtureParent = "/tmp/opencode";
const appRoot = resolve(import.meta.dir, "..");
const globalsCssPath = resolve(appRoot, "app/globals.css");
export const accountFixtureAuthHeader = "x-deskohub-account-fixture";
export const accountFixtureRolloutHeader = "x-deskohub-account-rollout";
export const accountFixtureMarketingLinkHeader = "x-deskohub-marketing-link";
export const accountFixtureRolloutOffValue = "off";
export const accountFixtureMarketingLinkValue = "pending";
export const supportedLocales = [
  "en-US",
  "cs-CZ",
] as const satisfies readonly Locale[];

export type Viewport = {
  readonly width: number;
  readonly height: number;
};

type AccountLegalBrowser = Awaited<ReturnType<typeof chromium.launch>>;
export type AccountLegalFixture = {
  readonly browser: AccountLegalBrowser;
  readonly contexts: Set<BrowserContext>;
  readonly serverUrl: string;
  readonly close: () => Promise<void>;
};

const packageJson = JSON.stringify(
  {
    private: true,
    scripts: { dev: "next dev" },
    type: "module",
  },
  null,
  2
);

const nextConfig = `
const nextConfig = {
  cacheComponents: true,
  cacheLife: {
    publicContent: { stale: 30, revalidate: 60, expire: 300 },
  },
  experimental: {
    instantInsights: {
      validationLevel: "manual-warning",
    },
  },
  partialPrefetching: true,
};

export default nextConfig;
`;

const localeLayout = (realCookieConsent: boolean) => `
import type { ReactNode } from "react";
import { FixtureHydration } from "@/fixture/hydration";
${
  realCookieConsent
    ? 'import { CookieConsentProvider } from "@/features/cookie-consent/components/cookie-consent-provider";\n'
    : ""
}import { UnsavedChangesProvider } from "@/shared/components/unsaved-changes-guard";
import "../globals.css";

export const instant = false;

export function generateStaticParams() {
  return [{ locale: "en-US" }, { locale: "cs-CZ" }];
}

type LocaleLayoutProps = {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  return (
    <html lang={locale} data-scroll-behavior="smooth">
      <body>
${
  realCookieConsent ? "        <CookieConsentProvider locale={locale} />\n" : ""
}        <UnsavedChangesProvider>
          <FixtureHydration>{children}</FixtureHydration>
        </UnsavedChangesProvider>
      </body>
    </html>
  );
}
`;

const syntheticConsentWaypointPage = `
import Link from "next/link";

export default function ConsentWaypointPage() {
  return (
    <main className="flex flex-col gap-4 px-6 pb-16 pt-40">
      <h1>Synthetic consent waypoint</h1>
      <p>Synthetic public navigation waypoint with no duplicated account UI.</p>
      <Link href="/en-US/account/legal">Back to public legal</Link>
    </main>
  );
}
`;

const fixtureSiteHeaderConfig = (contactHrefExpression: string) => `
import { isCustomerSignedIn } from "@/features/account/server/customer-session.server";
import type { Locale } from "@/features/i18n";

export type SiteHeaderAccountEntry = {
  readonly label: string;
  readonly href: Promise<string>;
  readonly signInHref: string;
};

export type SiteHeaderMenuItemId =
  | "locationMap"
  | "meetingRoom"
  | "office"
  | "gallery"
  | "founders"
  | "faqContact"
  | "contact";

export type SiteHeaderMenuItem = {
  readonly id: SiteHeaderMenuItemId;
  readonly label: string;
  readonly href: string;
};

export async function getSiteHeaderConfig(locale: Locale) {
  const localePath = "/" + locale;
  const links: SiteHeaderMenuItem[] = [
    {
      id: "locationMap",
      label: "Location",
      href: localePath + "#location-map",
    },
    {
      id: "meetingRoom",
      label: "Meeting room",
      href: localePath + "/meeting-room",
    },
    {
      id: "gallery",
      label: "Gallery",
      href: localePath + "/gallery",
    },
  ];

  return {
    account: {
      label: "Account",
      href: isCustomerSignedIn()
        .catch(() => false)
        .then((signedIn) =>
          signedIn ? localePath + "/account" : localePath + "/auth/sign-in"
        ),
      signInHref: localePath + "/auth/sign-in",
    } satisfies SiteHeaderAccountEntry,
    closeNavigationMenuLabel: "Close navigation menu",
    contactHref: ${contactHrefExpression},
    contactLabel: "Contact",
    languageLabels: {
      "cs-CZ": "Čeština",
      "en-US": "English",
    } satisfies Record<Locale, string>,
    languageSwitcherLabel: "Language",
    links,
    mobilePrimaryNavigationLabel: "Mobile primary navigation",
    openNavigationMenuLabel: "Open navigation menu",
    primaryNavigationLabel: "Primary navigation",
  };
}
`;

const fixtureAuthentication = `
import { Context, Effect, Layer } from "effect";
import { headers } from "next/headers";

type FixtureUser = {
  readonly fixture: true;
};

interface FixtureAuthentication {
  readonly currentUser: Effect.Effect<FixtureUser | null>;
}

export class CustomerAuthentication extends Context.Service<
  CustomerAuthentication,
  FixtureAuthentication
>()("@deskohub-workspace/account/CustomerAuthentication") {
  static Default = Layer.succeed(this, {
    currentUser: Effect.promise(async () => {
      const requestHeaders = await headers();
      return requestHeaders.get("x-deskohub-account-fixture") === "private"
        ? { fixture: true }
        : null;
    }),
  });
}
`;

const fixtureAccountFeatureFlag = `
import { headers } from "next/headers";

export async function areAccountsEnabled(): Promise<boolean> {
  const requestHeaders = await headers();
  return requestHeaders.get("${accountFixtureRolloutHeader}") !== "${accountFixtureRolloutOffValue}";
}
`;

const fixtureMarketingPreferences = `
import { headers } from "next/headers";
import type { Locale } from "@/features/i18n";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";

export async function getMarketingPreferences(
  _locale: Locale
): Promise<MarketingPreferencesState> {
  const requestHeaders = await headers();
  if (
    requestHeaders.get("${accountFixtureMarketingLinkHeader}") !==
    "${accountFixtureMarketingLinkValue}"
  ) {
    return { status: "unavailable" };
  }

  return {
    context: "synthetic-marketing-management-context",
    dismissalContext: "synthetic-marketing-management-dismissal-context",
    status: "pending-link",
  };
}
`;

const fixtureMarketingActionError =
  "Unavailable in account continuity fixture: backend action was not executed.";

const fixtureMarketingActions = `
"use server";

type UnavailableActionResult = {
  readonly serverError: string;
};

const unavailableMessage = "${fixtureMarketingActionError}";

export async function saveMarketingPreferencesAction(
  _input: unknown
): Promise<UnavailableActionResult> {
  return { serverError: unavailableMessage };
}

export async function confirmMarketingManagementAction(
  _input: unknown
): Promise<UnavailableActionResult> {
  return { serverError: unavailableMessage };
}

export async function clearMarketingManagementAction(
  _input: unknown
): Promise<UnavailableActionResult> {
  return { serverError: unavailableMessage };
}
`;

const fixtureWorkspaceEffect = `
import { Effect } from "effect";

export const runWorkspaceEffect =
  (_name: string, _options?: unknown) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(effect as Effect.Effect<A, never, never>);
`;

const fixtureEnv = `
export const env = {
  NEXT_PUBLIC_POSTHOG_HOST: undefined,
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: undefined,
} as const;
`;

const fixtureCookieConsent = `
export type ConsentCategory = "necessary" | "analytics" | "marketing" | "preferences";

export function useCookieConsent() {
  return {
    acceptAll: () => undefined,
    acceptCategory: (_category: ConsentCategory) => undefined,
    isAccepted: (_category: ConsentCategory) => false,
    rejectAll: () => undefined,
    rejectCategory: (_category: ConsentCategory) => undefined,
  };
}
`;

const fixtureHydration = `
"use client";

import { type ReactNode, useEffect } from "react";

export function FixtureHydration({ children }: { readonly children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.fixtureHydrated = "true";
  }, []);

  return children;
}
`;

const privatePage = `
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountContentLoading } from "@/features/account/components/account-loading";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

export default function SyntheticPrivateAccountPage() {
  return runWithRequestLocale((locale) => (
    <Suspense fallback={<AccountContentLoading locale={locale} />}>
      <SyntheticPrivateContent />
    </Suspense>
  ));
}

async function SyntheticPrivateContent() {
  await connection();
  await headers();

  return (
    <section data-testid="synthetic-private-content" aria-labelledby="synthetic-private-title">
      <h2 id="synthetic-private-title">Synthetic private profile</h2>
      <p>Private page data is synthetic and provider-independent.</p>
    </section>
  );
}
`;

const nullModalPage = `
export default function AccountModal() {
  return null;
}
`;

type AccountLegalFixtureOptions = {
  readonly realCookieConsent?: boolean;
};

const writeFixture = async (
  fixtureRoot: string,
  { realCookieConsent = false }: AccountLegalFixtureOptions = {}
) => {
  const fixtureFiles: Readonly<Record<string, string>> = {
    "app/[locale]/(full-header)/account/@modal/default.tsx": nullModalPage,
    "app/[locale]/(full-header)/account/@modal/page.tsx": nullModalPage,
    "app/[locale]/(full-header)/account/page.tsx": privatePage,
    ...(realCookieConsent
      ? {
          "app/[locale]/(full-header)/consent-waypoint/page.tsx":
            syntheticConsentWaypointPage,
        }
      : {}),
    "app/[locale]/layout.tsx": localeLayout(realCookieConsent),
    "fixture/account-feature-flag.server.ts": fixtureAccountFeatureFlag,
    "fixture/customer-authentication.service.ts": fixtureAuthentication,
    ...(realCookieConsent
      ? {}
      : { "fixture/cookie-consent.ts": fixtureCookieConsent }),
    "fixture/env.ts": fixtureEnv,
    "fixture/hydration.tsx": fixtureHydration,
    "fixture/marketing-actions.ts": fixtureMarketingActions,
    "fixture/marketing-preferences.server.ts": fixtureMarketingPreferences,
    "fixture/site-header-config.ts": fixtureSiteHeaderConfig(
      realCookieConsent
        ? 'localePath + "/consent-waypoint"'
        : 'localePath + "/contact"'
    ),
    "fixture/workspace-effect.ts": fixtureWorkspaceEffect,
    "instrumentation.ts": "export function register() {}",
    "next.config.mjs": nextConfig,
    "package.json": packageJson,
  };

  for (const [relativePath, contents] of Object.entries(fixtureFiles)) {
    const filePath = join(fixtureRoot, relativePath);
    await mkdir(resolve(filePath, ".."), { recursive: true });
    if (contents) await writeFile(filePath, contents);
  }

  const tsconfig = {
    compilerOptions: {
      allowJs: true,
      baseUrl: ".",
      esModuleInterop: true,
      isolatedModules: true,
      jsx: "preserve",
      lib: ["dom", "dom.iterable", "esnext"],
      module: "esnext",
      moduleResolution: "bundler",
      noEmit: true,
      paths: {
        "@/features/account/server/account-feature-flag.server": [
          "./fixture/account-feature-flag.server.ts",
        ],
        "@/features/account/backend/customer-authentication.service": [
          "./fixture/customer-authentication.service.ts",
        ],
        "@/env": ["./fixture/env.ts"],
        ...(realCookieConsent
          ? {}
          : { "@/features/cookie-consent": ["./fixture/cookie-consent.ts"] }),
        "@/features/legal/marketing-preferences.server": [
          "./fixture/marketing-preferences.server.ts",
        ],
        "@/features/legal/actions": ["./fixture/marketing-actions.ts"],
        "@/shared/backend/workspace-effect": ["./fixture/workspace-effect.ts"],
        "@/shared/components/site-header-config": [
          "./fixture/site-header-config.ts",
        ],
        "@/*": ["./*"],
      },
      plugins: [{ name: "next" }],
      resolveJsonModule: true,
      skipLibCheck: true,
      strict: true,
      target: "ES2017",
    },
  };
  await writeFile(join(fixtureRoot, "tsconfig.json"), JSON.stringify(tsconfig));

  for (const relativePath of [
    "app/[locale]/(full-header)/account/layout.tsx",
    "app/[locale]/(full-header)/account/loading.tsx",
    "app/[locale]/(full-header)/account/legal/page.tsx",
    "app/[locale]/(full-header)/layout.tsx",
  ]) {
    const destination = join(fixtureRoot, relativePath);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await copyFile(join(appRoot, relativePath), destination);
  }

  const postCssConfig = await loadPostCssConfig({}, appRoot);
  const globalsCss = await readFile(globalsCssPath, "utf8");
  const compiledGlobalsCss = await postcss(postCssConfig.plugins).process(
    globalsCss,
    { from: globalsCssPath }
  );
  const compiledGlobalsDestination = join(fixtureRoot, "app/globals.css");
  await mkdir(resolve(compiledGlobalsDestination, ".."), { recursive: true });
  await writeFile(compiledGlobalsDestination, compiledGlobalsCss.css);

  await symlink(join(appRoot, "assets"), join(fixtureRoot, "assets"), "dir");
  await symlink(
    join(appRoot, "features"),
    join(fixtureRoot, "features"),
    "dir"
  );
  await symlink(
    join(appRoot, "node_modules"),
    join(fixtureRoot, "node_modules"),
    "dir"
  );
  await symlink(join(appRoot, "shared"), join(fixtureRoot, "shared"), "dir");
};

const waitForServer = async (
  url: string,
  exited: { value: boolean },
  timeoutMs = 20_000
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited.value)
      throw new Error("account legal fixture server exited early");
    try {
      const response = await fetch(url, {
        headers: { [accountFixtureAuthHeader]: "private" },
      });
      if (response.status < 500) return;
    } catch {
      // The Next development server is still compiling or binding its port.
    }
    await Bun.sleep(100);
  }
  throw new Error("account legal fixture server did not become ready");
};

const waitForServerToStop = async (url: string) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error("account legal fixture server did not release its port");
};

const warmFixtureRoutes = async (
  serverUrl: string,
  extraRoutes: readonly string[] = []
) => {
  for (const locale of supportedLocales) {
    for (const route of [
      `/${locale}/account?section=profile`,
      `/${locale}/account/legal`,
      ...extraRoutes,
    ]) {
      const response = await fetch(`${serverUrl}${route}`, {
        headers: { [accountFixtureAuthHeader]: "private" },
      });
      if (!response.ok) {
        throw new Error("account legal fixture route failed during warmup");
      }
      await response.arrayBuffer();
    }
  }
};

export const openFixtureContext = async (
  fixture: AccountLegalFixture,
  options: BrowserContextOptions
) => {
  const context = await fixture.browser.newContext(options);
  fixture.contexts.add(context);
  return context;
};

export const closeFixtureContext = async (
  fixture: AccountLegalFixture,
  context: BrowserContext
) => {
  fixture.contexts.delete(context);
  await context.close();
};

const closeRemainingFixtureContexts = async (contexts: Set<BrowserContext>) => {
  const remainingContexts = [...contexts];
  contexts.clear();
  await Promise.allSettled(remainingContexts.map((context) => context.close()));
};

const accountFixtureStartupTimeout = 180_000;
export const accountFixtureCaseTimeout = 90_000;

const startAccountLegalFixture = async ({
  port,
  realCookieConsent = false,
}: AccountLegalFixtureOptions & {
  readonly port: number;
}): Promise<AccountLegalFixture> => {
  await mkdir(fixtureParent, { recursive: true });
  const fixtureRoot = await mkdtemp(
    join(fixtureParent, "deskohub-account-legal-")
  );
  const serverUrl = `http://localhost:${port}`;
  const exited = { value: false };
  const contexts = new Set<BrowserContext>();
  let server: ReturnType<typeof Bun.spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let serverReady = false;
  let closePromise: Promise<void> | undefined;

  const close = async () => {
    if (closePromise !== undefined) return closePromise;

    closePromise = (async () => {
      await closeRemainingFixtureContexts(contexts);
      try {
        await browser?.close();
      } catch {
        // Cleanup must continue if a failed test already closed the browser.
      }

      try {
        if (server) {
          if (!exited.value) server.kill();
          await server.exited;
          if (serverReady)
            await waitForServerToStop(`${serverUrl}/en-US/account`);
        }
      } finally {
        await rm(fixtureRoot, { force: true, recursive: true });
      }
    })();

    return closePromise;
  };

  try {
    await writeFixture(fixtureRoot, { realCookieConsent });
    const nextCli = resolve(appRoot, "node_modules/next/dist/bin/next");
    server = Bun.spawn(
      ["node", nextCli, "dev", "--webpack", "--port", String(port)],
      {
        cwd: fixtureRoot,
        env: {
          HOME: process.env.HOME ?? "/tmp",
          NEXT_TELEMETRY_DISABLED: "1",
          PATH: process.env.PATH ?? "",
        },
        stderr: "inherit",
        stdout: "inherit",
      }
    );
    void server.exited.then(() => {
      exited.value = true;
    });

    await waitForServer(
      `${serverUrl}/en-US/account?section=profile`,
      exited,
      accountFixtureStartupTimeout
    );
    serverReady = true;
    await warmFixtureRoutes(
      serverUrl,
      realCookieConsent
        ? supportedLocales.map((locale) => `/${locale}/consent-waypoint`)
        : []
    );
    const launchedBrowser = await chromium.launch({ headless: true });
    browser = launchedBrowser;

    return {
      browser: launchedBrowser,
      close,
      contexts,
      serverUrl,
    };
  } catch (error) {
    await close();
    throw error;
  }
};

const requireFixture = (fixture: AccountLegalFixture | undefined) => {
  if (fixture === undefined) {
    throw new Error("account legal fixture did not start");
  }
  return fixture;
};

/**
 * Starts one account legal fixture for the enclosing describe block, closes
 * browser contexts a test left open, and returns an accessor for the started
 * fixture. Each test file passes its own dev server port.
 */
export const registerAccountLegalFixture = (
  options: AccountLegalFixtureOptions & { readonly port: number }
) => {
  let fixture: AccountLegalFixture | undefined;

  beforeAll(async () => {
    fixture = await startAccountLegalFixture(options);
  }, accountFixtureStartupTimeout);

  afterEach(async () => {
    if (fixture) await closeRemainingFixtureContexts(fixture.contexts);
  });

  afterAll(async () => {
    const currentFixture = fixture;
    fixture = undefined;
    await currentFixture?.close();
  });

  return () => requireFixture(fixture);
};
