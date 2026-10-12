import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { workspaceSiteConstants } from "@/shared/utils";
import { FaqPage } from "./faq-page";

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

test("FAQ focus indicator has at least 3:1 contrast against its navy offset", async () => {
  const view = render(
    <FaqPage
      averageReservationsPerDay={1.2}
      coworkSeatCapacity={28}
      locale="en-US"
    />
  );
  const summary = view.container.querySelector("summary");
  expect(summary).toBeTruthy();

  const classes = summary?.className.split(/\s+/) ?? [];
  const focusRingColorClass = classes.find(
    (className) =>
      className.startsWith("focus-visible:ring-") &&
      className !== "focus-visible:ring-2" &&
      !className.startsWith("focus-visible:ring-offset-")
  );
  if (!focusRingColorClass) {
    throw new Error("FAQ summary is missing its focus ring color class.");
  }

  const focusRingToken = focusRingColorClass.slice(
    "focus-visible:ring-".length
  );
  const ringOffsetColor = summary?.className.match(
    /focus-visible:ring-offset-\[(#[\da-f]{6})\]/i
  )?.[1];
  if (!ringOffsetColor) {
    throw new Error("FAQ summary is missing its explicit navy ring offset.");
  }

  const styles = await readFile(
    join(import.meta.dir, "../../../app/globals.css"),
    "utf8"
  );
  expect(styles).toContain(
    `--color-${focusRingToken}: var(--brand-${focusRingToken});`
  );
  const focusRingColor = styles.match(
    new RegExp(`--brand-${focusRingToken}:\\s*(#[\\da-f]{6})\\s*;`, "i")
  )?.[1];
  if (!focusRingColor) {
    throw new Error(`FAQ focus ring token ${focusRingToken} has no hex color.`);
  }

  expect(
    colorContrastRatio(focusRingColor, ringOffsetColor)
  ).toBeGreaterThanOrEqual(3);
});

const questionMessages = [
  m.faqQuestionLocation,
  m.faqQuestionHowItWorks,
  m.faqQuestionInternet,
  m.faqQuestionFood,
  m.faqQuestionCalls,
  m.faqQuestionBusyness,
] as const;

test("renders six closed native FAQ disclosures", () => {
  const view = render(
    <FaqPage
      averageReservationsPerDay={1.2}
      coworkSeatCapacity={28}
      locale="en-US"
    />
  );

  expect(
    view.getByRole("heading", {
      level: 1,
      name: m.faqPageTitle({}, { locale: "en-US" }),
    })
  ).toBeTruthy();
  expect(
    view
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent)
  ).toEqual(
    questionMessages.map((message) => message({}, { locale: "en-US" }))
  );

  const disclosures = view.container.querySelectorAll("details");
  expect(disclosures).toHaveLength(6);
  for (const disclosure of disclosures) {
    expect(disclosure.hasAttribute("open")).toBe(false);
    // Browsers expose a first-child <summary> as a focusable disclosure
    // control only while it keeps its native role and tab order.
    const summary = disclosure.firstElementChild;
    expect(summary?.tagName).toBe("SUMMARY");
    expect(summary?.hasAttribute("role")).toBe(false);
    expect(summary?.hasAttribute("tabindex")).toBe(false);
    expect(summary?.querySelector("h2")).toBeTruthy();
    expect(summary?.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true"
    );
  }

  expect(view.container.querySelector("address")?.textContent).toContain(
    workspaceSiteConstants.location.address.street
  );
});

test("allows multiple native FAQ disclosures to stay open", () => {
  const view = render(
    <FaqPage
      averageReservationsPerDay={1.26}
      coworkSeatCapacity={28}
      locale="en-US"
    />
  );
  const disclosureFor = (question: string) => {
    const heading = view.getByRole("heading", { level: 2, name: question });
    return heading.closest("details") as HTMLDetailsElement;
  };
  const howItWorks = disclosureFor(
    m.faqQuestionHowItWorks({}, { locale: "en-US" })
  );
  const calls = disclosureFor(m.faqQuestionCalls({}, { locale: "en-US" }));
  const busyness = disclosureFor(
    m.faqQuestionBusyness({}, { locale: "en-US" })
  );

  fireEvent.click(howItWorks.querySelector("summary")!);
  fireEvent.click(calls.querySelector("summary")!);
  fireEvent.click(busyness.querySelector("summary")!);

  expect(howItWorks.open).toBe(true);
  expect(calls.open).toBe(true);
  expect(
    view.getByText(
      m.faqAnswerBusyness(
        { average: "1.3", capacity: "28" },
        { locale: "en-US" }
      )
    )
  ).toBeTruthy();

  fireEvent.click(howItWorks.querySelector("summary")!);

  expect(howItWorks.open).toBe(false);
  expect(calls.open).toBe(true);
  expect(busyness.open).toBe(true);
});

test("localizes Czech copy and formats the average with one decimal", () => {
  const view = render(
    <FaqPage
      averageReservationsPerDay={1}
      coworkSeatCapacity={28}
      locale="cs-CZ"
    />
  );

  expect(
    view.getByRole("heading", {
      level: 1,
      name: m.faqPageTitle({}, { locale: "cs-CZ" }),
    })
  ).toBeTruthy();
  const busyness = view
    .getByRole("heading", {
      level: 2,
      name: m.faqQuestionBusyness({}, { locale: "cs-CZ" }),
    })
    .closest("details") as HTMLDetailsElement;
  fireEvent.click(busyness.querySelector("summary")!);
  expect(busyness.open).toBe(true);
  expect(
    view.getByText(
      m.faqAnswerBusyness(
        { average: "1,0", capacity: "28" },
        { locale: "cs-CZ" }
      )
    )
  ).toBeTruthy();
});

function colorContrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string) {
  const [red, green, blue] = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );

  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}
