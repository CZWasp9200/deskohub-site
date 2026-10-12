import { expect, test } from "bun:test";
import { Effect } from "effect";
import { m } from "@/features/i18n";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EStepRunner } from "../types";
import { assertContactForm } from "./contact";

const locale = "en-US" as const;

const runContactForm = (resultText: string) => {
  const run: Runner = async (_command, args, options) => ({
    exitCode: 0,
    stderr: "",
    stdout:
      args.includes("eval") && options?.input?.includes("document.body")
        ? resultText
        : "",
  });
  const config = {
    baseUrl:
      "https://deskohub-workspace-site-a1b2c3d4e-deskohub-bar.vercel.app",
    bypassSecret: undefined,
    expectedHost: "deskohub-workspace-site-a1b2c3d4e-deskohub-bar.vercel.app",
    timeouts: workspaceE2ETimeouts,
  } satisfies WorkspaceE2EConfig;
  const runStep: WorkspaceE2EStepRunner = ({ execute }) => execute;

  return assertContactForm({ config, run, runStep, session: "contact-test" });
};

test("passes when the contact form reports the message as sent", async () => {
  await Effect.runPromise(
    runContactForm(m.contactSuccessMessage({}, { locale }))
  );
});

test("fails the case when the contact form reports a send failure", async () => {
  const error = await Effect.runPromise(
    Effect.flip(runContactForm(m.contactEmailSendError({}, { locale })))
  );

  expect(error).toMatchObject({
    _tag: "WorkspaceE2EError",
    message: "Contact form submission failed",
  });
});
