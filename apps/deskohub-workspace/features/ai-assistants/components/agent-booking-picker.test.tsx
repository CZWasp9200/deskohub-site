import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  flushWorkspaceComponentWork,
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { customerMcpServerUrl } = await import(
  "@/features/account/customer-agent-routes"
);
const { agentBookingAssistants, getAgentBookingInstruction, getAssistantName } =
  await import("../agent-booking-assistants");
const { AgentBookingHeroLink } = await import("./agent-booking-hero-link");
const { AgentBookingBanner } = await import("./agent-booking-banner");

const locale = "cs-CZ";
let phone = false;
const writeText = mock(async (_text: string) => {});

beforeEach(() => {
  phone = false;
  writeText.mockReset();
  writeText.mockImplementation(async () => {});
  window.matchMedia = ((query: string) => ({
    matches: phone,
    media: query,
  })) as typeof window.matchMedia;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const statusTexts = (view: ReturnType<typeof render>) =>
  view.getAllByRole("status").map((region) => region.textContent);

const openPicker = async () => {
  const view = render(<AgentBookingHeroLink locale={locale} />);
  const opener = view.getByRole("button", {
    name: m.agentBookingHeroLink({}, { locale }),
  });
  fireEvent.click(opener);
  await flushWorkspaceComponentWork();
  return { view, opener, picker: view.getByRole("dialog") };
};

test("offers each assistant as a new-tab link carrying the instruction", async () => {
  const { view } = await openPicker();

  for (const assistant of agentBookingAssistants) {
    const tile = view.getByRole("link", {
      name: m.agentBookingOpenInAssistant(
        { assistant: getAssistantName(assistant) },
        { locale }
      ),
    });
    expect(tile.getAttribute("target")).toBe("_blank");
    expect(tile.getAttribute("rel")).toContain("noopener");
    expect(new URL(tile.getAttribute("href") ?? "").searchParams.get("q")).toBe(
      getAgentBookingInstruction(locale)
    );
  }
});

test("opens as a dialog on wide screens and as a swipeable bottom sheet on phones", async () => {
  const wide = await openPicker();
  expect(wide.picker.querySelector("[class*='cursor-grab']")).toBeNull();
  cleanup();

  phone = true;
  const narrow = await openPicker();
  expect(narrow.picker.querySelector("[class*='cursor-grab']")).not.toBeNull();
});

test("copies the instruction and the MCP server URL and reports each copy", async () => {
  const { view } = await openPicker();

  await act(async () => {
    fireEvent.click(
      view.getByRole("button", {
        name: m.agentBookingCopyInstruction({}, { locale }),
      })
    );
  });
  expect(writeText).toHaveBeenLastCalledWith(
    getAgentBookingInstruction(locale)
  );
  expect(statusTexts(view)).toContain(
    m.agentBookingInstructionCopied({}, { locale })
  );

  await act(async () => {
    fireEvent.click(
      view.getByRole("button", {
        name: m.agentBookingCopyMcpServerUrl({}, { locale }),
      })
    );
  });
  expect(writeText).toHaveBeenLastCalledWith(customerMcpServerUrl);
  expect(statusTexts(view)).toContain(
    m.agentBookingMcpServerUrlCopied({}, { locale })
  );
});

test("reports a copy the browser refuses", async () => {
  writeText.mockImplementation(async () => {
    throw new Error("denied");
  });
  const { view } = await openPicker();

  await act(async () => {
    fireEvent.click(
      view.getByRole("button", {
        name: m.agentBookingCopyInstruction({}, { locale }),
      })
    );
  });

  expect(statusTexts(view)).toContain(m.agentBookingCopyFailed({}, { locale }));
});

test("closes on Escape and returns focus to the opener", async () => {
  const { view, opener, picker } = await openPicker();

  fireEvent.keyDown(picker, { key: "Escape" });
  await flushWorkspaceComponentWork();

  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test("returns focus to the banner's other opener when a resize hid the one used", async () => {
  const view = render(<AgentBookingBanner locale={locale} />);
  const [phoneOpener, wideOpener] = view.getAllByRole("button", {
    name: m.agentBookingChooseAssistant({}, { locale }),
  });
  if (!phoneOpener || !wideOpener)
    throw new Error("The banner has two openers.");

  fireEvent.click(wideOpener);
  await flushWorkspaceComponentWork();
  wideOpener.style.display = "none";
  fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
  await flushWorkspaceComponentWork();

  expect(document.activeElement).toBe(phoneOpener);
});

test("the copied state resets after a moment, so a later copy is announced again", async () => {
  const { view } = await openPicker();
  const copiedLabel = m.agentBookingInstructionCopied({}, { locale });
  const copyInstruction = () =>
    act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.agentBookingCopyInstruction({}, { locale }),
        })
      );
    });

  await copyInstruction();
  expect(statusTexts(view)).toContain(copiedLabel);

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2100));
  });
  expect(statusTexts(view)).not.toContain(copiedLabel);
  view.getByRole("button", {
    name: m.agentBookingCopyInstruction({}, { locale }),
  });

  await copyInstruction();
  expect(statusTexts(view)).toContain(copiedLabel);
});
