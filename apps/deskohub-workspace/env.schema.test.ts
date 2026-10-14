import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Predicate, Schema } from "effect";
import { workspaceClientEnvSchema } from "./client-env.schema";
import { createWorkspaceEnv } from "./env";
import {
  createEnvironmentSchema,
  workspaceServerEnvSchema,
} from "./env.schema";

type WorkspaceRuntimeEnv = Parameters<typeof createWorkspaceEnv>[0];

const environmentFields = {
  ...workspaceServerEnvSchema.fields,
  ...workspaceClientEnvSchema.fields,
};

// The preloaded test environment plus a synthetic Resend key, which deployed
// environments require but the test process runs without, is a valid
// baseline; each case overrides only the variables it is about.
const workspaceRuntimeEnv = (
  overrides: Partial<Record<keyof WorkspaceRuntimeEnv, string | undefined>>
): WorkspaceRuntimeEnv => ({
  ...(Object.fromEntries(
    Object.keys(environmentFields).map((key) => [key, process.env[key]])
  ) as WorkspaceRuntimeEnv),
  EMAIL_API_KEY: "re_test",
  ...overrides,
});

const serverEnvironmentSchema = createEnvironmentSchema(
  environmentFields,
  true
);

const invalidVariables = (
  overrides: Partial<Record<keyof WorkspaceRuntimeEnv, string | undefined>>
) => {
  const result = serverEnvironmentSchema["~standard"].validate(
    workspaceRuntimeEnv(overrides)
  );

  if (result instanceof Promise) {
    throw new Error("Environment validation must be synchronous.");
  }

  return (result.issues ?? []).map((issue) =>
    (issue.path ?? [])
      .map((segment) => (Predicate.isObject(segment) ? segment.key : segment))
      .join(".")
  );
};

