import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { playwrightChromiumAvailable } from "../../shared/testing/playwright-browser";
import {
  outputRoot,
  runRendererCli,
  writeRegressionReference,
} from "./run.test-utils";

const chromiumAvailable = await playwrightChromiumAvailable();

const writeRoundtripOverflowAdapter = async (directory: string) => {
  const path = join(directory, "roundtrip-overflow-adapter.tsx");
  const reactEntry = join(
    import.meta.dir,
    "../../node_modules/react/cjs/react.production.js"
  );
  await writeFile(
    path,
    `import { createElement, useState } from ${JSON.stringify(reactEntry)};

const sections = [
  ["profile", "Profile & Identity"],
  ["billing", "Billing & Invoices"],
  ["legal", "Legal & Privacy"],
  ["danger", "Danger zone"],
  ["reservations", "Reservations"],
];

export const accountVisualAdapterMetadata = {
  owner: "temporary roundtrip overflow adapter",
  fixture: "temporary production-shaped shell with initial overflow",
};

export default function RoundtripOverflowAdapter() {
  const [active, setActive] = useState("profile");
  const [visitedAlternate, setVisitedAlternate] = useState(false);
  const [firstName, setFirstName] = useState("Ada");
  const [companyName, setCompanyName] = useState("");
  const changeSection = (nextSection) => {
    if (nextSection !== "profile") setVisitedAlternate(true);
    setActive(nextSection);
  };
  const target =
    active === "profile"
       ? createElement(
           "div",
           { "data-screen": "profile-screen" },
           createElement(
             "form",
             { id: "account-profile-form" },
             createElement(
               "label",
               { htmlFor: "account-profile-first-name" },
               "First name"
             ),
             createElement("input", {
               id: "account-profile-first-name",
               onChange: (event) => setFirstName(event.currentTarget.value),
               required: true,
               value: firstName,
             })
           )
        )
      : active === "billing"
        ? createElement(
            "div",
            null,
            createElement(
              "select",
              { id: "account-profile-billing-kind", value: "business", onChange: () => {} },
              createElement("option", { value: "business" }, "Business")
            ),
            createElement("input", {
              id: "account-profile-billing-company-name",
              onChange: (event) => setCompanyName(event.currentTarget.value),
              value: companyName,
            })
          )
        : active === "legal"
          ? createElement("a", { href: "/en-US/privacy-policy" }, "Privacy")
          : active === "danger"
            ? createElement("button", { id: "delete-account-trigger", type: "button" }, "Delete")
            : createElement("h2", { id: "account-reservations-past-title" }, "Reservations");
  return createElement(
    "main",
    { style: { overflowX: "hidden", width: "100%" } },
    createElement(
      "nav",
      { "aria-label": "Account navigation" },
      sections.map(([key, label]) =>
        createElement(
          "button",
           {
             "aria-current": active === key ? "page" : undefined,
             key,
             onClick: () => changeSection(key),
             type: "button",
           },
          label
        )
      )
    ),
    createElement(
      "div",
      { "data-account-mobile-navigation": "" },
      sections.map(([key, label]) =>
        createElement(
          "button",
          {
            "aria-current": active === key ? "page" : undefined,
            "data-account-section": key,
            key,
            onClick: () => changeSection(key),
            type: "button",
          },
          label
        )
      )
    ),
    target,
    createElement("div", {
      style: {
        height: "1px",
        width: active === "profile" && !visitedAlternate ? "2200px" : "100%",
      },
    })
  );
}
`,
    "utf8"
  );
  return path;
};

type NavigationOverflow = "auto" | "scroll" | "hidden" | "clip";

