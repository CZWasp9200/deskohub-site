import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/email/testing";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const adaAddress = testEmailAddress("ada");

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration, or
// React's synthetic change events never fire against controlled inputs.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { renderToStaticMarkup } = await import("react-dom/server");

const locale = "en-US";

const signInMagicLink = mock(() => Promise.resolve({ error: null }));

mock.module("@/features/account/auth.client", () => ({
  authClient: {
    signIn: {
      magicLink: signInMagicLink,
    },
  },
}));

describe("account components", () => {
  afterEach(() => {
    cleanup();
    signInMagicLink.mockClear();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("server markup cannot submit an email through a native GET", async () => {
    const { SignInCard } = await import("./sign-in-card");
    const markup = renderToStaticMarkup(<SignInCard locale={locale} />);
    const serverDocument = new DOMParser().parseFromString(markup, "text/html");
    const form = serverDocument.querySelector(
      "#account-sign-in-form"
    ) as HTMLFormElement;
    const email = serverDocument.querySelector(
      "#account-sign-in-email"
    ) as HTMLInputElement;
    const submit = serverDocument.querySelector(
      "#account-sign-in-submit"
    ) as HTMLButtonElement;

    expect(form.getAttribute("method")).toBe("post");
    expect(form.hasAttribute("action")).toBe(false);
    expect(email.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(signInMagicLink).not.toHaveBeenCalled();
  });

  test("sign-in card shows the request form in both locales", async () => {
    const { SignInCard } = await import("./sign-in-card");

    const en = render(<SignInCard locale={locale} />);
    expect(en.container.querySelector("h1")!.textContent).toBe(
      m.accountSignInTitle({}, { locale })
    );
    expect(
      (
        en.getByLabelText(
          m.accountSignInEmailLabel({}, { locale })
        ) as HTMLInputElement
      ).hasAttribute("required")
    ).toBe(true);
    expect(
      (
        en.getByLabelText(
          m.accountSignInEmailLabel({}, { locale })
        ) as HTMLInputElement
      ).disabled
    ).toBe(false);
    expect(
      (
        en.getByRole("button", {
          name: m.accountSignInSubmit({}, { locale }),
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(
      en
        .getByLabelText(m.accountSignInEmailLabel({}, { locale }))
        .getAttribute("aria-describedby")
    ).toBeNull();
    en.unmount();

    const cs = render(<SignInCard locale="cs-CZ" />);
    expect(cs.container.querySelector("h1")!.textContent).toBe(
      m.accountSignInTitle({}, { locale: "cs-CZ" })
    );
    expect(
      cs.getByLabelText(m.accountSignInEmailLabel({}, { locale: "cs-CZ" }))
    ).toBeTruthy();
  });

  test("sign-in card validates invalid email with localized copy before requesting a link", async () => {
    const { SignInCard } = await import("./sign-in-card");

    const en = render(<SignInCard locale={locale} />);
    fireEvent.change(
      en.getByLabelText(m.accountSignInEmailLabel({}, { locale })),
      {
        target: { value: "not-an-email" },
      }
    );
    await act(async () => {
      fireEvent.submit(en.container.querySelector("#account-sign-in-form")!);
      await Promise.resolve();
    });
    const enEmail = en.getByLabelText(
      m.accountSignInEmailLabel({}, { locale })
    );
    expect(
      en.getByText(m.contactValidationEmailInvalid({}, { locale }))
    ).toBeTruthy();
    expect(enEmail.getAttribute("aria-invalid")).toBe("true");
    expect(enEmail.getAttribute("aria-describedby")).toBeTruthy();
    en.unmount();

    const cs = render(<SignInCard locale="cs-CZ" />);
    fireEvent.change(
      cs.getByLabelText(m.accountSignInEmailLabel({}, { locale: "cs-CZ" })),
      {
        target: { value: "not-an-email" },
      }
    );
    await act(async () => {
      fireEvent.submit(cs.container.querySelector("#account-sign-in-form")!);
      await Promise.resolve();
    });

    expect(
      cs.getByText(m.contactValidationEmailInvalid({}, { locale: "cs-CZ" }))
    ).toBeTruthy();
    expect(signInMagicLink).not.toHaveBeenCalled();
  });

  test("sign-in card swaps to the generic accepted state after the request succeeds", async () => {
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    fireEvent.change(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale })),
      {
        target: { value: ` ${adaAddress} ` },
      }
    );
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-sign-in-form")!);
    });

    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: adaAddress,
        callbackURL: "/en-US/auth/callback",
        metadata: { locale: "en-US" },
      })
    );
    expect(
      view.getByText(m.accountSignInAcceptedTitle({}, { locale }))
    ).toBeTruthy();
    expect(
      view.getByText(m.accountSignInAcceptedBody({}, { locale }))
    ).toBeTruthy();

    fireEvent.click(
      view.getByText(m.accountSignInAcceptedAgain({}, { locale }))
    );
    expect(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale }))
    ).toBeTruthy();
  });

  test("sign-in card shows a visible pending submit and sends only once", async () => {
    let resolveRequest!: (result: { error: null }) => void;
    const request = new Promise<{ error: null }>((resolve) => {
      resolveRequest = resolve;
    });
    signInMagicLink.mockImplementationOnce(() => request);
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    fireEvent.change(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale })),
      {
        target: { value: adaAddress },
      }
    );
    const form = view.container.querySelector("#account-sign-in-form")!;

    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      await Promise.resolve();
    });

    const submit = view.getByRole("button", {
      name: m.accountSignInSubmitting({}, { locale }),
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(submit.querySelector("svg")).toBeTruthy();

    fireEvent.click(submit);
    expect(signInMagicLink).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest({ error: null });
      await request;
    });

    expect(
      view.getByText(m.accountSignInAcceptedTitle({}, { locale }))
    ).toBeTruthy();
  });

  test("sign-in card reports rejected requests and allows retry", async () => {
    const request = Promise.reject(new Error("network failure"));
    signInMagicLink.mockImplementationOnce(() => request);
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    fireEvent.change(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale })),
      {
        target: { value: adaAddress },
      }
    );
    const form = view.container.querySelector("#account-sign-in-form")!;

    await act(async () => {
      fireEvent.submit(form);
      await request.catch(() => undefined);
    });

    expect(
      view.getByText(m.accountSignInRequestFailed({}, { locale }))
    ).toBeTruthy();
    const submit = view.getByRole("button", {
      name: m.accountSignInSubmit({}, { locale }),
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(submit.getAttribute("aria-busy")).toBe("false");

    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(signInMagicLink).toHaveBeenCalledTimes(2);
    expect(
      view.getByText(m.accountSignInAcceptedTitle({}, { locale }))
    ).toBeTruthy();
  });

  test("sign-in card reports request failures in the live region", async () => {
    signInMagicLink.mockImplementationOnce(() =>
      Promise.resolve({ error: { message: "rate limited" } })
    );
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    fireEvent.change(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale })),
      {
        target: { value: adaAddress },
      }
    );
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-sign-in-form")!);
    });

    expect(
      view.getByText(m.accountSignInRequestFailed({}, { locale }))
    ).toBeTruthy();
  });

  test("sign-in card keeps the typed email after a failed request", async () => {
    signInMagicLink.mockImplementationOnce(() =>
      Promise.resolve({ error: { message: "rate limited" } })
    );
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale={locale} />);
    fireEvent.change(
      view.getByLabelText(m.accountSignInEmailLabel({}, { locale })),
      {
        target: { value: adaAddress },
      }
    );
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-sign-in-form")!);
    });

    expect(
      view.getByText(m.accountSignInRequestFailed({}, { locale }))
    ).toBeTruthy();
    expect(
      (
        view.getByLabelText(
          m.accountSignInEmailLabel({}, { locale })
        ) as HTMLInputElement
      ).value
    ).toBe(adaAddress);
  });
});
