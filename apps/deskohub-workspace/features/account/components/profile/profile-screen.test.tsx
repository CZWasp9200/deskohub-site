import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Input } from "@/shared/components/ui/input";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { ProfileScreenCopy, ProfileScreenProps } from "./profile-screen";
import { ProfileScreen } from "./profile-screen";

const englishCopy: ProfileScreenCopy = {
  emailLabel: "Email",
  emailVerification: {
    unverified: "This email still needs verification.",
    verified: "This email has been successfully verified.",
  },
  languageLabel: "Preferred communication language",
  languageUnavailableValue: "Not set",
  memberFallback: "Workspace member",
  title: "Member profile and settings",
  verifiedEmail: "Verified login email",
};

const czechCopy: ProfileScreenCopy = {
  emailLabel: "E-mail",
  emailVerification: {
    unverified: "Tento e-mail stále vyžaduje ověření.",
    verified: "Tento e-mail byl úspěšně ověřen.",
  },
  languageLabel: "Preferovaný komunikační jazyk",
  languageUnavailableValue: "Nenastaveno",
  memberFallback: "Člen Workspace",
  title: "Profil a nastavení",
  verifiedEmail: "Ověřený přihlašovací e-mail",
};

const formerLanguageUnavailableDescriptions = {
  "en-US": "Language preferences are not saved yet.",
  "cs-CZ": "Preference jazyka se zatím neukládají.",
} as const;

const profileFields = (
  <>
    <div>
      <label htmlFor="profile-first-name">First name</label>
      <Input
        id="profile-first-name"
        name="firstName"
        required
        type="text"
        variant="error"
      />
    </div>
    <div>
      <label htmlFor="profile-last-name">Last name</label>
      <Input id="profile-last-name" name="lastName" type="text" />
    </div>
    <div>
      <label htmlFor="profile-phone">Phone</label>
      <Input id="profile-phone" name="phone" type="tel" />
    </div>
  </>
);

function renderProfile(overrides: Partial<ProfileScreenProps> = {}): string {
  return renderToStaticMarkup(
    <ProfileScreen
      {...overrides}
      copy={overrides.copy ?? englishCopy}
      email={overrides.email ?? "ada@example.test"}
      firstName={overrides.firstName ?? "Ada"}
      lastName={
        "lastName" in overrides ? (overrides.lastName ?? null) : "Lovelace"
      }
      locale={overrides.locale ?? "en-US"}
      footer={
        "footer" in overrides ? (
          overrides.footer
        ) : (
          <button type="button">Save profile</button>
        )
      }
    >
      {overrides.children ?? profileFields}
    </ProfileScreen>
  );
}