const writeNavigationOverflowAdapter = async (
  directory: string,
  overflowX: NavigationOverflow,
  activeClipped = false
) => {
  const path = join(
    directory,
    `navigation-overflow-${overflowX}${activeClipped ? "-active-clipped" : ""}-adapter.tsx`
  );
  const reactEntry = join(
    import.meta.dir,
    "../../node_modules/react/cjs/react.production.js"
  );
  await writeFile(
    path,
    `import { createElement, useState } from ${JSON.stringify(reactEntry)};

const sections = [
  ["profile", "Profile & Identity"],
  ["billing", "Billing & Invoices"],
  ["legal", "Legal & Privacy"],
  ["danger", "Danger zone"],
  ["reservations", "Reservations"],
];

export const accountVisualAdapterMetadata = {
  owner: "temporary mobile navigation overflow adapter",
  fixture: ${JSON.stringify(`${overflowX} marked navigation${activeClipped ? " with clipped active section" : ""}`)},
};

export default function NavigationOverflowAdapter() {
  const [active, setActive] = useState("profile");
  const [firstName, setFirstName] = useState("Ada");
  const [companyName, setCompanyName] = useState("");
  const target =
    active === "profile"
      ? createElement(
          "div",
          { "data-screen": "profile-screen" },
          createElement(
            "form",
            { id: "account-profile-form" },
            createElement(
              "label",
              { htmlFor: "account-profile-first-name" },
              "First name"
            ),
            createElement("input", {
              id: "account-profile-first-name",
              onChange: (event) => setFirstName(event.currentTarget.value),
              required: true,
              value: firstName,
            })
          )
        )
      : active === "billing"
        ? createElement(
            "div",
            null,
            createElement(
              "select",
              {
                id: "account-profile-billing-kind",
                onChange: () => {},
                value: "business",
              },
              createElement("option", { value: "business" }, "Business")
            ),
            createElement("input", {
              id: "account-profile-billing-company-name",
              onChange: (event) => setCompanyName(event.currentTarget.value),
              value: companyName,
            })
          )
        : active === "legal"
          ? createElement("a", { href: "/en-US/privacy-policy" }, "Privacy")
          : active === "danger"
            ? createElement(
                "button",
                { id: "delete-account-trigger", type: "button" },
                "Delete"
              )
            : createElement(
                "h2",
                { id: "account-reservations-past-title" },
                "Reservations"
              );

  return createElement(
    "main",
    { style: { minHeight: "500px", width: "100%" } },
    createElement(
      "nav",
      { "aria-label": "Account navigation" },
      sections.map(([key, label]) =>
        createElement(
          "button",
          {
            "aria-current": active === key ? "page" : undefined,
            key,
            onClick: () => setActive(key),
            type: "button",
          },
          label
        )
      )
    ),
    createElement(
      "div",
      {
        "data-account-mobile-navigation": "",
        id: "navigation-overflow-nav",
        style: {
          display: "flex",
          gap: "8px",
          overflowX: ${JSON.stringify(overflowX)},
          width: "320px",
        },
      },
      sections.map(([key, label]) =>
        createElement(
          "button",
          {
            "aria-current": active === key ? "page" : undefined,
            "data-account-section": key,
            key,
            onClick: () => setActive(key),
            style: {
              flexShrink: 0,
              whiteSpace: "nowrap",
              ${activeClipped ? 'transform: key === "profile" ? "translateX(-16px)" : undefined,' : ""}
            },
            type: "button",
          },
          label
        )
      )
    ),
    target
  );
}
`,
    "utf8"
  );
  return path;
};

const writeViewportWidthOverflowAdapter = async (directory: string) => {
  const path = join(directory, "viewport-width-overflow-adapter.tsx");
  const reactEntry = join(
    import.meta.dir,
    "../../node_modules/react/cjs/react.production.js"
  );
  await writeFile(
    path,
    `import { createElement } from ${JSON.stringify(reactEntry)};

export const accountVisualAdapterMetadata = {
  owner: "temporary viewport overflow adapter",
  fixture: "viewport-width block with nowrap text",
};

export default function ViewportWidthOverflowAdapter() {
  return createElement(
    "main",
    { style: { width: "100%" } },
    createElement(
      "div",
      { style: { overflowX: "visible", whiteSpace: "nowrap", width: "100%" } },
      "This intentionally long unbroken line exceeds the viewport while its block box remains viewport-sized."
    ),
    createElement("a", { href: "?screen=legal" }, "Legal destination")
  );
}
`,
    "utf8"
  );
  return path;
};

