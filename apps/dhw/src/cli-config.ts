import { CliConfig, GlobalFlag } from "effect/cli";

/** The global flags `dhw` offers on every command: no interactive wizard mode. */
export const CliConfigLive = CliConfig.layer({
  builtIns: [
    GlobalFlag.Help,
    GlobalFlag.Version,
    GlobalFlag.Completions,
    GlobalFlag.LogLevel,
  ],
});
