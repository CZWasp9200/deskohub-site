import { describe, expect, test } from "bun:test";
import { Console, Effect, Exit, Layer, Option } from "effect";
import { Command } from "effect/cli";
import { CliConfigLive } from "./cli-config";
import { dhwCommand } from "./command";
import { DhwConfig } from "./config/dhw-config.service";
import { PlatformLive } from "./platform";
import {
  UnreachedAccessCodeAttemptStore,
  UnreachedAuthenticationService,
  UnreachedClientIdentity,
  UnreachedUpdateService,
  UnreachedWorkspaceAdminApiClient,
} from "./testing/unreached-command-services";

const runDhw = async (args: ReadonlyArray<string>) => {
  const output: string[] = [];
  const layer = Layer.mergeAll(
    UnreachedAccessCodeAttemptStore,
    UnreachedAuthenticationService,
    UnreachedClientIdentity,
    UnreachedUpdateService,
    UnreachedWorkspaceAdminApiClient,
    CliConfigLive,
    Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...parts: ReadonlyArray<unknown>) => {
        output.push(parts.join(" "));
      },
    } satisfies Console.Console)
  ).pipe(
    Layer.provideMerge(
      Layer.succeed(DhwConfig, {
        baseUrl: new URL("https://workspace.example.test"),
        requestHeaders: {},
        isCi: true,
        stateDirectory: "/tmp/dhw-cli-config-test",
        updateChecksDisabled: true,
      })
    ),
    Layer.provideMerge(PlatformLive)
  );
  const exit = await Command.runWith(dhwCommand, { version: "1.3.0" })(
    args
  ).pipe(Effect.provide(layer), Effect.exit, Effect.runPromise);
  return { exit, output: output.join("\n") };
};

/** The flag names listed under a help section, such as `GLOBAL FLAGS`. */
const sectionFlags = (help: string, section: string) => {
  const lines = help.split("\n");
  const start = lines.indexOf(section);
  const end = lines.findIndex(
    (line, index) => index > start && /^[A-Z]/.test(line)
  );
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((line) => line.trim() !== "")
    .map((line) => line.trim().split(/\s{2,}|\s</)[0]);
};

describe("dhw global flags", () => {
  test("offers help, version, completions and log level, without wizard mode", async () => {
    const { output } = await runDhw(["--help"]);

    expect(sectionFlags(output, "GLOBAL FLAGS")).toEqual([
      "--help, -h",
      "--version, -v",
      "--completions",
      "--log-level",
    ]);
  });

  test("lists the inherited --json flag first among a subcommand's flags", async () => {
    const { output } = await runDhw(["reservations", "list", "--help"]);

    expect(output.split("\n")).not.toContain("INHERITED FLAGS");
    expect(sectionFlags(output, "FLAGS")[0]).toBe("--json");
  });

  test("refuses the wizard flag", async () => {
    const { exit } = await runDhw(["--wizard"]);

    expect(exit._tag).toBe("Failure");
  });

  test("writes the same PowerShell completion script for powershell and pwsh", async () => {
    const powershell = await runDhw(["--completions", "powershell"]);
    const pwsh = await runDhw(["--completions", "pwsh"]);

    expect(Exit.isSuccess(powershell.exit)).toBe(true);
    expect(powershell.output).not.toBe("");
    expect(pwsh.output).toBe(powershell.output);
  });

  test("refuses a single-value flag given twice before running the command", async () => {
    const { exit } = await runDhw([
      "reservations",
      "list",
      "--page",
      "1",
      "--page",
      "2",
    ]);

    const error = Option.getOrUndefined(Exit.findErrorOption(exit));
    expect(error).toMatchObject({
      _tag: "ShowHelp",
      commandPath: ["dhw", "reservations", "list"],
      errors: [{ _tag: "InvalidValue", option: "page", kind: "flag" }],
    });
  });
});
