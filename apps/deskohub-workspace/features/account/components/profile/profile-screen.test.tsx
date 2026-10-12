import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
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

const updatePreferredLanguage = mock(
  (_input: { locale: Locale }): Promise<LanguageActionResult> =>
    Promise.resolve({ data: { status: "saved" } })
);

mock.module("@/features/account/actions", () => ({
  updatePreferredLanguage,
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: (input: { locale: string }) => Promise<LanguageActionResult>,
    options?: {
      readonly onSuccess?: (args: { readonly data?: unknown }) => void;
      readonly onTransportError?: (args: {
        readonly error: unknown;
        readonly input: { locale: string };
      }) => void;
    }
  ) => {
    const [result, setResult] = useState<LanguageActionResult>({});
    const [isExecuting, setIsExecuting] = useState(false);

    const execute = (input: { locale: string }) => {
      setIsExecuting(true);
      void action(input)
        .then((nextResult) => {
          setResult(nextResult);
          setIsExecuting(false);
          if (nextResult.data) {
            options?.onSuccess?.({ data: nextResult.data });
          }
        })
        .catch((error) => {
          setIsExecuting(false);
          options?.onTransportError?.({ error, input });
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
({ ProfileScreen } = await import("./profile-screen"));

const languageCatalogCopy = {
  "en-US": {
    save: "Save",
    saving: "Saving…",
    saved: m.accountProfileScreenLanguageSaved({}, { locale: "en-US" }),
    failed: m.accountProfileScreenLanguageSaveFailed({}, { locale: "en-US" }),
    readUnavailable: m.accountProfileScreenLanguageReadUnavailable(
      {},
      { locale: "en-US" }
    ),
    optionCs: "Čeština",
    optionEn: "English (US)",
  },
  "cs-CZ": {
    save: "Uložit",
    saving: "Ukládání…",
    saved: m.accountProfileScreenLanguageSaved({}, { locale: "cs-CZ" }),
    failed: m.accountProfileScreenLanguageSaveFailed({}, { locale: "cs-CZ" }),
    readUnavailable: m.accountProfileScreenLanguageReadUnavailable(
      {},
      { locale: "cs-CZ" }
    ),
    optionCs: "Čeština",
    optionEn: "English (US)",
  },
} as const;

const englishCopy: ProfileScreenCopy = {
  avatarUnavailableDescription: "Profile photos are not available here.",
  avatarUnavailableLabel: "Profile photo unavailable",
  emailLabel: "Email",
  emailVerification: {
    unverified: "This email still needs verification.",
    verified: "This email has been successfully verified.",
  },
  languageLabel: "Preferred communication language",
  languageSave: "Save",
  languageSaving: "Saving…",
  languageSaved: "Communication language saved.",
  languageSaveFailed: "Saving the communication language failed. Try again.",
  languageReadUnavailable: "Not available right now",
  languageOptionCs: "Čeština",
  languageOptionEn: "English (US)",
  memberFallback: "Workspace member",
  title: "Member profile and settings",
  verifiedEmail: "Verified login email",
};

const czechCopy: ProfileScreenCopy = {
  avatarUnavailableDescription: "Profilové fotografie nejsou k dispozici.",
  avatarUnavailableLabel: "Profilová fotografie není k dispozici",
  emailLabel: "E-mail",
  emailVerification: {
    unverified: "Tento e-mail stále vyžaduje ověření.",
    verified: "Tento e-mail byl úspěšně ověřen.",
  },
  languageLabel: "Preferovaný komunikační jazyk",
  languageSave: "Uložit",
  languageSaving: "Ukládání…",
  languageSaved: "Komunikační jazyk byl uložen.",
  languageSaveFailed:
    "Ukládání komunikačního jazyka se nepodařilo. Zkuste to znovu.",
  languageReadUnavailable: "Zrovna teď není k dispozici",
  languageOptionCs: "Čeština",
  languageOptionEn: "English (US)",
  memberFallback: "Člen Workspace",
  title: "Profil a nastavení",
  verifiedEmail: "Ověřený přihlašovací e-mail",
};

test("keeps the compiled catalog copy in sync with the component copy fixtures", () => {
  expect(languageCatalogCopy["en-US"].saved).toBe(englishCopy.languageSaved);
  expect(languageCatalogCopy["en-US"].failed).toBe(
    englishCopy.languageSaveFailed
  );
  expect(languageCatalogCopy["en-US"].readUnavailable).toBe(
    englishCopy.languageReadUnavailable
  );
  expect(languageCatalogCopy["cs-CZ"].saved).toBe(czechCopy.languageSaved);
  expect(languageCatalogCopy["cs-CZ"].failed).toBe(
    czechCopy.languageSaveFailed
  );
  expect(languageCatalogCopy["cs-CZ"].readUnavailable).toBe(
    czechCopy.languageReadUnavailable
  );
  expect(m.accountProfileScreenLanguageOptionCs({}, { locale: "cs-CZ" })).toBe(
    czechCopy.languageOptionCs
  );
  expect(m.accountProfileScreenLanguageOptionEn({}, { locale: "cs-CZ" })).toBe(
    czechCopy.languageOptionEn
  );
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
      email={overrides.email ?? "ada@example.test"}
      firstName={overrides.firstName ?? "Ada"}
      lastName={
        "lastName" in overrides ? (overrides.lastName ?? null) : "Lovelace"
      }
      preferredLanguage={overrides.preferredLanguage ?? "read-failed"}
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

  test("falls closed to the read-unavailable placeholder when no saved state is provided", () => {
    for (const copy of [englishCopy, czechCopy]) {
      const view = render(
        <ProfileScreen
          copy={copy}
          email="ada@example.test"
          firstName="Ada"
          lastName="Lovelace"
          preferredLanguage="read-failed"
        >
          {profileFields}
        </ProfileScreen>
      );
      const trigger = view.getByRole("combobox", { name: copy.languageLabel });

      expect((trigger as HTMLButtonElement).disabled).toBe(false);
      expect(trigger.textContent).toContain(copy.languageReadUnavailable);
      cleanup();
    }
  });

  test("renders the saved preference as the restored selection", async () => {
    const view = render(
      <ProfileScreen
        copy={englishCopy}
        email="ada@example.test"
        firstName="Ada"
        lastName="Lovelace"
        preferredLanguage="cs-CZ"
      >
        {profileFields}
      </ProfileScreen>
    );
    const trigger = view.getByRole("combobox", {
      name: englishCopy.languageLabel,
    });

    // Radix registers item text only once the content has mounted, so open
    // the listbox before asserting the restored label.
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    await view.findByRole("listbox");

    expect(trigger.textContent).toContain("Čeština");
    expect(trigger.textContent).not.toContain("Not set");
    cleanup();
  });

  test("offers exactly one labelled option for every inlang locale", async () => {
    const { locales } = await import("@/features/i18n");
    const view = render(
      <ProfileScreen
        copy={englishCopy}
        email="ada@example.test"
        firstName="Ada"
        lastName="Lovelace"
        preferredLanguage="cs-CZ"
      >
        {profileFields}
      </ProfileScreen>
    );
    const trigger = view.getByRole("combobox", {
      name: englishCopy.languageLabel,
    });

    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    const listbox = await view.findByRole("listbox");

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
    cleanup();
  });

  test("renders the read-unavailable placeholder instead of a restored locale when the read failed", () => {
    for (const copy of [englishCopy, czechCopy]) {
      const view = render(
        <ProfileScreen
          copy={copy}
          email="ada@example.test"
          firstName="Ada"
          lastName="Lovelace"
          preferredLanguage="read-failed"
        >
          {profileFields}
        </ProfileScreen>
      );
      const trigger = view.getByRole("combobox", {
        name: copy.languageLabel,
      });

      expect(trigger.textContent).toContain(copy.languageReadUnavailable);
      expect(trigger.textContent).not.toContain("Čeština");
      expect(trigger.textContent).not.toContain("English (US)");
      cleanup();
    }
  });

  test("saves a keyboard-chosen option through the language action", async () => {
    const view = render(
      <ProfileScreen
        copy={englishCopy}
        email="ada@example.test"
        firstName="Ada"
        lastName="Lovelace"
        preferredLanguage="en-US"
      >
        {profileFields}
      </ProfileScreen>
    );
    const trigger = view.getByRole("combobox", {
      name: englishCopy.languageLabel,
    });

    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    const _listbox = await view.findByRole("listbox");

    const option = view.getByRole("option", { name: "Čeština" });
    await act(async () => {
      option.focus();
    });
    await act(async () => {
      fireEvent.keyDown(option, { key: "Enter" });
    });

    expect(view.getByRole("combobox").textContent).toContain("Čeština");

    const saveButton = view.getByRole("button", { name: "Save" });
    expect(saveButton.getAttribute("type")).toBe("button");
    await act(async () => {
      // happy-dom does not synthesize a click from Enter, so press Enter and
      // dispatch the resulting default activation explicitly.
      fireEvent.keyDown(saveButton, { key: "Enter" });
      fireEvent.click(saveButton);
    });
    await waitFor(() =>
      expect(updatePreferredLanguage).toHaveBeenCalledWith({ locale: "cs-CZ" })
    );
    cleanup();
  });

  test("keeps Save disabled when a restored preference is re-picked without a change", async () => {
    // Radix Select fires onValueChange only when the value changes, so
    // re-picking the restored locale leaves the save gate closed; a case that
    // must save has to make a genuine selection change away from the restored
    // value (as the E2E language case does) before Save enables.
    updatePreferredLanguage.mockClear();
    const view = render(
      <ProfileScreen
        copy={englishCopy}
        email="ada@example.test"
        firstName="Ada"
        lastName="Lovelace"
        preferredLanguage="en-US"
      >
        {profileFields}
      </ProfileScreen>
    );
    const trigger = view.getByRole("combobox", {
      name: englishCopy.languageLabel,
    });

    const openListbox = async () => {
      await act(async () => {
        fireEvent.keyDown(trigger, { key: "Enter" });
      });
      return view.findByRole("listbox");
    };
    const chooseOption = async (name: string) => {
      const option = view.getByRole("option", { name });
      await act(async () => {
        option.focus();
      });
      await act(async () => {
        fireEvent.keyDown(option, { key: "Enter" });
      });
    };

    await openListbox();
    await chooseOption("English (US)");

    const saveButton = view.getByRole("button", { name: "Save" });
    expect(saveButton.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      fireEvent.click(saveButton);
    });
    expect(updatePreferredLanguage).not.toHaveBeenCalled();

    // A genuine selection change through the other locale closes the listbox,
    // so reopen before committing the final value.
    await openListbox();
    await chooseOption("Čeština");
    await openListbox();
    await chooseOption("English (US)");

    expect(saveButton.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      fireEvent.click(saveButton);
    });
    await waitFor(() =>
      expect(updatePreferredLanguage).toHaveBeenCalledWith({ locale: "en-US" })
    );
    cleanup();
  });

  test("announces saving during execution and the localized result copy afterwards", async () => {
    let resolveSave!: (result: LanguageActionResult) => void;
    updatePreferredLanguage.mockImplementationOnce(
      () =>
        new Promise<LanguageActionResult>((resolve) => {
          resolveSave = resolve;
        })
    );
    const view = render(
      <ProfileScreen
        copy={englishCopy}
        email="ada@example.test"
        firstName="Ada"
        lastName="Lovelace"
        preferredLanguage="en-US"
      >
        {profileFields}
      </ProfileScreen>
    );
    const trigger = view.getByRole("combobox", {
      name: englishCopy.languageLabel,
    });

    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    const _listbox = await view.findByRole("listbox");
    const option = view.getByRole("option", { name: "Čeština" });
    await act(async () => {
      option.focus();
    });
    await act(async () => {
      fireEvent.keyDown(option, { key: "Enter" });
    });

    const saveButton = view.getByRole("button", { name: "Save" });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(view.getByRole("button", { name: "Saving…" })).toBeTruthy();
    expect(view.getAllByText(englishCopy.languageSaving).length).toBe(2);

    await act(async () => {
      resolveSave({ data: { status: "saved" } });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(view.getByText(languageCatalogCopy["en-US"].saved)).toBeTruthy()
    );

    cleanup();
  });

  test("announces the localized failure copy when the save fails", async () => {
    let resolveFailedSave!: (result: LanguageActionResult) => void;
    updatePreferredLanguage.mockImplementationOnce(
      () =>
        new Promise<LanguageActionResult>((resolve) => {
          resolveFailedSave = resolve;
        })
    );
    const view = render(
      <ProfileScreen
        copy={czechCopy}
        email="ada@example.test"
        firstName="Ada"
        lastName="Lovelace"
        preferredLanguage="en-US"
      >
        {profileFields}
      </ProfileScreen>
    );
    const trigger = view.getByRole("combobox", {
      name: czechCopy.languageLabel,
    });

    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    const _listbox = await view.findByRole("listbox");
    const option = view.getByRole("option", { name: "Čeština" });
    await act(async () => {
      option.focus();
    });
    await act(async () => {
      fireEvent.keyDown(option, { key: "Enter" });
    });

    const saveButton = view.getByRole("button", { name: "Uložit" });
    await act(async () => {
      fireEvent.click(saveButton);
    });
    await act(async () => {
      resolveFailedSave({ serverError: "save rejected" });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(view.getByText(languageCatalogCopy["cs-CZ"].failed)).toBeTruthy()
    );
    cleanup();
  });

  test("announces the failure copy in red when the save transport fails", async () => {
    updatePreferredLanguage.mockImplementationOnce(() =>
      Promise.reject(new Error("network unreachable"))
    );
    const view = render(
      <ProfileScreen
        copy={englishCopy}
        email="ada@example.test"
        firstName="Ada"
        lastName="Lovelace"
        preferredLanguage="en-US"
      >
        {profileFields}
      </ProfileScreen>
    );
    const trigger = view.getByRole("combobox", {
      name: englishCopy.languageLabel,
    });

    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    const _listbox = await view.findByRole("listbox");
    const option = view.getByRole("option", { name: "Čeština" });
    await act(async () => {
      option.focus();
    });
    await act(async () => {
      fireEvent.keyDown(option, { key: "Enter" });
    });

    const saveButton = view.getByRole("button", { name: "Save" });
    await act(async () => {
      fireEvent.click(saveButton);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const announced = view.getByText(
      "Saving the communication language failed. Try again."
    );
    expect(announced.className).toContain("text-red-700");
    expect(announced.className).not.toContain("text-emerald-800");
    cleanup();
  });

  test("keeps the language save button out of the surrounding profile form submission", async () => {
    updatePreferredLanguage.mockClear();
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
          email="ada@example.test"
          firstName="Ada"
          lastName="Lovelace"
          preferredLanguage="en-US"
        >
          {profileFields}
        </ProfileScreen>
      </form>
    );
    const form = view.getByTestId("profile-form") as HTMLFormElement;
    const saveButton = view.getByRole("button", { name: "Save" });

    expect(saveButton.getAttribute("type")).toBe("button");
    expect([...new FormData(form).keys()]).not.toContain("language");

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(submitted).toBe(1);
    expect(updatePreferredLanguage).not.toHaveBeenCalled();
    cleanup();
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
