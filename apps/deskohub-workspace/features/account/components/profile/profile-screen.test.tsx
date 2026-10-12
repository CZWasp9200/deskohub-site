import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  act,
  cleanup,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { type Locale, m } from "@/features/i18n";
import { Input } from "@/shared/components/ui/input";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { ProfileScreenCopy, ProfileScreenProps } from "./profile-screen";

let ProfileScreen: (props: ProfileScreenProps) => React.ReactNode;

type LanguageActionResult = {
  readonly data?: { readonly status?: string };
  readonly serverError?: string;
};

// The real shared locale switch runs; only its Server Action is replaced.
const updateLocalePreference = mock(
  (_input: { locale: Locale }): Promise<LanguageActionResult> =>
    Promise.resolve({ data: { status: "saved" } })
);

mock.module("@/features/account/actions", () => ({
  updateLocalePreference,
}));

registerWorkspaceComponentTestEnv();
({ ProfileScreen } = await import("./profile-screen"));

const adaAddress = testEmailAddress("ada");

const englishCopy: ProfileScreenCopy = {
  emailLabel: "Email",
  emailVerification: {
    unverified: "This email still needs verification.",
    verified: "This email has been successfully verified.",
  },
  languageLabel: "Preferred language",
  languageOptionCs: "Čeština",
  languageOptionEn: "English (US)",
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
  languageLabel: "Preferovaný jazyk",
  languageOptionCs: "Čeština",
  languageOptionEn: "English (US)",
  memberFallback: "Člen Workspace",
  title: "Profil a nastavení",
  verifiedEmail: "Ověřený přihlašovací e-mail",
};

