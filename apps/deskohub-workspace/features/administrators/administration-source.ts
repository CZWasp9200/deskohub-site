import type { AdministratorAccountActor } from "./account-role";

/** The administration channels an administrator acts through. */
export const administrationSources = [
  "admin-ui",
  "dhw-cli",
  "assistant",
] as const;

export type AdministrationSource = (typeof administrationSources)[number];

/** The administrator account acting, and the channel it acts through. */
export type AdministrationActor = {
  readonly source: AdministrationSource;
  readonly administrator: AdministratorAccountActor;
};
