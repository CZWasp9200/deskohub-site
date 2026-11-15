import { Layer } from "effect";
import { CliConfig, CliOutput, GlobalFlag } from "effect/cli";

const formatter = CliOutput.defaultFormatter();

/**
 * How `dhw` presents its commands: the global flags offer no interactive
 * wizard mode, and a subcommand's help lists the flags it inherits, such as
 * `--json`, first among its own flags.
 */
export const CliConfigLive = Layer.mergeAll(
  CliConfig.layer({
    builtIns: [
      GlobalFlag.Help,
      GlobalFlag.Version,
      GlobalFlag.Completions,
      GlobalFlag.LogLevel,
    ],
  }),
  CliOutput.layer({
    ...formatter,
    formatHelpDoc: ({ inheritedFlags = [], ...doc }) =>
      formatter.formatHelpDoc({
        ...doc,
        flags: [...inheritedFlags, ...doc.flags],
      }),
  })
);