test.serial.skipIf(!chromiumAvailable)(
  "captures initial mobile overflow before a roundtrip removes it",
  async () => {
    await mkdir(outputRoot, { recursive: true });
    const directory = await mkdtemp(`${outputRoot}/account-visual-roundtrip-`);
    const adapterDirectory = await mkdtemp(
      join(outputRoot, "account-visual-roundtrip-adapter-")
    );
    try {
      const referencesDir = join(directory, "references");
      await writeRegressionReference(referencesDir);
      const adapterPath = await writeRoundtripOverflowAdapter(adapterDirectory);
      const report = await runRendererCli([
        "--label",
        "roundtrip-overflow",
        "--screen",
        "profile",
        "--adapter",
        adapterPath,
        "--references",
        referencesDir,
        "--output",
        join(directory, "output"),
      ]);
      const screen = report.screens[0]!;
      const mobile = screen.mobile["375"];
      const execution = await Bun.file(
        join(report.outputDirectory, "execution.json")
      ).json();

      expect(report.execution.status).toBe("completed-with-findings");
      expect(mobile.selection).toMatchObject({
        status: "selected",
        method: "mobile-nav-button",
      });
      expect(mobile.sectionNavigation.status).toBe("passed");
      expect(mobile.horizontalOverflow.offenders).toEqual(
        expect.arrayContaining([expect.objectContaining({ tag: "main" })])
      );
      expect(execution.findings).toEqual(
        expect.arrayContaining([
          "profile mobile 375: 2 horizontal overflow offender(s)",
        ])
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(adapterDirectory, { recursive: true, force: true });
    }
  },
  120_000
);

for (const overflowX of ["auto", "scroll", "hidden", "clip"] as const) {
  test.serial.skipIf(!chromiumAvailable)(
    `only visible auto or scroll mobile navigation may clip inactive sections (${overflowX})`,
    async () => {
      await mkdir(outputRoot, { recursive: true });
      const directory = await mkdtemp(
        `${outputRoot}/account-visual-navigation-overflow-${overflowX}-`
      );
      const adapterDirectory = await mkdtemp(
        join(
          outputRoot,
          `account-visual-navigation-overflow-${overflowX}-adapter-`
        )
      );
      try {
        const referencesDir = join(directory, "references");
        await writeRegressionReference(referencesDir);
        const adapterPath = await writeNavigationOverflowAdapter(
          adapterDirectory,
          overflowX
        );
        const report = await runRendererCli([
          "--label",
          `navigation-overflow-${overflowX}`,
          "--screen",
          "profile",
          "--adapter",
          adapterPath,
          "--references",
          referencesDir,
          "--output",
          join(directory, "output"),
        ]);
        const screen = report.screens[0]!;
        const mobile = screen.mobile["375"];
        const execution = await Bun.file(
          join(report.outputDirectory, "execution.json")
        ).json();
        const navigationOverflow = mobile.horizontalOverflow.offenders.find(
          ({ id }) => id === "navigation-overflow-nav"
        );

        expect(mobile.selection.status).toBe("selected");
        expect(mobile.selection.selectedAriaCurrent).toBe("page");
        expect(mobile.sectionNavigation.status).toBe("passed");
        if (overflowX === "auto" || overflowX === "scroll") {
          expect(report.execution.status).toBe("passed");
          expect(mobile.initialDomProbe.failures).toEqual([]);
          expect(mobile.horizontalOverflow.offenders).toEqual([]);
          expect(execution.findings).toEqual([]);
        } else {
          expect(report.execution.status).toBe("completed-with-findings");
          expect(mobile.initialDomProbe.failures).toEqual(
            expect.arrayContaining([
              expect.stringContaining(
                "text range horizontally overflows the viewport"
              ),
            ])
          );
          expect(navigationOverflow).toMatchObject({ overflowX });
          expect(execution.findings).toEqual(
            expect.arrayContaining([
              expect.stringContaining("initial DOM probe"),
              expect.stringContaining("horizontal overflow offender"),
            ])
          );
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
        await rm(adapterDirectory, { recursive: true, force: true });
      }
    },
    120_000
  );
}

test.serial.skipIf(!chromiumAvailable)(
  "active mobile navigation section must remain fully visible",
  async () => {
    await mkdir(outputRoot, { recursive: true });
    const directory = await mkdtemp(
      `${outputRoot}/account-visual-navigation-active-clipped-`
    );
    const adapterDirectory = await mkdtemp(
      join(outputRoot, "account-visual-navigation-active-clipped-adapter-")
    );
    try {
      const referencesDir = join(directory, "references");
      await writeRegressionReference(referencesDir);
      const adapterPath = await writeNavigationOverflowAdapter(
        adapterDirectory,
        "auto",
        true
      );
      const report = await runRendererCli([
        "--label",
        "navigation-active-clipped",
        "--screen",
        "profile",
        "--adapter",
        adapterPath,
        "--references",
        referencesDir,
        "--output",
        join(directory, "output"),
      ]);
      const screen = report.screens[0]!;
      const mobile = screen.mobile["375"];

      expect(report.execution.status).toBe("completed-with-findings");
      expect(mobile.selection.status).toBe("failed");
      expect(mobile.selection.detail).toContain(
        "a fully visible active button"
      );
      expect(mobile.sectionNavigation.status).toBe("failed");
      expect(mobile.horizontalOverflow.offenders).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "navigation-overflow-nav" }),
        ])
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(adapterDirectory, { recursive: true, force: true });
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "fails on document overflow from a viewport-width nowrap block",
  async () => {
    await mkdir(outputRoot, { recursive: true });
    const directory = await mkdtemp(
      `${outputRoot}/account-visual-viewport-overflow-`
    );
    const adapterDirectory = await mkdtemp(
      join(outputRoot, "account-visual-viewport-overflow-adapter-")
    );
    try {
      const referencesDir = join(directory, "references");
      await writeRegressionReference(referencesDir);
      const adapterPath =
        await writeViewportWidthOverflowAdapter(adapterDirectory);
      const report = await runRendererCli([
        "--label",
        "viewport-width-overflow",
        "--screen",
        "profile",
        "--adapter",
        adapterPath,
        "--references",
        referencesDir,
        "--output",
        join(directory, "output"),
      ]);
      const screen = report.screens[0]!;
      const mobile = screen.mobile["375"];
      const execution = await Bun.file(
        join(report.outputDirectory, "execution.json")
      ).json();

      expect(mobile.horizontalOverflow.documentScrollWidth).toBeGreaterThan(
        mobile.horizontalOverflow.viewportWidth
      );
      expect(mobile.horizontalOverflow.bodyScrollWidth).toBeGreaterThan(
        mobile.horizontalOverflow.viewportWidth
      );
      expect(report.execution.status).toBe("completed-with-findings");
      expect(execution.findings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("document scrollWidth"),
          expect.stringContaining("body scrollWidth"),
        ])
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(adapterDirectory, { recursive: true, force: true });
    }
  },
  120_000
);