describe("ProfileScreen", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(cleanup);

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("renders the caller fields and footer without owning a form", () => {
    const markup = renderProfile();

    expect(markup).toContain('data-slot="account-section-panel"');
    expect(markup).toContain("Member profile and settings");
    expect(markup).toContain("Ada Lovelace");
    expect(markup).toContain("Save profile");
    expect(markup).not.toMatch(/<form\b/);

    const namedControls = [...markup.matchAll(/\bname="([^"]+)"/g)].map(
      (match) => match[1]
    );
    expect(namedControls).toEqual(["firstName", "lastName", "phone"]);
    expect(markup).not.toMatch(/name="(?:email|language)"/);
  });

  test("renders a provided footer once", () => {
    const markup = renderProfile({
      footer: <span data-footer-marker="profile-footer">Save profile</span>,
    });

    expect(
      markup.match(/data-footer-marker="profile-footer"/g) ?? []
    ).toHaveLength(1);
  });

  test("omits the optional footer when it is not provided", () => {
    const markup = renderProfile({ footer: undefined });

    expect(markup).not.toContain("data-footer-marker");
    expect(markup).not.toContain("pb-[max(1rem,env(safe-area-inset-bottom))]");
  });

  test("keeps the login email visual, verified, and non-editable", () => {
    const markup = renderProfile();

    expect(markup).toContain("ada@example.test");
    expect(markup).toContain("break-all");
    expect(markup).toContain("Verified login email");
    expect(markup).toContain("<fieldset");
    const emailFieldset = markup.match(
      /<legend[^>]*id="[^"]+-email-label">Email<\/legend>/
    );
    expect(emailFieldset).toBeTruthy();
    expect(markup).not.toContain(
      "This verified address cannot be changed here."
    );
    expect(markup).not.toMatch(/id="[^"]+-email-description"/);
    const emailFieldsetElement = markup.match(
      /<fieldset[^>]*aria-labelledby="[^"]+-email-label"[^>]*>/
    )?.[0];
    expect(emailFieldsetElement).toBeDefined();
    expect(emailFieldsetElement).not.toContain("aria-describedby");
    expect(markup).not.toMatch(/<span[^>]*aria-label="Verified login email"/);
    expect(markup).not.toMatch(/name="email"/);
    expect(markup).not.toMatch(/<input[^>]*ada@example\.test/);
  });

  test("renders a provided avatar slot", () => {
    const markup = renderProfile({
      avatar: <span data-avatar-marker="avatar-slot" />,
    });

    expect(markup).toContain('data-avatar-marker="avatar-slot"');
  });

  test("renders the unavailable language control as a disabled localized combobox", () => {
    for (const [locale, copy] of [
      ["en-US", englishCopy],
      ["cs-CZ", czechCopy],
    ] as const) {
      const view = render(
        <form data-testid="profile-form">
          <ProfileScreen
            copy={copy}
            email="ada@example.test"
            firstName="Ada"
            footer={<button type="button">Save profile</button>}
            lastName="Lovelace"
            locale={locale}
          >
            {profileFields}
          </ProfileScreen>
        </form>
      );
      const languageTrigger = view.getByRole("combobox", {
        name: copy.languageLabel,
      });
      const languageWrapper =
        languageTrigger.closest<HTMLElement>('[role="group"]');
      const nativeSelect = view.container.querySelector<HTMLSelectElement>(
        'select[aria-hidden="true"]'
      );

      for (const description of Object.values(
        formerLanguageUnavailableDescriptions
      )) {
        expect(view.queryByText(description)).toBeNull();
      }
      expect(languageTrigger.getAttribute("data-slot")).toBe("select-trigger");
      expect(languageTrigger.tagName).toBe("BUTTON");
      expect((languageTrigger as HTMLButtonElement).disabled).toBe(true);
      expect(languageWrapper).not.toBeNull();
      expect(languageTrigger.textContent).toContain(
        copy.languageUnavailableValue
      );
      expect(view.getByLabelText(copy.languageLabel)).toBe(languageTrigger);
      expect(languageTrigger.getAttribute("aria-describedby")).toBeNull();
      expect(
        view.getByRole("button", { name: copy.emailVerification.verified })
      ).toBeTruthy();
      expect(nativeSelect).not.toBeNull();
      expect(nativeSelect?.disabled).toBe(true);

      const form = view.getByTestId("profile-form") as HTMLFormElement;
      expect([...new FormData(form).keys()]).not.toContain("language");

      fireEvent.click(languageTrigger);
      fireEvent.keyDown(languageTrigger, { key: "ArrowDown" });

      expect(view.queryByRole("listbox")).toBeNull();
      expect(languageTrigger.textContent).toContain(
        copy.languageUnavailableValue
      );
      cleanup();
    }
  });

  test("uses real Unicode code points in the display name", () => {
    const unicodeMarkup = renderProfile({
      firstName: "  𐐀da",
      lastName: "😀ski  ",
    });
    expect(unicodeMarkup).toContain("𐐀da 😀ski");
    expect(unicodeMarkup).not.toContain("�");

    const fallbackMarkup = renderProfile({ firstName: "  ", lastName: null });
    expect(fallbackMarkup).toContain("Workspace member");
    expect(fallbackMarkup).not.toContain(">WM<");
  });

  test("does not invent membership claims", () => {
    const markup = renderProfile({
      copy: czechCopy,
      firstName: "",
      lastName: null,
      locale: "cs-CZ",
    });

    expect(markup).not.toMatch(/member since|Prague|Czechia|turnstile|access/i);
  });
});