test("keeps the compiled catalog copy in sync with the component copy fixtures", () => {
  for (const [locale, copy] of [
    ["en-US", englishCopy],
    ["cs-CZ", czechCopy],
  ] as const) {
    expect(m.accountProfileScreenLanguageLabel({}, { locale })).toBe(
      copy.languageLabel
    );
    expect(m.accountProfileScreenLanguageOptionCs({}, { locale })).toBe(
      copy.languageOptionCs
    );
    expect(m.accountProfileScreenLanguageOptionEn({}, { locale })).toBe(
      copy.languageOptionEn
    );
  }
});

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
      email={overrides.email ?? adaAddress}
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
  });

  test("keeps the login email visual, verified, and non-editable", () => {
    const markup = renderProfile();

    expect(markup).toContain(adaAddress);
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
    expect(markup).not.toMatch(
      new RegExp(`<input[^>]*${adaAddress.replaceAll(".", "\\.")}`)
    );
  });

  test("renders a provided avatar slot", () => {
    const markup = renderProfile({
      avatar: <span data-avatar-marker="avatar-slot" />,
    });

    expect(markup).toContain('data-avatar-marker="avatar-slot"');
  });

  const renderLanguageControl = (
    locale: Locale = "en-US",
    copy: ProfileScreenCopy = englishCopy
  ) =>
    render(
      <ProfileScreen
        copy={copy}
        email={adaAddress}
        firstName="Ada"
        lastName="Lovelace"
        locale={locale}
      >
        {profileFields}
      </ProfileScreen>
    );

  const languageTrigger = (
    view: RenderResult,
    copy: ProfileScreenCopy = englishCopy
  ) => view.getByRole("combobox", { name: copy.languageLabel });

  const openLanguageListbox = async (
    view: RenderResult,
    copy: ProfileScreenCopy = englishCopy
  ) => {
    await act(async () => {
      fireEvent.keyDown(languageTrigger(view, copy), { key: "Enter" });
    });
    return view.findByRole("listbox");
  };

  const chooseLanguage = async (view: RenderResult, name: string) => {
    await openLanguageListbox(view);
    const option = view.getByRole("option", { name });
    await act(async () => {
      option.focus();
    });
    await act(async () => {
      fireEvent.keyDown(option, { key: "Enter" });
    });
  };

  beforeEach(() => {
    updateLocalePreference.mockReset();
    updateLocalePreference.mockImplementation(() =>
      Promise.resolve({ data: { status: "saved" } })
    );
    window.location.href = "http://localhost/en-US/account?section=profile";
  });

  test("shows the page locale as the selected language", async () => {
    for (const [locale, copy, label] of [
      ["en-US", englishCopy, "English (US)"],
      ["cs-CZ", czechCopy, "Čeština"],
    ] as const) {
      const view = renderLanguageControl(locale, copy);
      const trigger = languageTrigger(view, copy);

      // Radix registers item text only once the content has mounted, so open
      // the listbox before asserting the selected label.
      const listbox = await openLanguageListbox(view, copy);

      expect(trigger.textContent).toContain(label);
      expect(
        within(listbox)
          .getByRole("option", { selected: true })
          .textContent?.includes(label)
      ).toBe(true);
      cleanup();
    }
  });

  test("offers exactly one labelled option for every inlang locale", async () => {
    const { locales } = await import("@/features/i18n");
    const view = renderLanguageControl();

    const listbox = await openLanguageListbox(view);

    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(locales.length);
    // The option order follows the inlang locales tuple, and every locale has
    // a non-empty translated label.
    const labelsByLocale = {
      "cs-CZ": englishCopy.languageOptionCs,
      "en-US": englishCopy.languageOptionEn,
    };
    expect(options.map((option) => option.textContent)).toEqual(
      locales.map((locale) => labelsByLocale[locale])
    );
  });

  test("renders the language control without a separate Save button", () => {
    const view = renderLanguageControl();

    expect(view.queryByRole("button", { name: "Save" })).toBeNull();
    expect(view.queryByRole("status")).toBeNull();
  });

  test("saves the chosen language, then moves the document to it", async () => {
    const saved = Promise.withResolvers<LanguageActionResult>();
    updateLocalePreference.mockImplementationOnce(() => saved.promise);
    const view = renderLanguageControl();

    await chooseLanguage(view, "Čeština");

    expect(updateLocalePreference).toHaveBeenCalledWith({ locale: "cs-CZ" });
    expect(window.location.pathname).toBe("/en-US/account");
    // The control shows the choice and stays locked while the switch runs.
    expect(languageTrigger(view).textContent).toContain("Čeština");
    expect((languageTrigger(view) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      saved.resolve({ data: { status: "saved" } });
      await saved.promise;
    });

    await waitFor(() =>
      expect(window.location.pathname).toBe("/cs-CZ/account")
    );
    expect(window.location.search).toBe("?section=profile");
    expect(updateLocalePreference).toHaveBeenCalledTimes(1);
  });

  test("still moves the document when the save is rejected or fails in transport", async () => {
    for (const failure of [
      () => Promise.resolve({ serverError: "save rejected" }),
      () => Promise.reject(new Error("network unreachable")),
    ]) {
      window.location.href = "http://localhost/en-US/account?section=profile";
      updateLocalePreference.mockImplementationOnce(failure);
      const view = renderLanguageControl();

      await chooseLanguage(view, "Čeština");

      await waitFor(() =>
        expect(window.location.pathname).toBe("/cs-CZ/account")
      );
      cleanup();
    }
  });

  test("does nothing when the current language is picked again", async () => {
    const view = renderLanguageControl();

    await chooseLanguage(view, "English (US)");

    expect(updateLocalePreference).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/en-US/account");
    expect((languageTrigger(view) as HTMLButtonElement).disabled).toBe(false);
  });

  test("keeps the language control out of the surrounding profile form submission", async () => {
    let submitted = 0;
    const view = render(
      <form
        data-testid="profile-form"
        onSubmit={(event) => {
          event.preventDefault();
          submitted += 1;
        }}
      >
        <ProfileScreen
          copy={englishCopy}
          email={adaAddress}
          firstName="Ada"
          lastName="Lovelace"
          locale="en-US"
        >
          {profileFields}
        </ProfileScreen>
      </form>
    );
    const form = view.getByTestId("profile-form") as HTMLFormElement;

    expect(languageTrigger(view).getAttribute("type")).toBe("button");
    expect([...new FormData(form).keys()]).not.toContain("language");

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(submitted).toBe(1);
    expect(updateLocalePreference).not.toHaveBeenCalled();
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
    });

    expect(markup).not.toMatch(/member since|Prague|Czechia|turnstile|access/i);
  });
});
