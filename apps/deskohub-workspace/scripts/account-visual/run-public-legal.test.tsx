import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { playwrightChromiumAvailable } from "../../shared/testing/playwright-browser";
import {
  outputRoot,
  repoRoot,
  runRendererCli,
  writeRegressionReference,
} from "./run.test-utils";

const chromiumAvailable = await playwrightChromiumAvailable();

const assertPublicLegalCliRun = async ({
  adapterPath,
  label,
  locale,
}: {
  readonly adapterPath: string;
  readonly label: string;
  readonly locale: "en-US" | "cs-CZ";
}) => {
  await mkdir(outputRoot, { recursive: true });
  const directory = await mkdtemp(`${outputRoot}/account-visual-public-legal-`);
  try {
    const referencesDir = join(directory, "references");
    await writeRegressionReference(referencesDir);
    const report = await runRendererCli([
      "--label",
      label,
      "--screen",
      "legal",
      "--adapter",
      adapterPath,
      "--locale",
      locale,
      "--references",
      referencesDir,
      "--output",
      join(directory, "output"),
    ]);
    const execution = await Bun.file(
      join(report.outputDirectory, "execution.json")
    ).json();
    const sourceManifest = await Bun.file(
      join(report.outputDirectory, "source-manifest.json")
    ).json();
    const screen = report.screens[0]!;

    expect(report.execution).toMatchObject({ status: "passed" });
    expect(execution).toMatchObject({ status: "passed", findings: [] });
    expect(report.scope.bypasses).toEqual([
      "Build-time @/env alias supplies explicit undefined NEXT_PUBLIC_POSTHOG_HOST and NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN values for visual-only rendering; no real client environment or cookie stub is used.",
      "The actual local vanilla-cookieconsent library is initialized with createConsentConfig(locale) and autoShow=false; its banner and analytics runtime are omitted, screenshots precede consent interaction with the default state unmutated, and no fake consent state or external network is used.",
    ]);
    expect(screen.coverage).toMatchObject({
      status: "rendered",
      source: "production-account-shell",
      selection: "selected",
      component: "PublicAccountLegal",
    });
    expect(screen.coverage.note).toContain(
      "observed PublicAccountLegal component on the simulated public legal route"
    );
    expect(screen.coverage.note).toContain(
      "this visual fixture does not prove route or authentication behavior"
    );
    expect(screen.desktop.routeComponent).toBe("PublicAccountLegal");
    expect(screen.desktop.selection).toMatchObject({
      requestedScreen: "legal",
      status: "selected",
      method: "desktop-nav-button",
      selectedValue: "legal",
      selectedAriaCurrent: "page",
      targetSelector: "a[href$='/privacy-policy']",
      targetVisible: true,
    });

    const bundleInputPaths = sourceManifest.bundleInputs.map(
      ({ path }: { path: string }) => path
    );
    expect(bundleInputPaths).toEqual(
      expect.arrayContaining([
        relative(repoRoot, adapterPath),
        "apps/deskohub-workspace/features/account/components/public-account-legal.tsx",
        "apps/deskohub-workspace/features/cookie-consent/components/cookie-settings-page.tsx",
        "apps/deskohub-workspace/features/account/components/linked-account.tsx",
      ])
    );

    for (const width of ["320", "375"] as const) {
      const mobile = screen.mobile[width];
      expect(mobile.selection).toMatchObject({
        requestedScreen: "legal",
        status: "selected",
        method: "mobile-nav-button",
        selectedValue: "legal",
        selectedAriaCurrent: "page",
        targetSelector: "a[href$='/privacy-policy']",
        targetVisible: true,
      });
      expect(mobile.focusSelection).toMatchObject({
        requestedScreen: "legal",
        status: "selected",
        selectedValue: "legal",
        selectedAriaCurrent: "page",
        targetVisible: true,
      });
      expect(mobile.sectionNavigation).toEqual({
        status: "passed",
        method: "mobile-nav-button",
        requestedScreen: "legal",
        alternateScreen: "profile",
        selectedBefore: "legal",
        selectedAlternate: "profile",
        selectedAfter: "legal",
        failures: [],
      });
      expect(mobile.publicLegalNavigation).toEqual({
        status: "passed",
        simulation: "visual-fixture-only",
        authentication: "not-proved",
        legalPathname: `/${locale}/account/legal`,
        cookiePreferencesVisible: true,
        archiveDisabled: true,
        consentChanges: {
          analyticsEnabled: true,
          analyticsDisabled: true,
          acceptAll: true,
          rejectAll: true,
          persistedAfterRouteReturn: true,
        },
        returns: [
          {
            section: "profile",
            pathname: `/${locale}/account`,
            search: "?section=profile",
            selected: true,
            targetVisible: true,
            metadataScreen: "profile",
          },
          {
            section: "billing",
            pathname: `/${locale}/account`,
            search: "?section=billing",
            selected: true,
            targetVisible: true,
            metadataScreen: "billing",
          },
        ],
        failures: [],
      });
      expect(mobile.draftPersistence).toMatchObject({
        status: "passed",
        method: "fresh-real-page-mobile-menu",
        scope: "private-account-sections",
        submitted: false,
        firstName: "Ada Draft",
        companyName: "Example Draft s.r.o.",
        failures: [],
      });
      expect(mobile.draftPersistence.note).toBe(
        "Draft persistence is checked only across private account sections; drafts across the public legal route are not claimed."
      );
    }

    if (adapterPath.endsWith("populated-adapter.tsx")) {
      expect(report.nativeValidation).toMatchObject({
        status: "passed",
        method: "fresh-browser-context-native-request-submit",
        context: "fresh-context-after-original-capture",
      });
    } else {
      expect(report.nativeValidation).toBeNull();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test.serial.skipIf(!chromiumAvailable)(
  "default adapter captures the public legal route in English",
  async () => {
    await assertPublicLegalCliRun({
      adapterPath: join(import.meta.dir, "default-adapter.tsx"),
      label: "public-legal-default-en",
      locale: "en-US",
    });
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "default adapter captures the public legal route in Czech",
  async () => {
    await assertPublicLegalCliRun({
      adapterPath: join(import.meta.dir, "default-adapter.tsx"),
      label: "public-legal-default-cs",
      locale: "cs-CZ",
    });
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "populated adapter captures the public legal route in English",
  async () => {
    await assertPublicLegalCliRun({
      adapterPath: join(import.meta.dir, "populated-adapter.tsx"),
      label: "public-legal-populated-en",
      locale: "en-US",
    });
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "populated adapter captures the public legal route in Czech",
  async () => {
    await assertPublicLegalCliRun({
      adapterPath: join(import.meta.dir, "populated-adapter.tsx"),
      label: "public-legal-populated-cs",
      locale: "cs-CZ",
    });
  },
  120_000
);
