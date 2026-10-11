import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration, or
// React's synthetic change events never fire against controlled inputs.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { renderToStaticMarkup } = await import("react-dom/server");

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
    const markup = renderToStaticMarkup(<SignInCard locale="en-US" />);
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

    const en = render(<SignInCard locale="en-US" />);
    expect(en.container.querySelector("h1")!.textContent).toBe(
      "Sign in or create an account"
    );
    expect(
      (en.getByLabelText("Email") as HTMLInputElement).hasAttribute("required")
    ).toBe(true);
    expect((en.getByLabelText("Email") as HTMLInputElement).disabled).toBe(
      false
    );
    expect(
      (
        en.getByRole("button", {
          name: "Email me a sign-in link",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(
      en.getByLabelText("Email").getAttribute("aria-describedby")
    ).toBeNull();
    en.unmount();

    const cs = render(<SignInCard locale="cs-CZ" />);
    expect(cs.container.querySelector("h1")!.textContent).toBe(
      "Přihlášení nebo vytvoření účtu"
    );
    expect(cs.getByLabelText("E-mail")).toBeTruthy();
  });

  test("sign-in card validates invalid email with localized copy before requesting a link", async () => {
    const { SignInCard } = await import("./sign-in-card");

    const en = render(<SignInCard locale="en-US" />);
    fireEvent.change(en.getByLabelText("Email"), {
      target: { value: "not-an-email" },
    });
    await act(async () => {
      fireEvent.submit(en.container.querySelector("#account-sign-in-form")!);
      await Promise.resolve();
    });
    const enEmail = en.getByLabelText("Email");
    expect(en.getByText("Enter a valid email address.")).toBeTruthy();
    expect(enEmail.getAttribute("aria-invalid")).toBe("true");
    expect(enEmail.getAttribute("aria-describedby")).toBeTruthy();
    en.unmount();

    const cs = render(<SignInCard locale="cs-CZ" />);
    fireEvent.change(cs.getByLabelText("E-mail"), {
      target: { value: "not-an-email" },
    });
    await act(async () => {
      fireEvent.submit(cs.container.querySelector("#account-sign-in-form")!);
      await Promise.resolve();
    });

    expect(cs.getByText("Zadej platnou emailovou adresu.")).toBeTruthy();
    expect(signInMagicLink).not.toHaveBeenCalled();
  });

  test("sign-in card swaps to the generic accepted state after the request succeeds", async () => {
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale="en-US" />);
    fireEvent.change(view.getByLabelText("Email"), {
      target: { value: " ada@example.test " },
    });
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-sign-in-form")!);
    });

    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.test",
        callbackURL: "/en-US/auth/callback",
        metadata: { locale: "en-US" },
      })
    );
    expect(view.getByText("Check your inbox")).toBeTruthy();
    expect(view.getByText(/single-use link will arrive shortly/)).toBeTruthy();

    fireEvent.click(view.getByText("Send another link"));
    expect(view.getByLabelText("Email")).toBeTruthy();
  });

  test("sign-in card shows a visible pending submit and sends only once", async () => {
    let resolveRequest!: (result: { error: null }) => void;
    const request = new Promise<{ error: null }>((resolve) => {
      resolveRequest = resolve;
    });
    signInMagicLink.mockImplementationOnce(() => request);
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale="en-US" />);
    fireEvent.change(view.getByLabelText("Email"), {
      target: { value: "ada@example.test" },
    });
    const form = view.container.querySelector("#account-sign-in-form")!;

    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      await Promise.resolve();
    });

    const submit = view.getByRole("button", {
      name: "Sending…",
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

    expect(view.getByText("Check your inbox")).toBeTruthy();
  });

  test("sign-in card reports rejected requests and allows retry", async () => {
    const request = Promise.reject(new Error("network failure"));
    signInMagicLink.mockImplementationOnce(() => request);
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale="en-US" />);
    fireEvent.change(view.getByLabelText("Email"), {
      target: { value: "ada@example.test" },
    });
    const form = view.container.querySelector("#account-sign-in-form")!;

    await act(async () => {
      fireEvent.submit(form);
      await request.catch(() => undefined);
    });

    expect(
      view.getByText("We could not send the link. Please try again.")
    ).toBeTruthy();
    const submit = view.getByRole("button", {
      name: "Email me a sign-in link",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(submit.getAttribute("aria-busy")).toBe("false");

    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(signInMagicLink).toHaveBeenCalledTimes(2);
    expect(view.getByText("Check your inbox")).toBeTruthy();
  });

  test("sign-in card reports request failures in the live region", async () => {
    signInMagicLink.mockImplementationOnce(() =>
      Promise.resolve({ error: { message: "rate limited" } })
    );
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale="en-US" />);
    fireEvent.change(view.getByLabelText("Email"), {
      target: { value: "ada@example.test" },
    });
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-sign-in-form")!);
    });

    expect(
      view.getByText("We could not send the link. Please try again.")
    ).toBeTruthy();
  });

  test("sign-in card keeps the typed email after a failed request", async () => {
    signInMagicLink.mockImplementationOnce(() =>
      Promise.resolve({ error: { message: "rate limited" } })
    );
    const { SignInCard } = await import("./sign-in-card");

    const view = render(<SignInCard locale="en-US" />);
    fireEvent.change(view.getByLabelText("Email"), {
      target: { value: "ada@example.test" },
    });
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-sign-in-form")!);
    });

    expect(
      view.getByText("We could not send the link. Please try again.")
    ).toBeTruthy();
    expect((view.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "ada@example.test"
    );
  });
});