const environmentError = (
  overrides: Partial<Record<keyof WorkspaceRuntimeEnv, string | undefined>>
) => {
  try {
    createWorkspaceEnv(workspaceRuntimeEnv(overrides));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected the workspace environment to be rejected.");
};

describe("workspace environment schemas", () => {
  test("decodes numeric environment values", () => {
    const decodeTimeout = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.DOTYPOS_API_TIMEOUT
    );
    const decodePostHogProjectId = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.POSTHOG_PROJECT_ID
    );

    expect(decodeTimeout("2500")).toBe(2_500);
    expect(`${decodePostHogProjectId("42")}`).toBe("42");
    expect(decodePostHogProjectId(undefined)).toBeUndefined();
    expect(() => decodePostHogProjectId("")).toThrow();
    expect(() => decodeTimeout("1.5")).toThrow();
    expect(() => decodeTimeout("0")).toThrow();
  });

  test("bounds the Igloohome timeout at the shared per-request maximum", () => {
    const decodeIgloohomeTimeout = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.IGLOOHOME_API_TIMEOUT
    );

    expect(decodeIgloohomeTimeout("20000")).toBe(20_000);
    expect(() => decodeIgloohomeTimeout("20001")).toThrow();
    expect(() => decodeIgloohomeTimeout("0")).toThrow();
  });

  test("always requires the Igloohome target device and requires credentials only in production", () => {
    const missingCredentials = {
      IGLOOHOME_CLIENT_ID: undefined,
      IGLOOHOME_CLIENT_SECRET: undefined,
    };

    expect(
      invalidVariables({ ...missingCredentials, VERCEL_ENV: "preview" })
    ).toEqual([]);
    expect(
      invalidVariables({ ...missingCredentials, VERCEL_ENV: "production" })
    ).toEqual(["IGLOOHOME_CLIENT_ID", "IGLOOHOME_CLIENT_SECRET"]);
    expect(
      invalidVariables({
        IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID: undefined,
        VERCEL_ENV: "preview",
      })
    ).toEqual(["IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID"]);
  });

  test.each([
    "DATABASE_URL",
    "POSTHOG_API_HOST",
    "POSTHOG_INGEST_HOST",
    "WORKSPACE_E2E_BASE_URL",
  ] as const)("validates %s as a URL", (variable) => {
    expect(
      invalidVariables({ [variable]: "https://workspace.example" })
    ).toEqual([]);
    expect(invalidVariables({ [variable]: "not a URL" })).toEqual([variable]);
  });

  test("validates accounting snapshot key IDs without accepting secrets", () => {
    const decodeKeyId = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID
    );

    expect(decodeKeyId("K202608")).toBe("K202608");
    expect(() => decodeKeyId("key-202608")).toThrow();
    expect(() => decodeKeyId("K")).toThrow();
  });

  test("fails production closed when delivery or cron authentication is unconfigured", () => {
    expect(
      invalidVariables({ EMAIL_API_KEY: undefined, VERCEL_ENV: "production" })
    ).toEqual(["EMAIL_API_KEY"]);
    expect(
      invalidVariables({ EMAIL_API_KEY: "   ", VERCEL_ENV: "production" })
    ).toEqual(["EMAIL_API_KEY"]);
    expect(
      invalidVariables({ CRON_SECRET: undefined, VERCEL_ENV: "production" })
    ).toEqual(["CRON_SECRET"]);
  });

  test("fails preview closed when email delivery is unconfigured", () => {
    expect(
      invalidVariables({ EMAIL_API_KEY: undefined, VERCEL_ENV: "preview" })
    ).toEqual(["EMAIL_API_KEY"]);
    expect(
      invalidVariables({ EMAIL_API_KEY: "   ", VERCEL_ENV: "preview" })
    ).toEqual(["EMAIL_API_KEY"]);
  });

  test("keeps preview usable without cron or Better Auth secrets", () => {
    expect(
      invalidVariables({
        BETTER_AUTH_SECRETS: undefined,
        CRON_SECRET: undefined,
        VERCEL_ENV: "preview",
      })
    ).toEqual([]);
  });

  test("keeps development usable without delivery, cron, or Better Auth secrets", () => {
    expect(
      invalidVariables({
        BETTER_AUTH_SECRETS: undefined,
        CRON_SECRET: undefined,
        EMAIL_API_KEY: undefined,
        VERCEL_ENV: "development",
      })
    ).toEqual([]);
  });

  test("requires valid Better Auth secrets in production and accepts rotation", () => {
    expect(
      invalidVariables({
        BETTER_AUTH_SECRETS: undefined,
        VERCEL_ENV: "production",
      })
    ).toEqual(["BETTER_AUTH_SECRETS"]);
    expect(
      invalidVariables({
        BETTER_AUTH_SECRETS:
          "3:Qw7eNb2mVzYr8sKx4tLp6hUcJoAd5gRf,1:9tEWbGQfP2vXcK7mRz4sLh6yUnAoJd1e",
        VERCEL_ENV: "production",
      })
    ).toEqual([]);
  });

  test("requires the browser PostHog proxy when browser analytics is enabled", () => {
    expect(
      invalidVariables({
        NEXT_PUBLIC_POSTHOG_HOST: undefined,
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
      })
    ).toEqual(["NEXT_PUBLIC_POSTHOG_HOST"]);
  });

  test("retains server cross-field checks through T3 Env composition", () => {
    const overrides = '{"discount_codes":true}';

    expect(
      createWorkspaceEnv(
        workspaceRuntimeEnv({
          POSTHOG_FEATURE_FLAG_OVERRIDES: overrides,
          VERCEL_ENV: "preview",
        })
      ).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toEqual({ discount_codes: true });

    const productionError = environmentError({
      POSTHOG_FEATURE_FLAG_OVERRIDES: overrides,
      VERCEL_ENV: "production",
    });

    expect(productionError).toContain(
      "Invalid PostHog feature flag override configuration."
    );
    expect(productionError).not.toContain(overrides);
  });

  test("tolerates unknown override keys only outside production", () => {
    const overrides =
      '{"discount_codes":true,"loyalty_points":true,"seasonal_menu":"synthetic-variant"}';

    for (const VERCEL_ENV of ["preview", "development"] as const) {
      expect(
        createWorkspaceEnv(
          workspaceRuntimeEnv({
            POSTHOG_FEATURE_FLAG_OVERRIDES: overrides,
            VERCEL_ENV,
          })
        ).POSTHOG_FEATURE_FLAG_OVERRIDES
      ).toEqual({
        discount_codes: true,
        loyalty_points: true,
        seasonal_menu: "synthetic-variant",
      });
    }

    const productionError = environmentError({
      POSTHOG_FEATURE_FLAG_OVERRIDES: '{"loyalty_points":true}',
      VERCEL_ENV: "production",
    });

    expect(productionError).toContain(
      "Invalid PostHog feature flag override configuration."
    );
    expect(productionError).not.toContain('{"loyalty_points":true}');
  });

  test("names an invalid override key without echoing its value", () => {
    const error = environmentError({
      POSTHOG_FEATURE_FLAG_OVERRIDES: '{"discount_codes":"synthetic-variant"}',
      VERCEL_ENV: "preview",
    });

    expect(error).toContain(
      "Invalid PostHog feature flag override configuration."
    );
    expect(error).toContain('"discount_codes"');
    expect(error).not.toContain("synthetic-variant");
  });

  test("reports invalid secrets without echoing configured values", () => {
    const administratorDigest = createHash("sha256")
      .update("hushhush:quiet-synthetic-password")
      .digest("hex");
    const cases: readonly {
      readonly overrides: Partial<
        Record<keyof WorkspaceRuntimeEnv, string | undefined>
      >;
      readonly expected: string;
      readonly neverEcho?: readonly string[];
    }[] = [
      {
        overrides: { ADMIN_BASIC_AUTH_CREDENTIALS: undefined },
        expected: "Invalid administrator credential registry configuration.",
      },
      {
        overrides: { ADMIN_BASIC_AUTH_CREDENTIALS: "" },
        expected: "Invalid administrator credential registry configuration.",
      },
      {
        overrides: {
          ADMIN_BASIC_AUTH_CREDENTIALS: `hushhush:${administratorDigest}\nnonsense`,
        },
        expected: "Invalid administrator credential registry configuration.",
        neverEcho: ["hushhush", administratorDigest, "nonsense"],
      },
      {
        overrides: {
          BETTER_AUTH_SECRETS: "leaked-malformed-secret-token",
          VERCEL_ENV: "production",
        },
        expected: "Invalid Better Auth secret configuration.",
        neverEcho: ["leaked-malformed-secret-token"],
      },
      {
        overrides: {
          IGLOOHOME_CLIENT_SECRET: undefined,
          VERCEL_ENV: "production",
        },
        expected: "Invalid Igloohome client credential configuration.",
      },
      {
        overrides: { EMAIL_API_KEY: "", VERCEL_ENV: "production" },
        expected: "Invalid email delivery configuration.",
      },
      {
        overrides: { CRON_SECRET: "", VERCEL_ENV: "production" },
        expected: "Invalid production cron authentication configuration.",
      },
    ];

    for (const { overrides, expected, neverEcho = [] } of cases) {
      const error = environmentError(overrides);

      expect(error).toContain(expected);
      for (const value of neverEcho) {
        expect(error).not.toContain(value);
      }
    }
  });
});
